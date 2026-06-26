// Package api 实现 M-BOX daemon 的 REST + WebSocket 服务。它把 mihomo 的实时
// 数据转换为面板契约（见 web/src/types），并托管已构建的前端静态资源。
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/core"
	"github.com/mbox/mbox/internal/logbuf"
	"github.com/mbox/mbox/internal/store"
)

// connSample 记录某连接上一次的累计流量，用于差分计算实时速率。
type connSample struct {
	up   int64
	down int64
	t    time.Time
}

// speedTracker 基于「上次累计值 + 时间差」为每条连接计算实时上/下行速率
// （mihomo /connections 只给累计字节、不给瞬时速率）。每个数据出口各持一份独立
// 实例，避免不同采样频率（REST 拉取 / WS 推送 / 设备聚合）相互污染时间基准。
type speedTracker struct {
	mu   sync.Mutex
	last map[string]connSample
}

func newSpeedTracker() *speedTracker { return &speedTracker{last: map[string]connSample{}} }

// fill 就地为 conns 填充 DLSpeed/ULSpeed，并刷新内部快照。
func (t *speedTracker) fill(conns []Connection) {
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	next := make(map[string]connSample, len(conns))
	for i := range conns {
		c := &conns[i]
		if prev, ok := t.last[c.ID]; ok {
			dt := now.Sub(prev.t).Seconds()
			if dt > 0.05 {
				if d := c.Download - prev.down; d > 0 {
					c.DLSpeed = int64(float64(d) / dt)
				}
				if u := c.Upload - prev.up; u > 0 {
					c.ULSpeed = int64(float64(u) / dt)
				}
			}
		}
		next[c.ID] = connSample{up: c.Upload, down: c.Download, t: now}
	}
	t.last = next
}

// Server 持有 daemon 的全部依赖。
type Server struct {
	cfg     config.Daemon
	client  *core.Client
	manager *core.Manager
	store   *store.Store

	// connSpeed 服务 REST /api/connections；devSpeed 服务 /api/devices/live。
	// 二者轮询节奏不同，各用独立追踪器。WS 推送则用请求内的局部追踪器。
	connSpeed *speedTracker
	devSpeed  *speedTracker

	// cfgMu 串行化对 config.yaml 的「读-改-写」，避免多个接口/调度器并发写时
	// 互相覆盖（lost update）。所有修改配置文件的路径都应先持有它。
	cfgMu sync.Mutex

	// traffic 记录最近一段时间的实时流量采样（秒级环形缓冲），供「流量统计」
	// 看板首屏使用；持续的实时增量仍由 /ws/traffic 推送。
	traffic *trafficHistory

	// dns 周期性从连接派生 DNS 解析统计，供仪表盘「DNS 解析」卡片。
	dns *dnsStatsCollector

	// logHub 收集 daemon 自身日志（环形缓冲 + 订阅），供「日志」页的「后端日志」区。
	logHub *logbuf.Hub
}

// New 构造 API server。
func New(cfg config.Daemon, client *core.Client, manager *core.Manager, st *store.Store, logHub *logbuf.Hub) *Server {
	s := &Server{
		cfg:       cfg,
		client:    client,
		manager:   manager,
		store:     st,
		connSpeed: newSpeedTracker(),
		devSpeed:  newSpeedTracker(),
		logHub:    logHub,
	}
	s.traffic = newTrafficHistory(st)
	s.dns = newDNSStats()
	return s
}

