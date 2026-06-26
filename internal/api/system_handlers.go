package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/mbox/mbox/internal/core"
	"github.com/mbox/mbox/internal/version"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"core": s.client.Available(ctx),
		"time": time.Now().Unix(),
	})
}

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	st := collectStats(s.cfg.WorkDir)

	ci := CoreInfo{Managed: s.manager.Managed()}
	state, errMsg := s.manager.Status()
	ci.Status = string(state)
	ci.Error = errMsg

	var ver core.Version
	if err := s.client.Version(ctx, &ver); err == nil {
		ci.Version = ver.Version
		ci.Status = "running" // API 可达即视为运行中
		ci.Error = ""
	}

	writeJSON(w, http.StatusOK, SystemInfo{
		Hostname:    st.Hostname,
		OS:          st.OS,
		Kernel:      st.Kernel,
		Uptime:      humanUptime(st.UptimeS),
		CPU:         st.CPU,
		Mem:         Pair{Used: st.MemUsed, Total: st.MemTotal},
		Disk:        Pair{Used: st.DiskUsed, Total: st.DiskTot},
		LoadAvg:     st.Load,
		Core:        ci,
		MBoxVersion: version.Version,
	})
}

func (s *Server) handleCoreAction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	var err error
	switch action {
	case "start":
		err = s.manager.Start()
	case "stop":
		err = s.manager.Stop()
	case "restart":
		err = s.manager.Restart()
	case "reload":
		// 复用 reloadCore：它会把配置路径转为绝对路径（mihomo PUT /configs 要求绝对路径，
		// 相对 WorkDir 会被拒为 400）并带超时，避免「重载」按钮在相对工作目录下失效。
		err = s.reloadCore(r.Context())
	default:
		writeErr(w, http.StatusBadRequest, "未知操作："+action)
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, s.runDiagnostics(ctx))
}

// SystemOptimize 是「设置」页系统优化项的状态视图。
type SystemOptimize struct {
	BBR          bool `json:"bbr"`
	BBRAvailable bool `json:"bbrAvailable"`
	Autostart    bool `json:"autostart"`
	IPForward    bool `json:"ipForward"`
}

func (s *Server) handleGetSystemOptimize(w http.ResponseWriter, r *http.Request) {
	bbr, avail := bbrStatus()
	writeJSON(w, http.StatusOK, SystemOptimize{
		BBR:          bbr,
		BBRAvailable: avail,
		Autostart:    autostartEnabled(),
		IPForward:    ipForwardEnabled(),
	})
}

func (s *Server) handleApplySystemOptimize(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BBR       *bool `json:"bbr"`
		Autostart *bool `json:"autostart"`
		IPForward *bool `json:"ipForward"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	if body.BBR != nil {
		if err := applyBBR(*body.BBR); err != nil {
			writeErr(w, http.StatusInternalServerError, "设置 BBR 失败："+err.Error())
			return
		}
	}
	if body.Autostart != nil {
		_, _, _ = setAutostart(*body.Autostart)
	}
	if body.IPForward != nil {
		if *body.IPForward {
			_, _, _ = enableIPForward()
		} else {
			_, _, _ = disableIPForward()
		}
	}
	s.handleGetSystemOptimize(w, r)
}

// handleCoreUpdate 在线更新 mihomo 内核：下载最新版 → 停内核 → 替换二进制 → 重启内核。
// 期间代理会短暂中断（替换内核必然如此）。失败会尽量回滚到原内核继续运行。
func (s *Server) handleCoreUpdate(w http.ResponseWriter, r *http.Request) {
	if s.cfg.MihomoBin == "" {
		writeErr(w, http.StatusBadRequest, "daemon 未托管内核，无法在线更新")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 110*time.Second)
	defer cancel()
	latest, err := cachedLatestVersion(ctx, s.manager.Spec().ReleaseRepo, true)
	if err != nil || latest == "" {
		writeErr(w, http.StatusBadGateway, "获取最新版本失败（请检查网络/代理）")
		return
	}
	newPath := s.cfg.MihomoBin + ".new"
	if err := core.DownloadMihomo(ctx, latest, newPath); err != nil {
		writeErr(w, http.StatusBadGateway, "下载内核失败："+err.Error())
		return
	}
	// 停内核以释放文件占用，替换后再启。替换失败则用原内核继续。
	_ = s.manager.Stop()
	time.Sleep(300 * time.Millisecond)
	if err := os.Rename(newPath, s.cfg.MihomoBin); err != nil {
		_ = os.Remove(newPath)
		_ = s.manager.Start()
		writeErr(w, http.StatusInternalServerError, "替换内核失败（已保持原内核运行）："+err.Error())
		return
	}
	if err := s.manager.Start(); err != nil {
		writeErr(w, http.StatusInternalServerError, "新内核启动失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": latest})
}

// handleSystemControl 重启/停止 daemon 服务（异步执行，先返回响应）。停止后面板会失联，
// 需在主机侧重新启动；前端应二次确认并提示。
func (s *Server) handleSystemControl(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	switch body.Action {
	case "restart", "stop":
		scheduleServiceControl(body.Action)
	default:
		writeErr(w, http.StatusBadRequest, "未知操作："+body.Action)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "action": body.Action})
}
