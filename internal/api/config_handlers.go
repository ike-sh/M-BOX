package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/core"
)

const backupKeep = 20

// validModes 是合法的代理模式白名单（写入 config.yaml 前校验）。
var validModes = map[string]bool{"rule": true, "global": true, "direct": true}

// ---- 原始配置读写 ----

func (s *Server) handleGetConfigRaw(w http.ResponseWriter, r *http.Request) {
	raw, err := config.ReadConfigRaw(s.cfg.WorkDir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": string(raw)})
}

func (s *Server) handlePutConfigRaw(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeErr(w, http.StatusBadRequest, "缺少 content")
		return
	}
	// 保存前自动备份当前配置。
	s.cfgMu.Lock()
	_, _ = config.CreateBackup(s.cfg.WorkDir, "before-save", backupKeep)
	err := config.WriteConfigRaw(s.cfg.WorkDir, []byte(body.Content))
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "配置无效或写入失败："+err.Error())
		return
	}
	// 写入成功后热重载；若 mihomo 拒绝新配置（语义错误），把告警透传给前端，
	// 避免「显示已保存、实际 mihomo 仍跑旧配置」的误导。
	resp := map[string]any{"ok": true}
	if err := s.reloadCore(r.Context()); err != nil {
		resp["reloaded"] = false
		resp["warning"] = "配置已保存，但 mihomo 重载失败（仍以旧配置运行）：" + err.Error()
	} else {
		resp["reloaded"] = true
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleResetDefault 把 config.yaml 重置为内嵌默认配置（先自动备份），并保留当前
// external-controller secret 以免 daemon 与内核断开，最后热重载。危险操作，前端需二次确认。
func (s *Server) handleResetDefault(w http.ResponseWriter, r *http.Request) {
	s.cfgMu.Lock()
	_, _ = config.CreateBackup(s.cfg.WorkDir, "before-reset", backupKeep)
	err := config.WriteConfigRaw(s.cfg.WorkDir, config.DefaultConfigYAML())
	if err == nil {
		// 保留当前 secret，避免重置后控制器口令变化导致 daemon 连不上内核。
		_, _ = config.EnsureControllerSecret(s.cfg.ConfigPath(), s.cfg.Secret)
	}
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "重置失败："+err.Error())
		return
	}
	resp := map[string]any{"ok": true}
	if rerr := s.reloadCore(r.Context()); rerr != nil {
		resp["reloaded"] = false
		resp["warning"] = "已重置为默认配置，但 mihomo 重载失败：" + rerr.Error()
	} else {
		resp["reloaded"] = true
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- 备份 / 恢复 / 回滚 ----

type backupDTO struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Note    string `json:"note"`
	Time    string `json:"time"`
	Size    string `json:"size"`
	Current bool   `json:"current"`
}

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	list, err := config.ListBackups(s.cfg.WorkDir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]backupDTO, 0, len(list))
	for i, b := range list {
		out = append(out, backupDTO{
			ID:      b.ID,
			Name:    backupKind(b.Note),
			Note:    b.Note,
			Time:    b.CreatedAt.Format("2006-01-02 15:04"),
			Size:    humanBytes(b.Size),
			Current: i == 0, // 最新一份视为「当前」基准
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func backupKind(note string) string {
	switch note {
	case "before-save", "restore snapshot", "restore-snapshot", "auto", "before save":
		return "自动备份"
	default:
		return "手动备份"
	}
}

func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.cfgMu.Lock()
	b, err := config.CreateBackup(s.cfg.WorkDir, body.Note, backupKeep)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.cfgMu.Lock()
	err := config.RestoreBackup(s.cfg.WorkDir, id, backupKeep)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.reloadCore(r.Context())
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.cfgMu.Lock()
	err := config.DeleteBackup(s.cfg.WorkDir, id)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	raw, err := config.ReadBackup(s.cfg.WorkDir, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "备份不存在")
		return
	}
	w.Header().Set("Content-Type", "application/x-yaml")
	w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.yaml"`)
	_, _ = w.Write(raw)
}

// ---- 模式切换 ----

func (s *Server) handleGetGeneral(w http.ResponseWriter, r *http.Request) {
	mc, _ := config.LoadMihomo(s.cfg.ConfigPath())
	mode := "rule"
	if mc != nil && mc.Mode != "" {
		mode = mc.Mode
	}
	// 若 mihomo 在线，以运行态为准。
	ctx, cancel := reqCtx(r)
	defer cancel()
	if cfgs, err := s.client.Configs(ctx); err == nil {
		if m, ok := cfgs["mode"].(string); ok && m != "" {
			mode = m
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"mode": mode})
}

func (s *Server) handleSetMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Mode == "" {
		writeErr(w, http.StatusBadRequest, "缺少 mode")
		return
	}
	if !validModes[strings.ToLower(strings.TrimSpace(body.Mode))] {
		writeErr(w, http.StatusBadRequest, "mode 必须是 rule / global / direct")
		return
	}
	// 持久化到 config.yaml，并热更新运行态（mihomo PATCH /configs）。
	s.cfgMu.Lock()
	err := config.SetMode(s.cfg.ConfigPath(), body.Mode)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	ctx, cancel := reqCtx(r)
	defer cancel()
	_ = s.client.PatchConfigs(ctx, map[string]any{"mode": body.Mode})
	writeJSON(w, http.StatusOK, map[string]string{"mode": body.Mode})
}