// Handler 返回组装好的 http.Handler（含 REST、WS 与静态资源）。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/proxies", s.handleProxies)
	mux.HandleFunc("PUT /api/proxies/{group}", s.handleSelectProxy)
	mux.HandleFunc("POST /api/proxies/delay", s.handleBatchDelay)
	mux.HandleFunc("POST /api/proxies/health", s.handleBatchHealth)
	mux.HandleFunc("POST /api/proxies/{name}/delay", s.handleProxyDelay)
	mux.HandleFunc("POST /api/proxies/import", s.handleImportProxies)
	mux.HandleFunc("POST /api/proxies/manual", s.handleManualProxy)
	mux.HandleFunc("DELETE /api/proxies/node/{name}", s.handleDeleteNode)
	mux.HandleFunc("GET /api/connections", s.handleConnections)
	mux.HandleFunc("DELETE /api/connections/{id}", s.handleCloseConnection)
	mux.HandleFunc("GET /api/traffic", s.handleTrafficHistory)
	mux.HandleFunc("GET /api/traffic/stats", s.handleTrafficStats)
	mux.HandleFunc("GET /api/rules", s.handleRules)
	mux.HandleFunc("GET /api/subscriptions", s.handleSubscriptions)
	mux.HandleFunc("POST /api/subscriptions", s.handleUpsertSubscription)
	mux.HandleFunc("POST /api/subscriptions/{name}/update", s.handleUpdateSubscription)
	mux.HandleFunc("POST /api/subscriptions/{name}/enable", s.handleSetSubscriptionEnabled)
	mux.HandleFunc("DELETE /api/subscriptions/{name}", s.handleDeleteSubscription)
	mux.HandleFunc("GET /api/system", s.handleSystem)
	mux.HandleFunc("GET /api/system/optimize", s.handleGetSystemOptimize)
	mux.HandleFunc("POST /api/system/optimize", s.handleApplySystemOptimize)
	mux.HandleFunc("POST /api/system/control", s.handleSystemControl)
	mux.HandleFunc("GET /api/netinfo", s.handleNetInfo)
	mux.HandleFunc("POST /api/core/{action}", s.handleCoreAction)
	mux.HandleFunc("POST /api/rules", s.handleAddRule)
	mux.HandleFunc("PUT /api/rules", s.handleUpdateRule)
	mux.HandleFunc("DELETE /api/rules", s.handleDeleteRule)
	mux.HandleFunc("POST /api/rules/providers", s.handleAddRuleProvider)
	mux.HandleFunc("DELETE /api/rules/providers/{name}", s.handleDeleteRuleProvider)
	mux.HandleFunc("POST /api/rules/providers/update", s.handleUpdateAllRuleProviders)
	mux.HandleFunc("POST /api/rules/providers/{name}/update", s.handleUpdateRuleProvider)
	mux.HandleFunc("POST /api/geo/update", s.handleUpdateGeo)
	mux.HandleFunc("GET /api/dns", s.handleDNS)
	mux.HandleFunc("POST /api/dns", s.handleApplyDNS)
	mux.HandleFunc("GET /api/dns/query", s.handleDnsQuery)
	mux.HandleFunc("GET /api/dns/stats", s.handleDnsStats)
	mux.HandleFunc("GET /api/tun", s.handleTUN)
	mux.HandleFunc("POST /api/tun", s.handleApplyTUN)
	mux.HandleFunc("GET /api/diagnostics", s.handleDiagnostics)

	// 透明代理网关一键开关
	mux.HandleFunc("GET /api/transparent", s.handleGatewayStatus)
	mux.HandleFunc("POST /api/transparent/enable", s.handleEnableGateway)
	mux.HandleFunc("POST /api/transparent/disable", s.handleDisableGateway)
	mux.HandleFunc("POST /api/transparent/uninstall", s.handleUninstallGateway)

	// 配置管理
	mux.HandleFunc("GET /api/config/raw", s.handleGetConfigRaw)
	mux.HandleFunc("PUT /api/config/raw", s.handlePutConfigRaw)
	mux.HandleFunc("POST /api/config/reset", s.handleResetDefault)
	mux.HandleFunc("GET /api/config/general", s.handleGetGeneral)
	mux.HandleFunc("GET /api/general", s.handleGetGeneralFull)
	mux.HandleFunc("POST /api/general", s.handleApplyGeneral)
	mux.HandleFunc("POST /api/config/mode", s.handleSetMode)
	mux.HandleFunc("POST /api/config/template", s.handleApplyTemplate)
	mux.HandleFunc("GET /api/config/backups", s.handleListBackups)
	mux.HandleFunc("POST /api/config/backups", s.handleCreateBackup)
	mux.HandleFunc("POST /api/config/backups/{id}/restore", s.handleRestoreBackup)
	mux.HandleFunc("DELETE /api/config/backups/{id}", s.handleDeleteBackup)
	mux.HandleFunc("GET /api/config/backups/{id}/download", s.handleDownloadBackup)

	// 内核版本检查 + 在线更新
	mux.HandleFunc("GET /api/core/latest", s.handleCoreLatest)
	mux.HandleFunc("POST /api/core/update", s.handleCoreUpdate)

	// 多内核可插拔
	mux.HandleFunc("GET /api/kernels", s.handleKernels)

	// 按设备策略
	mux.HandleFunc("GET /api/devices", s.handleListDevices)
	mux.HandleFunc("GET /api/devices/live", s.handleDevicesLive)
	mux.HandleFunc("POST /api/devices", s.handleUpsertDevice)
	mux.HandleFunc("DELETE /api/devices/{id}", s.handleDeleteDevice)

	// IPv6 完整支持
	mux.HandleFunc("GET /api/ipv6", s.handleGetIPv6)
	mux.HandleFunc("POST /api/ipv6", s.handleApplyIPv6)

	// 告警
	mux.HandleFunc("GET /ws/traffic", s.handleTrafficWS)
	mux.HandleFunc("GET /ws/logs", s.handleLogsWS)
	mux.HandleFunc("GET /ws/logs/backend", s.handleBackendLogsWS)

	mux.Handle("/", s.staticHandler())

	return withCORS(mux)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// reqCtx 给每个请求一个带超时的 context。
