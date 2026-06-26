package api

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/config"
)

// dnsStatsCollector 周期性从 mihomo /connections 派生 DNS 解析统计。
// mihomo 未暴露逐条 DNS 查询/缓存命中计数，这里用"连接维度"做真实近似（零额外开销，
// 复用内核已有的连接元数据）：
//   - 累计解析域名：迄今见过的不同被解析域名（去重；有界 FIFO 淘汰，计数单调增长）
//   - 当前 fake-ip / 域名 / 直连IP 连接数
type dnsStatsCollector struct {
	mu   sync.Mutex
	seen map[string]struct{}
	// order 为 seen 的 FIFO 插入序，达到上限时淘汰最旧域名，使内存有界的同时
	// resolvedTotal 仍能持续累加（旧域名被淘汰后若重现会重复计一次，属可接受近似）。
	order         []string
	resolvedTotal int64
	fakeipActive  int
	domainActive  int
	directActive  int
	totalActive   int
	updatedAt     time.Time
	// fakeIPNet 是当前生效的 fake-ip 段，从 mihomo 配置 dns.fake-ip-range 解析而来，
	// 由 setFakeIPRange 周期刷新；缺省回退 198.18.0.0/16（mihomo 默认）。
	fakeIPNet  *net.IPNet
	fakeIPCIDR string
}

const dnsSeenCap = 20000

const defaultFakeIPRange = "198.18.0.0/16"

func newDNSStats() *dnsStatsCollector {
	_, n, _ := net.ParseCIDR(defaultFakeIPRange)
	return &dnsStatsCollector{
		seen:       map[string]struct{}{},
		fakeIPNet:  n,
		fakeIPCIDR: defaultFakeIPRange,
	}
}

// setFakeIPRange 用配置中的 fake-ip-range 刷新判定网段（CIDR 不变或非法则忽略）。
func (d *dnsStatsCollector) setFakeIPRange(cidr string) {
	cidr = strings.TrimSpace(cidr)
	if cidr == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if cidr == d.fakeIPCIDR {
		return
	}
	if _, n, err := net.ParseCIDR(cidr); err == nil {
		d.fakeIPNet = n
		d.fakeIPCIDR = cidr
	}
}

func (d *dnsStatsCollector) update(conns []Connection) {
	d.mu.Lock()
	defer d.mu.Unlock()
	fakeip, domain, direct := 0, 0, 0
	for _, c := range conns {
		hasDomain := c.Host != "" && net.ParseIP(c.Host) == nil
		if hasDomain {
			domain++
			// fake-ip 模式下，经内核解析的域名连接其 destinationIP 为空（真实地址在出站侧
			// 解析）或落在 fake-ip 段；直连域名(本地解析)才带真实 destinationIP。mihomo 的
			// /connections 对域名连接通常把 destinationIP 置空，故以"空/fake-ip段"判定。
			if c.DestIP == "" || (d.fakeIPNet != nil && d.fakeIPNet.Contains(net.ParseIP(c.DestIP))) {
				fakeip++
			}
			if _, ok := d.seen[c.Host]; !ok {
				d.seen[c.Host] = struct{}{}
				d.order = append(d.order, c.Host)
				d.resolvedTotal++
				if len(d.order) > dnsSeenCap {
					oldest := d.order[0]
					d.order = d.order[1:]
					delete(d.seen, oldest)
				}
			}
		} else {
			direct++
		}
	}
	d.fakeipActive = fakeip
	d.domainActive = domain
	d.directActive = direct
	d.totalActive = len(conns)
	d.updatedAt = time.Now()
}

func (d *dnsStatsCollector) snapshot() map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	return map[string]any{
		"resolvedTotal": d.resolvedTotal,
		"fakeipActive":  d.fakeipActive,
		"domainActive":  d.domainActive,
		"directActive":  d.directActive,
		"totalActive":   d.totalActive,
	}
}

// startDNSStats 以固定间隔轮询连接：派生 DNS 解析统计，并用累计量差分维护历史流量
// 小时/天聚合（比 /traffic 速率积分更准），直到 ctx 取消。
func (s *Server) startDNSStats(ctx context.Context) {
	go func() {
		t := time.NewTicker(4 * time.Second)
		defer t.Stop()
		s.refreshFakeIPRange()
		tick := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				tick++
				if tick%15 == 0 { // ≈每 60s 同步一次 fake-ip-range（面板改 DNS 后及时生效）
					s.refreshFakeIPRange()
				}
				cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
				raw, err := s.client.Connections(cctx)
				cancel()
				if err == nil {
					s.dns.update(transformConnections(raw))
					up, down := parseConnTotals(raw)
					s.traffic.recordTotals(up, down)
				}
			}
		}
	}()
}

// refreshFakeIPRange 从 mihomo 配置读取 dns.fake-ip-range 并刷新 DNS 统计判定网段。
func (s *Server) refreshFakeIPRange() {
	if mc, err := config.LoadMihomo(s.cfg.ConfigPath()); err == nil {
		s.dns.setFakeIPRange(mc.DNS.FakeIPRange)
	}
}

// handleDnsStats 返回 DNS 解析统计快照（仪表盘「DNS 解析」卡片）。
func (s *Server) handleDnsStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.dns.snapshot())
}
