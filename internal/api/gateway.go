package api

import (
	"context"
	"net/http"
	"time"

	"github.com/mbox/mbox/internal/config"
)

// GatewayStep 描述「一键开启/关闭透明代理网关」过程中单个步骤的结果。
type GatewayStep struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Skipped bool   `json:"skipped,omitempty"`
	Detail  string `json:"detail"`
}

// GatewayResult 汇总一键操作的整体结果与逐步明细。
type GatewayResult struct {
	Enabled bool          `json:"enabled"`
	OK      bool          `json:"ok"`
	Steps   []GatewayStep `json:"steps"`
}

// GatewayStatus 描述透明代理网关当前的关键开关状态，供面板回显。
type GatewayStatus struct {
	TunEnable   bool `json:"tunEnable"`
	IPForward   bool `json:"ipForward"`
	Autostart   bool `json:"autostart"`
	CoreRunning bool `json:"coreRunning"`
	Managed     bool `json:"managed"`
}

func ptrBool(b bool) *bool    { return &b }
func ptrStr(s string) *string { return &s }

// addStep 记录一个关键步骤；err 非 nil 时该步失败并把整体标记为失败。
func (g *GatewayResult) addStep(name string, err error, okDetail string) {
	step := GatewayStep{Name: name, OK: err == nil, Detail: okDetail}
	if err != nil {
		step.Detail = err.Error()
		g.OK = false
	}
	g.Steps = append(g.Steps, step)
}

// addSoft 记录一个非关键步骤；失败不影响整体 OK（仅作提示）。
func (g *GatewayResult) addSoft(name string, err error, okDetail string) {
	step := GatewayStep{Name: name, OK: err == nil, Detail: okDetail}
	if err != nil {
		step.Detail = err.Error()
	}
	g.Steps = append(g.Steps, step)
}

// addSkipped 记录一个被跳过的步骤（如当前平台不支持），不影响整体 OK。
func (g *GatewayResult) addSkipped(name, detail string) {
	g.Steps = append(g.Steps, GatewayStep{Name: name, OK: true, Skipped: true, Detail: detail})
}

