package api

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/config"
)

// cnEchoURLs 是国内 IP 回显服务（解析到 CN，按默认规则 GEOIP/GEOSITE,cn 走直连），
// 因此返回的是"本地公网出口 IP"（不经代理）。
var cnEchoURLs = []string{
	"https://4.ipw.cn",
	"http://members.3322.org/dyndns/getip",
	"https://ip.3322.net",
}

// foreignEchoURLs 是境外 IP 回显服务（走代理），返回"代理出口 IP"。
var foreignEchoURLs = []string{
	"https://api.ip.sb/ip",
	"https://api.ipify.org",
	"http://ip-api.com/line/?fields=query",
}

var ipv4Re = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)

// localIPv4 返回本机第一个非回环、非 TUN 的私网 IPv4（局域网地址）。
func localIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := strings.ToLower(ifc.Name)
		if strings.Contains(name, "mbox-tun") || strings.HasPrefix(name, "tun") || strings.HasPrefix(name, "utun") {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			ip4 := ip.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			return ip4.String()
		}
	}
	return ""
}

// fetchIP 依次请求给定回显服务（用指定 client），返回第一个成功解析出的 IPv4。best-effort。
func fetchIP(ctx context.Context, cli *http.Client, urls []string) string {
	for _, u := range urls {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		resp, err := cli.Do(req)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		resp.Body.Close()
		if ip := ipv4Re.FindString(strings.TrimSpace(string(b))); ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
	}
	return ""
}

// directClient 直连（不经代理）客户端：用于探测「本地公网出口 IP」。
func directClient() *http.Client {
	return &http.Client{Timeout: 6 * time.Second}
}

// proxyClient 显式经 mihomo 本地 mixed-port 代理的客户端：用于探测「代理出口 IP」。
//
// 关键：daemon 自身发起的流量并不一定被 TUN 捕获（本机进程常被排除以避免回环），
// 直连国际多半不通。因此必须显式把探测请求走本地 mixed-port 代理，才能稳定拿到
// 真实的代理出口 IP（端口从 config 读取，缺省 7890；仅连 127.0.0.1，不受 allow-lan 影响）。
func (s *Server) proxyClient() *http.Client {
	port := 7890
	if mc, err := config.LoadMihomo(s.cfg.ConfigPath()); err == nil && mc.MixedPort > 0 {
		port = mc.MixedPort
	}
	pu, _ := url.Parse("http://127.0.0.1:" + strconv.Itoa(port))
	return &http.Client{
		Timeout:   7 * time.Second,
		Transport: &http.Transport{Proxy: http.ProxyURL(pu)},
	}
}

// handleNetInfo 返回本机信息供仪表盘显示：
//   - localIP：本地公网出口 IP（国内回显服务，直连探测，不走代理）
//   - egressIP：代理出口 IP（境外回显服务，显式经本地 mixed-port 代理）
//   - lanIP：局域网内网地址（兜底）
//
// 支持 ?scope=local|egress 仅探测其中一路，以便面板两个刷新按钮各刷各的、互不拖累。
// 不传 scope 时两路并发探测（首屏一次拿全）。
func (s *Server) handleNetInfo(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
	defer cancel()

	scope := r.URL.Query().Get("scope")
	wantLocal := scope == "" || scope == "local"
	wantEgress := scope == "" || scope == "egress"

	var localPub, egress string
	var wg sync.WaitGroup
	if wantLocal {
		wg.Add(1)
		go func() { defer wg.Done(); localPub = fetchIP(ctx, directClient(), cnEchoURLs) }()
	}
	if wantEgress {
		wg.Add(1)
		go func() { defer wg.Done(); egress = fetchIP(ctx, s.proxyClient(), foreignEchoURLs) }()
	}
	wg.Wait()

	// 仅在 wg.Wait 之后单线程组装结果，避免并发写 map 的数据竞争。
	out := map[string]string{}
	if wantLocal {
		out["localIP"] = localPub
		out["lanIP"] = localIPv4()
	}
	if wantEgress {
		out["egressIP"] = egress
	}
	writeJSON(w, http.StatusOK, out)
}