func reqCtx(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), 10*time.Second)
}

// isLoopbackHost 判断主机名是否为本机回环（用于放行同机开发：vite dev server 等）。
func isLoopbackHost(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

// allowedOrigin 判断请求 Origin 是否可信：同源（Origin.Host == 请求 Host）或本机回环。
// 返回 Origin 原值与是否可信。无 Origin 头时返回 ("", false)（同源 GET / 非浏览器客户端，
// 不需要 CORS 响应头）。
func allowedOrigin(r *http.Request) (string, bool) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return "", false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return origin, false
	}
	if strings.EqualFold(u.Host, r.Host) || isLoopbackHost(u.Hostname()) {
		return origin, true
	}
	return origin, false
}

// crossSiteMutation 判断是否为「跨站发起的变更请求」（应拒绝）。
// 浏览器发起的跨站请求必带 Origin；缺 Origin 时退而校验 Referer；两者皆无，视为
// 非浏览器客户端（curl/脚本），放行——既挡住浏览器 drive-by CSRF，又不破坏内网脚本自用。
func crossSiteMutation(r *http.Request) bool {
	if r.Header.Get("Origin") != "" {
		_, ok := allowedOrigin(r)
		return !ok
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		u, err := url.Parse(ref)
		if err != nil || u.Host == "" {
			return true
		}
		return !(strings.EqualFold(u.Host, r.Host) || isLoopbackHost(u.Hostname()))
	}
	return false
}

// withCORS 是同源感知的 CORS + CSRF 中间件：
//   - 不再回显 `Access-Control-Allow-Origin: *`；仅对可信源（同源/本机）回显其 Origin，
//     从而阻止任意网站跨域「读」面板 API 的响应；
//   - 变更类请求(POST/PUT/DELETE/PATCH)做同源校验，挡住跨站「写」(CSRF)；
//   - 全程不引入登录，保持「内网自用」体验，同时堵死 drive-by/DNS-rebinding 接管。
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		if origin, ok := allowedOrigin(r); ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		}
		if r.Method == http.MethodOptions {
			// 预检：可信源已带 CORS 头，不可信源不带 → 浏览器自行拦截。
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch:
			if crossSiteMutation(r) {
				writeErr(w, http.StatusForbidden, "跨站请求被拒绝（CSRF 保护）")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ---- 静态资源 ----

func (s *Server) staticDir() string {
	if s.cfg.WebDir != "" {
		return s.cfg.WebDir
	}
	// 优先使用已构建产物 web/dist，其次 dist，最后才是 web（开发目录）。
	for _, c := range []string{filepath.Join("web", "dist"), "dist", "web"} {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return "web/dist"
}

func (s *Server) staticHandler() http.Handler {
	dir := s.staticDir()
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// SPA fallback：非静态文件路径回退到 index.html（HashRouter 其实不需要，
		// 但保留以兼容未来 BrowserRouter）。
		p := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if r.URL.Path != "/" {
			if st, err := os.Stat(p); err != nil || st.IsDir() {
				if _, err := os.Stat(filepath.Join(dir, "index.html")); err == nil &&
					!strings.HasPrefix(r.URL.Path, "/assets/") {
					http.ServeFile(w, r, filepath.Join(dir, "index.html"))
					return
				}
			}
		}
		fs.ServeHTTP(w, r)
	})
}
