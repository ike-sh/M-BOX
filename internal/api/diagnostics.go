package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/core"
)

// runDiagnostics 执行一键体检，返回各项结果。尽量做到平台安全：Linux 专属检查
// 在其它平台优雅降级为 warn/skip。
func (s *Server) runDiagnostics(ctx context.Context) []DiagItem {
	items := []DiagItem{}

	// 1. 内核进程 / API
	var ver core.Version
	if err := s.client.Version(ctx, &ver); err == nil {
		items = append(items, DiagItem{
			ID: "core", Label: "内核进程", Desc: "mihomo 是否运行 & API 可达",
			Status: "pass", Detail: fmt.Sprintf("mihomo %s · API %s ✓", ver.Version, s.cfg.Controller),
		})
	} else {
		items = append(items, DiagItem{
			ID: "core", Label: "内核进程", Desc: "mihomo 是否运行 & API 可达",
			Status: "fail", Detail: "external-controller 不可达：" + err.Error(),
		})
	}

	// 2. TUN 网卡
	mc, _ := config.LoadMihomo(s.cfg.ConfigPath())
	dev := "mbox-tun"
	if mc != nil && mc.TUN.Device != "" {
		dev = mc.TUN.Device
	}
	if up, ok := ifaceUp(dev); ok {
		st := "pass"
		detail := dev + " up"
		if !up {
			st = "warn"
			detail = dev + " 存在但未 up"
		}
		items = append(items, DiagItem{ID: "tun", Label: "TUN 网卡", Desc: "TUN 设备是否就绪", Status: st, Detail: detail})
	} else {
		items = append(items, DiagItem{ID: "tun", Label: "TUN 网卡", Desc: "TUN 设备是否就绪", Status: warnOrSkip(), Detail: dev + " 未找到"})
	}

	// 3. IP 转发
	items = append(items, checkIPForward())

	// 4. DNS 解析
	items = append(items, checkDNS(ctx))

	// 5. DNS 泄漏（粗略：检查系统 resolv 是否指向本机/加密上游）
	items = append(items, checkLeak())

	// 6. 代理连通（daemon 直接访问 generate_204，验证基础出口）
	items = append(items, checkProxy(ctx))

	// 7. Geo 数据
	items = append(items, checkGeo(s.cfg.WorkDir))

	return items
}

func warnOrSkip() string {
	if runtime.GOOS != "linux" {
		return "warn"
	}
	return "fail"
}

func ifaceUp(name string) (bool, bool) {
	ifi, err := net.InterfaceByName(name)
	if err != nil {
		return false, false
	}
	return ifi.Flags&net.FlagUp != 0, true
}

func checkIPForward() DiagItem {
	if runtime.GOOS != "linux" {
		return DiagItem{ID: "fwd", Label: "IP 转发", Desc: "net.ipv4.ip_forward", Status: "warn", Detail: "非 Linux 平台跳过"}
	}
	b, err := os.ReadFile("/proc/sys/net/ipv4/ip_forward")
	if err != nil {
		return DiagItem{ID: "fwd", Label: "IP 转发", Desc: "net.ipv4.ip_forward", Status: "fail", Detail: err.Error()}
	}
	v := strings.TrimSpace(string(b))
	if v == "1" {
		return DiagItem{ID: "fwd", Label: "IP 转发", Desc: "net.ipv4.ip_forward", Status: "pass", Detail: "= 1"}
	}
	return DiagItem{ID: "fwd", Label: "IP 转发", Desc: "net.ipv4.ip_forward", Status: "fail", Detail: "= " + v + "（旁路由必须为 1）"}
}

func checkDNS(ctx context.Context) DiagItem {
	start := time.Now()
	r := &net.Resolver{}
	_, err := r.LookupHost(ctx, "www.gstatic.com")
	rtt := time.Since(start).Milliseconds()
	if err != nil {
		return DiagItem{ID: "dns", Label: "DNS 解析", Desc: "域名是否可解析", Status: "fail", Detail: err.Error()}
	}
	return DiagItem{ID: "dns", Label: "DNS 解析", Desc: "域名是否可解析", Status: "pass", Detail: fmt.Sprintf("gstatic 解析成功 · %dms", rtt)}
}

func checkLeak() DiagItem {
	if runtime.GOOS != "linux" {
		return DiagItem{ID: "leak", Label: "DNS 泄漏", Desc: "出口 DNS 是否走加密上游", Status: "warn", Detail: "非 Linux 平台跳过"}
	}
	b, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return DiagItem{ID: "leak", Label: "DNS 泄漏", Desc: "出口 DNS 检查", Status: "warn", Detail: "无法读取 resolv.conf"}
	}
	if strings.Contains(string(b), "127.0.0.1") || strings.Contains(string(b), "::1") {
		return DiagItem{ID: "leak", Label: "DNS 泄漏", Desc: "出口 DNS 检查", Status: "pass", Detail: "本机 DNS 接管 ✓"}
	}
	return DiagItem{ID: "leak", Label: "DNS 泄漏", Desc: "出口 DNS 检查", Status: "warn", Detail: "resolv.conf 未指向本机，建议核查"}
}

func checkProxy(ctx context.Context) DiagItem {
	// 多目标 https 兜底：任一连通即视为出口正常。避免用单个明文 http 探针
	// （如 http://www.gstatic.com/generate_204）在被针对性干扰时误报"出口不通"。
	targets := []string{
		"https://www.gstatic.com/generate_204",
		"https://www.google.com/generate_204",
		"https://cp.cloudflare.com/generate_204",
	}
	client := &http.Client{Timeout: 6 * time.Second}
	lastErr := "无可用目标"
	for _, u := range targets {
		start := time.Now()
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		code := resp.StatusCode
		resp.Body.Close()
		rtt := time.Since(start).Milliseconds()
		if code == 204 || code == 200 {
			return DiagItem{ID: "proxy", Label: "出口连通", Desc: "国际站点可达性", Status: "pass", Detail: fmt.Sprintf("%d · %dms", code, rtt)}
		}
		lastErr = fmt.Sprintf("状态 %d", code)
	}
	return DiagItem{ID: "proxy", Label: "出口连通", Desc: "国际站点可达性", Status: "fail", Detail: lastErr}
}

func checkGeo(workDir string) DiagItem {
	newest := time.Time{}
	found := false
	for _, f := range []string{"geoip.dat", "geosite.dat", "geoip.metadb"} {
		if st, err := os.Stat(workDir + "/" + f); err == nil {
			found = true
			if st.ModTime().After(newest) {
				newest = st.ModTime()
			}
		}
	}
	if !found {
		return DiagItem{ID: "geo", Label: "Geo 数据", Desc: "geoip / geosite 是否存在", Status: "warn", Detail: "未找到 geo 数据文件"}
	}
	return DiagItem{ID: "geo", Label: "Geo 数据", Desc: "geoip / geosite 是否存在", Status: "pass", Detail: "更新于 " + humanSinceTime(newest)}
}
