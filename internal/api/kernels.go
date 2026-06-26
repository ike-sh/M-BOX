package api

import (
	"context"
	"net/http"
	"os/exec"
	"regexp"
	"runtime"
	"time"

	"github.com/mbox/mbox/internal/core"
)

// KernelInfo 是单个内核选项的面板视图。
type KernelInfo struct {
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName"`
	DefaultBin  string `json:"defaultBin"`
	ConfigFile  string `json:"configFile"`
	ReleaseRepo string `json:"releaseRepo"`
	ClashAPI    bool   `json:"clashApi"`
	Current     bool   `json:"current"`
	// Installed 是磁盘上该内核可执行文件的版本（空=未安装/不可执行）；
	// Latest 是 GitHub 最新 release tag（空=查询失败）；Running 表示当前内核且控制器可达。
	Installed string `json:"installed"`
	Latest    string `json:"latest"`
	Running   bool   `json:"running"`
}

// kernelVersionRe 从 `<bin> -v` / `<bin> version` 输出里抓取形如 1.2.3 / v1.2.3 的版本号。
var kernelVersionRe = regexp.MustCompile(`[vV]?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)`)

// kernelInstalledVersion 执行内核二进制查询其版本（best-effort，2s 超时，失败返回空）。
func kernelInstalledVersion(parent context.Context, kind core.Kind, bin string) string {
	if bin == "" {
		return ""
	}
	args := []string{"-v"}
	if kind == core.KindSingBox {
		args = []string{"version"}
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
	if err != nil {
		return ""
	}
	if m := kernelVersionRe.FindStringSubmatch(string(out)); m != nil {
		return m[1]
	}
	return ""
}

// handleKernels 返回可用内核列表与当前选择，并附带每个内核的「已安装版本 / 最新版本 /
// 运行状态」。多内核可插拔抽象的对外入口：实际切换内核需调整 daemon 启动参数(-kernel)
// 并重启，故此处只读展示与版本信息，切换/安装由后续按需接入。
func (s *Server) handleKernels(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	current := s.manager.Spec().Kind
	coreUp := s.client.Available(ctx)

	out := make([]KernelInfo, 0)
	for _, k := range core.Kernels() {
		// mihomo 用 daemon 实际配置的二进制路径；其余内核用 PATH 中的默认名探测。
		bin := k.DefaultBin
		if k.Kind == core.KindMihomo && s.cfg.MihomoBin != "" {
			bin = s.cfg.MihomoBin
		}
		latest := ""
		if v, err := cachedLatestVersion(ctx, k.ReleaseRepo, false); err == nil {
			latest = v
		}
		out = append(out, KernelInfo{
			Kind:        string(k.Kind),
			DisplayName: k.DisplayName,
			DefaultBin:  k.DefaultBin,
			ConfigFile:  k.ConfigFile,
			ReleaseRepo: k.ReleaseRepo,
			ClashAPI:    k.ClashAPI,
			Current:     k.Kind == current,
			Installed:   kernelInstalledVersion(ctx, k.Kind, bin),
			Latest:      latest,
			Running:     k.Kind == current && coreUp,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"current": string(current),
		"os":      runtime.GOOS,
		"arch":    runtime.GOARCH,
		"kernels": out,
	})
}