// handleEnableGateway 一键开启透明代理网关：写 TUN 配置 + 开 IP 转发 +
// 启动内核 + 热重载 + 设置开机自启。逐步返回结果。
func (s *Server) handleEnableGateway(w http.ResponseWriter, r *http.Request) {
	res := GatewayResult{Enabled: true, OK: true}

	// 1. 写入 TUN 透明代理配置（开启 + auto-route + auto-redirect + strict-route），
	//    同时确保 DNS 开启（透明代理依赖内置 DNS 劫持）。
	s.cfgMu.Lock()
	err := config.ApplyTUN(s.cfg.ConfigPath(), config.TUNPatch{
		Enable:       ptrBool(true),
		Stack:        ptrStr("mixed"),
		AutoRoute:    ptrBool(true),
		AutoRedirect: ptrBool(true),
		StrictRoute:  ptrBool(true),
	})
	if err == nil {
		err = config.ApplyDNS(s.cfg.ConfigPath(), config.DNSPatch{Enable: ptrBool(true)})
	}
	s.cfgMu.Unlock()
	res.addStep("写入透明代理配置", err, "已开启 TUN + auto-route + auto-redirect + strict-route，并启用内置 DNS 劫持")

	// 2. 开启 IP 转发（运行时立即生效 + 写 /etc/sysctl.d 持久化）。
	fwDetail, fwSupported, fwErr := enableIPForward()
	if fwSupported {
		res.addStep("开启 IP 转发 (ip_forward)", fwErr, fwDetail)
	} else {
		res.addSkipped("开启 IP 转发 (ip_forward)", fwDetail)
	}

	// 3. 启动 mihomo 内核（托管模式下）。
	started := false
	if s.manager.Managed() {
		serr := s.manager.Start()
		res.addStep("启动 mihomo 内核", serr, "内核已启动，并由 daemon 守护自动拉起")
		started = serr == nil
	} else {
		res.addSkipped("启动 mihomo 内核", "daemon 未托管内核（反代模式），请确保 mihomo 已在运行")
	}

	// 4. 热重载配置。刚启动的内核会自行加载最新 config.yaml，此时控制器可能尚未就绪，
	//    所以这里作为「软步骤」：失败不影响整体成功。
	if started {
		time.Sleep(800 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	rerr := s.reloadCore(ctx)
	if started && rerr != nil {
		res.addSoft("热重载配置", nil, "内核刚启动，已自动加载最新配置")
	} else {
		res.addSoft("热重载配置", rerr, "mihomo 已按最新配置生效")
	}

	// 5. 设置开机自启（systemctl enable）。
	asDetail, asSupported, asErr := setAutostart(true)
	if asSupported {
		res.addStep("设置开机自启", asErr, asDetail)
	} else {
		res.addSkipped("设置开机自启", asDetail)
	}

	writeJSON(w, http.StatusOK, res)
}

// handleDisableGateway 关闭透明代理：仅关 TUN 并重载，使流量不再经过 M-BOX；
// 不停止 daemon、不取消开机自启，以保证面板仍可访问。
func (s *Server) handleDisableGateway(w http.ResponseWriter, r *http.Request) {
	res := GatewayResult{Enabled: false, OK: true}

	s.cfgMu.Lock()
	err := config.ApplyTUN(s.cfg.ConfigPath(), config.TUNPatch{Enable: ptrBool(false)})
	s.cfgMu.Unlock()
	res.addStep("关闭 TUN 透明代理", err, "已关闭 TUN，流量不再经过 M-BOX（IP 转发与开机自启保留）")

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	res.addSoft("热重载配置", s.reloadCore(ctx), "mihomo 已应用关闭")

	writeJSON(w, http.StatusOK, res)
}

// handleUninstallGateway 完全卸载/还原网关：关 TUN + 关 IP 转发并移除持久化 +
// 取消开机自启 + 清除按设备分流规则，最后热重载。比「关闭」更彻底，把系统恢复到
// 启用网关之前的状态（保留 store 内的设备元数据，便于日后重新启用）。
func (s *Server) handleUninstallGateway(w http.ResponseWriter, r *http.Request) {
	res := GatewayResult{Enabled: false, OK: true}

	// 1. 关闭 TUN 透明代理。
	s.cfgMu.Lock()
	tunErr := config.ApplyTUN(s.cfg.ConfigPath(), config.TUNPatch{Enable: ptrBool(false)})
	s.cfgMu.Unlock()
	res.addStep("关闭 TUN 透明代理", tunErr, "已关闭 TUN")

	// 2. 关闭 IP 转发并移除 sysctl 持久化。
	fwDetail, fwSupported, fwErr := disableIPForward()
	if fwSupported {
		res.addStep("关闭 IP 转发", fwErr, fwDetail)
	} else {
		res.addSkipped("关闭 IP 转发", fwDetail)
	}

	// 3. 取消开机自启。
	asDetail, asSupported, asErr := setAutostart(false)
	if asSupported {
		res.addStep("取消开机自启", asErr, asDetail)
	} else {
		res.addSkipped("取消开机自启", asDetail)
	}

	// 4. 清除按设备分流规则（仅移除 config 里的 SRC-IP 规则，保留 store 元数据）。
	s.cfgMu.Lock()
	devErr := config.SetDevicePolicies(s.cfg.ConfigPath(), nil)
	s.cfgMu.Unlock()
	res.addSoft("清除按设备分流规则", devErr, "已从配置移除 SRC-IP 规则（设备列表保留）")

	// 5. 热重载使还原生效。
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	res.addSoft("热重载配置", s.reloadCore(ctx), "mihomo 已应用还原")

	writeJSON(w, http.StatusOK, res)
}

// handleGatewayStatus 返回透明代理网关当前的关键开关状态。
func (s *Server) handleGatewayStatus(w http.ResponseWriter, r *http.Request) {
	st := GatewayStatus{
		IPForward: ipForwardEnabled(),
		Autostart: autostartEnabled(),
		Managed:   s.manager.Managed(),
	}
	if mc, err := config.LoadMihomo(s.cfg.ConfigPath()); err == nil {
		st.TunEnable = mc.TUN.Enable
	}
	ctx, cancel := reqCtx(r)
	defer cancel()
	st.CoreRunning = s.client.Available(ctx)
	writeJSON(w, http.StatusOK, st)
}