// handleApplyTemplate 用「推荐策略模板」重写 proxy-groups + rules（内置 GEOSITE 规则、
// 地区分组 + 分类分流），并纳入当前已启用订阅的 provider。先自动备份当前配置，再热重载。
func (s *Server) handleApplyTemplate(w http.ResponseWriter, r *http.Request) {
	providers, nodeNames := s.enabledSubProviders()
	s.cfgMu.Lock()
	_, _ = config.CreateBackup(s.cfg.WorkDir, "before-template", backupKeep)
	// 确保每个启用订阅的 provider 条目已存在（避免模板 use 引用到不存在的 provider）。
	for _, sub := range s.store.Subscriptions() {
		if sub.Disabled {
			continue
		}
		rel := "./providers/" + safeFile(sub.Name) + ".yaml"
		_ = config.AddProxyProvider(s.cfg.ConfigPath(), sub.Name, sub.URL, rel, sub.Interval)
	}
	err := config.ApplyRecommendedTemplate(s.cfg.ConfigPath(), providers, nodeNames)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成模板失败："+err.Error())
		return
	}
	resp := map[string]any{"ok": true, "providers": len(providers)}
	if e := s.reloadCore(r.Context()); e != nil {
		resp["reloaded"] = false
		resp["warning"] = "模板已写入，但 mihomo 重载失败（仍以旧配置运行）：" + e.Error()
	} else {
		resp["reloaded"] = true
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- 规则增删 ----

func (s *Server) handleAddRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type    string `json:"type"`
		Payload string `json:"payload"`
		Target  string `json:"target"`
		Raw     string `json:"raw"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	rule := body.Raw
	if rule == "" {
		if body.Type == "" || body.Target == "" {
			writeErr(w, http.StatusBadRequest, "缺少 type/target")
			return
		}
		if body.Payload == "" {
			rule = body.Type + "," + body.Target // 如 MATCH,PROXY
		} else {
			rule = body.Type + "," + body.Payload + "," + body.Target
		}
	}
	s.cfgMu.Lock()
	err := config.AddRule(s.cfg.ConfigPath(), rule)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{"ok": true, "rule": rule}
	if wmsg := s.reloadWithWarn(r.Context()); wmsg != "" {
		resp["warning"] = wmsg
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Raw string `json:"raw"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Raw == "" {
		writeErr(w, http.StatusBadRequest, "缺少 raw")
		return
	}
	s.cfgMu.Lock()
	err := config.RemoveRule(s.cfg.ConfigPath(), body.Raw)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{"ok": true}
	if wmsg := s.reloadWithWarn(r.Context()); wmsg != "" {
		resp["warning"] = wmsg
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleUpdateRule 原地更新一条已存在的分流规则（保留其在列表中的位置）。
// 请求体：old=要更新的旧规则原文；新规则可直接给 raw，或给 type/payload/target 由后端拼装。
func (s *Server) handleUpdateRule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Old     string `json:"old"`
		Type    string `json:"type"`
		Payload string `json:"payload"`
		Target  string `json:"target"`
		Raw     string `json:"raw"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	if strings.TrimSpace(body.Old) == "" {
		writeErr(w, http.StatusBadRequest, "缺少 old（待更新的原规则）")
		return
	}
	newRule := strings.TrimSpace(body.Raw)
	if newRule == "" {
		if body.Type == "" || body.Target == "" {
			writeErr(w, http.StatusBadRequest, "缺少 type/target")
			return
		}
		if body.Payload == "" {
			newRule = body.Type + "," + body.Target // 如 MATCH,PROXY
		} else {
			newRule = body.Type + "," + body.Payload + "," + body.Target
		}
	}
	s.cfgMu.Lock()
	err := config.UpdateRule(s.cfg.ConfigPath(), body.Old, newRule)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{"ok": true, "rule": newRule}
	if wmsg := s.reloadWithWarn(r.Context()); wmsg != "" {
		resp["warning"] = wmsg
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- 内核版本检查 ----

// coreLatestCache 缓存 GitHub 最新版本查询结果。GitHub 未授权 API 限额仅
// 60 次/小时，而 System 页每次进入都会查一次；用 TTL 缓存避免频繁外呼与触发限流。
var coreLatestCache struct {
	mu  sync.Mutex
	val map[string]string // repo -> tag
	at  map[string]time.Time
}

const coreLatestTTL = time.Hour

// cachedLatestVersion 带 TTL 缓存地查询某仓库最新版本；缓存未命中才真正外呼。
// force=true 时跳过缓存强制重新查询（用于「检查更新」按钮，保证拿到实时结果）。
func cachedLatestVersion(ctx context.Context, repo string, force bool) (string, error) {
	coreLatestCache.mu.Lock()
	if coreLatestCache.val == nil {
		coreLatestCache.val = map[string]string{}
		coreLatestCache.at = map[string]time.Time{}
	}
	if !force {
		if v, ok := coreLatestCache.val[repo]; ok && time.Since(coreLatestCache.at[repo]) < coreLatestTTL {
			coreLatestCache.mu.Unlock()
			return v, nil
		}
	}
	coreLatestCache.mu.Unlock()

	v, err := core.LatestVersion(ctx, repo)
	if err != nil {
		return "", err
	}
	coreLatestCache.mu.Lock()
	coreLatestCache.val[repo] = v
	coreLatestCache.at[repo] = time.Now()
	coreLatestCache.mu.Unlock()
	return v, nil
}

func (s *Server) handleCoreLatest(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	var ver core.Version
	current := ""
	if err := s.client.Version(ctx, &ver); err == nil {
		current = ver.Version
	}
	force := r.URL.Query().Get("force") == "1"
	latest, err := cachedLatestVersion(ctx, s.manager.Spec().ReleaseRepo, force)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"current": current, "latest": "", "hasUpdate": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"current":   current,
		"latest":    latest,
		"hasUpdate": current != "" && latest != "" && normVer(current) != normVer(latest),
	})
}

// normVer 规范化版本号用于相等比较：去掉首尾空白与前导 'v'/'V'。
// 不做语义化大小比较——mihomo 上报版本与 GitHub tag 通常同源（如 v1.19.27），
// 只要不相等即视为有更新；子串匹配会把 v1.19.2 误判为 v1.19.27 的一部分，故不用。
func normVer(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")
	return s
}

// ---- 实时日志 WS ----

func (s *Server) handleLogsWS(w http.ResponseWriter, r *http.Request) {
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	writer := &wsWriter{conn: clientConn}

	// 读浏览器消息以感知断开，并用 pong 续期读超时（keepalive）。
	_ = clientConn.SetReadDeadline(time.Now().Add(wsPongWait))
	clientConn.SetPongHandler(func(string) error {
		return clientConn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	go func() {
		for {
			if _, _, err := clientConn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()
	// 定期 ping 浏览器：长时间无日志时避免被 NAT/代理掐断（与 /ws/traffic 一致）。
	go func() {
		t := time.NewTicker(wsPingPeriod)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if writer.ping() != nil {
					cancel()
					return
				}
			}
		}
	}()

	level := r.URL.Query().Get("level")
	if level == "" {
		level = "info"
	}
	upstream, err := s.client.DialLogs(ctx, level)
	if err != nil {
		// mihomo 不可达：推送一条提示后保持连接空转（仍有 ping 保活），避免前端反复重连。
		_ = writer.writeJSON(map[string]string{"type": "warning", "payload": "mihomo 未运行，暂无日志"})
		<-ctx.Done()
		return
	}
	defer upstream.Close()

	for {
		if ctx.Err() != nil {
			return
		}
		_, msg, err := upstream.ReadMessage()
		if err != nil {
			return
		}
		if err := writer.writeMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}
