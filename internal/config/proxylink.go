package config

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ParseProxyResult 是一批分享链接解析的结果。
type ParseProxyResult struct {
	Proxies []map[string]any // 解析成功的 mihomo proxy 列表
	Errors  []string         // 失败链接的原因（含原文摘要）
}

// ParseProxyLinks 解析一段文本里的多条分享链接（按行分割，忽略空行/注释）。
// 若整段是一个 base64（机场常见的「订阅内容」直接粘贴），先尝试解码再按行解析。
func ParseProxyLinks(text string) ParseProxyResult {
	text = strings.TrimSpace(text)
	res := ParseProxyResult{}
	if text == "" {
		return res
	}

	lines := splitLinks(text)
	// 整段疑似 base64（无协议前缀且可解码）：解码后再分割。
	if len(lines) == 1 && !hasScheme(lines[0]) {
		if dec, err := b64decode(lines[0]); err == nil {
			if sub := splitLinks(string(dec)); len(sub) > 0 {
				lines = sub
			}
		}
	}

	seen := map[string]bool{}
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "#") || strings.HasPrefix(ln, "//") {
			continue
		}
		p, err := ParseProxyLink(ln)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("%s … : %v", snippet(ln), err))
			continue
		}
		// 节点去重：同一批里指纹相同(同协议/服务器/端口/凭据)的节点只保留一个，
		// 避免机场订阅常见的重复节点污染列表。
		fp := proxyFingerprint(p)
		if seen[fp] {
			continue
		}
		seen[fp] = true
		res.Proxies = append(res.Proxies, p)
	}
	return res
}

// fingerprintFrom 由「决定连接身份」的字段拼出节点指纹（忽略名称等展示性差异），
// 供去重使用。map 来源与 yaml.Node 来源共用此函数以保证两侧格式一致。
func fingerprintFrom(get func(string) string) string {
	parts := []string{
		strings.ToLower(get("type")),
		strings.ToLower(get("server")),
		get("port"),
		get("uuid"),
		get("password"),
		get("username"),
		get("cipher"),
		strings.ToLower(get("network")),
		get("servername"),
		get("sni"),
	}
	return strings.Join(parts, "|")
}

// proxyFingerprint 计算一个 mihomo proxy(map) 的去重指纹。
func proxyFingerprint(p map[string]any) string {
	return fingerprintFrom(func(k string) string {
		v, ok := p[k]
		if !ok || v == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(v))
	})
}

// ParseProxyLink 把单条分享链接解析为一个 mihomo proxy 映射。
func ParseProxyLink(link string) (map[string]any, error) {
	link = strings.TrimSpace(link)
	lower := strings.ToLower(link)
	switch {
	case strings.HasPrefix(lower, "ss://"):
		return parseSS(link)
	case strings.HasPrefix(lower, "ssr://"):
		return parseSSR(link)
	case strings.HasPrefix(lower, "vmess://"):
		return parseVMess(link)
	case strings.HasPrefix(lower, "vless://"):
		return parseVLESS(link)
	case strings.HasPrefix(lower, "trojan://"):
		return parseTrojan(link)
	case strings.HasPrefix(lower, "hysteria2://"), strings.HasPrefix(lower, "hy2://"):
		return parseHysteria2(link)
	case strings.HasPrefix(lower, "hysteria://"), strings.HasPrefix(lower, "hy://"):
		return parseHysteria(link)
	case strings.HasPrefix(lower, "tuic://"):
		return parseTUIC(link)
	case strings.HasPrefix(lower, "mierus://"), strings.HasPrefix(lower, "mieru://"):
		return parseMieru(link)
	case strings.HasPrefix(lower, "socks://"), strings.HasPrefix(lower, "socks5://"):
		return parseSocks(link)
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return parseHTTP(link)
	default:
		return nil, fmt.Errorf("不支持的协议")
	}
}

// ---- shadowsocks ----

func parseSS(link string) (map[string]any, error) {
	rest := link[len("ss://"):]
	rest, name := splitFragment(rest)
	var pluginQuery string
	if i := strings.Index(rest, "?"); i >= 0 {
		pluginQuery = rest[i+1:]
		rest = rest[:i]
	}
	rest = strings.TrimSuffix(rest, "/")

	var method, password, hostport string
	if at := strings.LastIndex(rest, "@"); at >= 0 {
		userinfo := rest[:at]
		hostport = rest[at+1:]
		if dec, err := b64decode(userinfo); err == nil && strings.Contains(string(dec), ":") {
			userinfo = string(dec)
		}
		method, password = cut(userinfo, ":")
	} else {
		// 整体 base64：method:password@host:port
		dec, err := b64decode(rest)
		if err != nil {
			return nil, fmt.Errorf("ss 解码失败")
		}
		body := string(dec)
		at2 := strings.LastIndex(body, "@")
		if at2 < 0 {
			return nil, fmt.Errorf("ss 格式无效")
		}
		method, password = cut(body[:at2], ":")
		hostport = body[at2+1:]
	}
	host, portStr := splitHostPort(hostport)
	port, err := atoiPort(portStr)
	if err != nil {
		return nil, err
	}
	p := map[string]any{
		"name":     orName(name, "ss", host, port),
		"type":     "ss",
		"server":   host,
		"port":     port,
		"cipher":   method,
		"password": password,
		"udp":      true,
	}
	applySSPlugin(p, pluginQuery)
	return p, nil
}

// applySSPlugin 解析 ss 链接的 plugin 查询（obfs / v2ray-plugin / shadow-tls）。
func applySSPlugin(p map[string]any, query string) {
	if query == "" {
		return
	}
	vals, err := url.ParseQuery(query)
	if err != nil {
		return
	}
	plugin := vals.Get("plugin")
	if plugin == "" {
		return
	}
	// plugin 形如 "obfs-local;obfs=http;obfs-host=xxx"
	segs := strings.Split(plugin, ";")
	kind := segs[0]
	opts := map[string]any{}
	for _, s := range segs[1:] {
		k, v := cut(s, "=")
		if k != "" {
			opts[k] = v
		}
	}
	switch {
	case strings.Contains(kind, "obfs"):
		p["plugin"] = "obfs"
		po := map[string]any{}
		if m, ok := opts["obfs"]; ok {
			po["mode"] = m
		}
		if h, ok := opts["obfs-host"]; ok {
			po["host"] = h
		}
		p["plugin-opts"] = po
	case strings.Contains(kind, "v2ray"):
		p["plugin"] = "v2ray-plugin"
		p["plugin-opts"] = opts
	}
}

// ---- shadowsocksr ----

func parseSSR(link string) (map[string]any, error) {
	body := link[len("ssr://"):]
	dec, err := b64decode(body)
	if err != nil {
		return nil, fmt.Errorf("ssr 解码失败")
	}
	s := string(dec)
	main := s
	query := ""
	if i := strings.Index(s, "/?"); i >= 0 {
		main = s[:i]
		query = s[i+2:]
	} else if i := strings.Index(s, "?"); i >= 0 {
		main = s[:i]
		query = s[i+1:]
	}
	parts := strings.Split(main, ":")
	if len(parts) < 6 {
		return nil, fmt.Errorf("ssr 字段不足")
	}
	// host:port:protocol:method:obfs:base64(password)
	host := parts[0]
	port, err := atoiPort(parts[1])
	if err != nil {
		return nil, err
	}
	protocol, method, obfs := parts[2], parts[3], parts[4]
	pwd, _ := b64decode(parts[5])
	vals, _ := url.ParseQuery(query)
	name := decodeParam(vals.Get("remarks"))
	p := map[string]any{
		"name":     orName(name, "ssr", host, port),
		"type":     "ssr",
		"server":   host,
		"port":     port,
		"cipher":   method,
		"password": string(pwd),
		"protocol": protocol,
		"obfs":     obfs,
		"udp":      true,
	}
	if v := decodeParam(vals.Get("protoparam")); v != "" {
		p["protocol-param"] = v
	}
	if v := decodeParam(vals.Get("obfsparam")); v != "" {
		p["obfs-param"] = v
	}
	return p, nil
}

// ---- vmess ----

func parseVMess(link string) (map[string]any, error) {
	body := link[len("vmess://"):]
	dec, err := b64decode(body)
	if err != nil {
		return nil, fmt.Errorf("vmess 解码失败")
	}
	var v struct {
		PS   string `json:"ps"`
		Add  string `json:"add"`
		Port any    `json:"port"`
		ID   string `json:"id"`
		Aid  any    `json:"aid"`
		Scy  string `json:"scy"`
		Net  string `json:"net"`
		Type string `json:"type"`
		Host string `json:"host"`
		Path string `json:"path"`
		TLS  string `json:"tls"`
		SNI  string `json:"sni"`
		ALPN string `json:"alpn"`
	}
	if err := json.Unmarshal(dec, &v); err != nil {
		return nil, fmt.Errorf("vmess JSON 无效")
	}
	port, err := atoiPort(toStr(v.Port))
	if err != nil {
		return nil, err
	}
	cipher := v.Scy
	if cipher == "" {
		cipher = "auto"
	}
	p := map[string]any{
		"name":    orName(v.PS, "vmess", v.Add, port),
		"type":    "vmess",
		"server":  v.Add,
		"port":    port,
		"uuid":    v.ID,
		"alterId": atoiDefault(toStr(v.Aid), 0),
		"cipher":  cipher,
		"udp":     true,
		"network": orStrDef(v.Net, "tcp"),
	}
	if strings.EqualFold(v.TLS, "tls") {
		p["tls"] = true
		if v.SNI != "" {
			p["servername"] = v.SNI
		} else if v.Host != "" {
			p["servername"] = v.Host
		}
		if v.ALPN != "" {
			p["alpn"] = splitComma(v.ALPN)
		}
	}
	applyTransport(p, v.Net, v.Host, v.Path, v.Type, "")
	return p, nil
}

// ---- vless ----

func parseVLESS(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("vless URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	q := u.Query()
	p := map[string]any{
		"name":    orName(u.Fragment, "vless", u.Hostname(), port),
		"type":    "vless",
		"server":  u.Hostname(),
		"port":    port,
		"uuid":    u.User.Username(),
		"udp":     true,
		"network": orStrDef(q.Get("type"), "tcp"),
	}
	if flow := q.Get("flow"); flow != "" {
		p["flow"] = flow
	}
	security := q.Get("security")
	sni := q.Get("sni")
	switch security {
	case "tls":
		p["tls"] = true
		if sni != "" {
			p["servername"] = sni
		}
	case "reality":
		p["tls"] = true
		if sni != "" {
			p["servername"] = sni
		}
		ro := map[string]any{}
		if pbk := q.Get("pbk"); pbk != "" {
			ro["public-key"] = pbk
		}
		if sid := q.Get("sid"); sid != "" {
			ro["short-id"] = sid
		}
		p["reality-opts"] = ro
	}
	if fp := q.Get("fp"); fp != "" {
		p["client-fingerprint"] = fp
	}
	applyTransport(p, q.Get("type"), q.Get("host"), q.Get("path"), q.Get("headerType"), q.Get("serviceName"))
	return p, nil
}

// ---- trojan ----

func parseTrojan(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("trojan URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	q := u.Query()
	p := map[string]any{
		"name":     orName(u.Fragment, "trojan", u.Hostname(), port),
		"type":     "trojan",
		"server":   u.Hostname(),
		"port":     port,
		"password": u.User.Username(),
		"udp":      true,
	}
	sni := q.Get("sni")
	if sni == "" {
		sni = q.Get("peer")
	}
	if sni != "" {
		p["sni"] = sni
	}
	if q.Get("allowInsecure") == "1" || strings.EqualFold(q.Get("allowInsecure"), "true") {
		p["skip-cert-verify"] = true
	}
	if fp := q.Get("fp"); fp != "" {
		p["client-fingerprint"] = fp
	}
	if alpn := q.Get("alpn"); alpn != "" {
		p["alpn"] = splitComma(alpn)
	}
	if net := q.Get("type"); net != "" && net != "tcp" {
		p["network"] = net
		applyTransport(p, net, q.Get("host"), q.Get("path"), q.Get("headerType"), q.Get("serviceName"))
	}
	return p, nil
}

// ---- hysteria2 ----

func parseHysteria2(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("hysteria2 URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	q := u.Query()
	pwd := u.User.Username()
	if p2, ok := u.User.Password(); ok && p2 != "" {
		pwd = pwd + ":" + p2
	}
	p := map[string]any{
		"name":     orName(u.Fragment, "hysteria2", u.Hostname(), port),
		"type":     "hysteria2",
		"server":   u.Hostname(),
		"port":     port,
		"password": pwd,
	}
	if sni := q.Get("sni"); sni != "" {
		p["sni"] = sni
	}
	if q.Get("insecure") == "1" || strings.EqualFold(q.Get("insecure"), "true") {
		p["skip-cert-verify"] = true
	}
	if obfs := q.Get("obfs"); obfs != "" {
		p["obfs"] = obfs
		if op := q.Get("obfs-password"); op != "" {
			p["obfs-password"] = op
		}
	}
	if alpn := q.Get("alpn"); alpn != "" {
		p["alpn"] = splitComma(alpn)
	}
	return p, nil
}

// ---- hysteria (v1) ----

func parseHysteria(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("hysteria URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	q := u.Query()
	p := map[string]any{
		"name":   orName(u.Fragment, "hysteria", u.Hostname(), port),
		"type":   "hysteria",
		"server": u.Hostname(),
		"port":   port,
	}
	if auth := q.Get("auth"); auth != "" {
		p["auth-str"] = auth
	}
	if peer := q.Get("peer"); peer != "" {
		p["sni"] = peer
	}
	if q.Get("insecure") == "1" || strings.EqualFold(q.Get("insecure"), "true") {
		p["skip-cert-verify"] = true
	}
	if v := q.Get("upmbps"); v != "" {
		p["up"] = v
	}
	if v := q.Get("downmbps"); v != "" {
		p["down"] = v
	}
	if v := q.Get("protocol"); v != "" {
		p["protocol"] = v
	}
	if obfs := q.Get("obfs"); obfs != "" {
		p["obfs"] = obfs
	}
	if alpn := q.Get("alpn"); alpn != "" {
		p["alpn"] = splitComma(alpn)
	}
	return p, nil
}

// ---- tuic ----

func parseTUIC(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("tuic URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	q := u.Query()
	p := map[string]any{
		"name":   orName(u.Fragment, "tuic", u.Hostname(), port),
		"type":   "tuic",
		"server": u.Hostname(),
		"port":   port,
		"uuid":   u.User.Username(),
	}
	if pw, ok := u.User.Password(); ok {
		p["password"] = pw
	}
	if sni := q.Get("sni"); sni != "" {
		p["sni"] = sni
	}
	if cc := q.Get("congestion_control"); cc != "" {
		p["congestion-controller"] = cc
	}
	if mode := q.Get("udp_relay_mode"); mode != "" {
		p["udp-relay-mode"] = mode
	}
	if alpn := q.Get("alpn"); alpn != "" {
		p["alpn"] = splitComma(alpn)
	}
	if q.Get("allow_insecure") == "1" || strings.EqualFold(q.Get("allow_insecure"), "true") {
		p["skip-cert-verify"] = true
	}
	return p, nil
}

// ---- mieru ----

// parseMieru 解析 mieru 分享链接（mierus:// 或 mieru://）。
// 形如：mierus://<user>:<pass>@host:port?protocol=TCP&multiplexing=MULTIPLEXING_LOW&profile=名称
// 映射到 mihomo 的 mieru 出站字段（type/server/port/transport/username/password/multiplexing/udp）。
// 注意：mihomo mieru 不支持 handshake-mode / mtu，这些参数会被忽略。
func parseMieru(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("mieru URL 无效")
	}
	q := u.Query()
	// 端口：优先取主机端口，缺失则用 query 里的 port。
	portStr := u.Port()
	if portStr == "" {
		portStr = q.Get("port")
	}
	port, err := atoiPort(portStr)
	if err != nil {
		return nil, err
	}
	user := u.User.Username()
	pass, _ := u.User.Password()
	if user == "" || pass == "" {
		return nil, fmt.Errorf("mieru 缺少用户名/密码")
	}
	// 传输协议：链接用 protocol，mihomo 用 transport（只支持 TCP/UDP）。
	transport := strings.ToUpper(strings.TrimSpace(q.Get("protocol")))
	if transport == "" {
		transport = strings.ToUpper(strings.TrimSpace(q.Get("transport")))
	}
	if transport == "" {
		transport = "TCP"
	}
	// 节点名：优先 profile 参数，其次 fragment。
	name := strings.TrimSpace(q.Get("profile"))
	if name == "" {
		name = u.Fragment
	}
	p := map[string]any{
		"name":      orName(name, "mieru", u.Hostname(), port),
		"type":      "mieru",
		"server":    u.Hostname(),
		"port":      port,
		"transport": transport,
		"username":  user,
		"password":  pass,
		"udp":       true,
	}
	if mux := strings.TrimSpace(q.Get("multiplexing")); mux != "" {
		p["multiplexing"] = mux
	}
	return p, nil
}

// ---- socks5 / http ----

func parseSocks(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("socks URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	p := map[string]any{
		"name":   orName(u.Fragment, "socks5", u.Hostname(), port),
		"type":   "socks5",
		"server": u.Hostname(),
		"port":   port,
		"udp":    true,
	}
	if user := u.User.Username(); user != "" {
		p["username"] = user
		if pw, ok := u.User.Password(); ok {
			p["password"] = pw
		}
	}
	return p, nil
}

func parseHTTP(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, fmt.Errorf("http URL 无效")
	}
	port, err := atoiPort(u.Port())
	if err != nil {
		return nil, err
	}
	p := map[string]any{
		"name":   orName(u.Fragment, "http", u.Hostname(), port),
		"type":   "http",
		"server": u.Hostname(),
		"port":   port,
	}
	if strings.EqualFold(u.Scheme, "https") {
		p["tls"] = true
	}
	if user := u.User.Username(); user != "" {
		p["username"] = user
		if pw, ok := u.User.Password(); ok {
			p["password"] = pw
		}
	}
	return p, nil
}

// applyTransport 根据传输层类型补充 ws/grpc/h2/http 的选项。
func applyTransport(p map[string]any, network, host, path, headerType, grpcService string) {
	switch strings.ToLower(network) {
	case "ws":
		p["network"] = "ws"
		ws := map[string]any{}
		if path != "" {
			ws["path"] = path
		}
		if host != "" {
			ws["headers"] = map[string]any{"Host": host}
		}
		if len(ws) > 0 {
			p["ws-opts"] = ws
		}
	case "grpc":
		p["network"] = "grpc"
		svc := grpcService
		if svc == "" {
			svc = path
		}
		if svc != "" {
			p["grpc-opts"] = map[string]any{"grpc-service-name": svc}
		}
	case "h2", "http":
		p["network"] = "h2"
		h2 := map[string]any{}
		if path != "" {
			h2["path"] = path
		}
		if host != "" {
			h2["host"] = splitComma(host)
		}
		if len(h2) > 0 {
			p["h2-opts"] = h2
		}
	}
}

// ---- 工具 ----

func b64decode(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	return base64.StdEncoding.DecodeString(s)
}

func splitFragment(s string) (body, name string) {
	if i := strings.Index(s, "#"); i >= 0 {
		n, err := url.PathUnescape(s[i+1:])
		if err != nil {
			n = s[i+1:]
		}
		return s[:i], strings.TrimSpace(n)
	}
	return s, ""
}

// splitLinks 按换行/空白拆分多条链接。
func splitLinks(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	raw := strings.Split(s, "\n")
	out := make([]string, 0, len(raw))
	for _, r := range raw {
		if t := strings.TrimSpace(r); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func hasScheme(s string) bool {
	return strings.Contains(s, "://")
}

func cut(s, sep string) (string, string) {
	if i := strings.Index(s, sep); i >= 0 {
		return s[:i], s[i+len(sep):]
	}
	return s, ""
}

func splitHostPort(s string) (host, port string) {
	if i := strings.LastIndex(s, ":"); i >= 0 {
		return s[:i], s[i+1:]
	}
	return s, ""
}

func atoiPort(s string) (int, error) {
	s = strings.TrimSpace(s)
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 || n > 65535 {
		return 0, fmt.Errorf("端口无效: %q", s)
	}
	return n, nil
}

func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return n
	}
	return def
}

func toStr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int:
		return strconv.Itoa(x)
	case nil:
		return ""
	default:
		return fmt.Sprint(x)
	}
}

func orStrDef(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func orName(name, typ, host string, port int) string {
	if n := strings.TrimSpace(name); n != "" {
		return n
	}
	return fmt.Sprintf("%s-%s:%d", typ, host, port)
}

func splitComma(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func decodeParam(s string) string {
	if s == "" {
		return ""
	}
	if dec, err := b64decode(s); err == nil {
		return string(dec)
	}
	return s
}

// snippet 为失败链接生成「脱敏摘要」用于错误信息：只保留协议与主机，丢弃
// userinfo（密码/UUID）、query、fragment；当主机仍像高熵密钥（如整段 base64）时
// 用 *** 隐藏，避免把凭据泄漏进错误信息或日志。
func snippet(s string) string {
	s = strings.TrimSpace(s)
	i := strings.Index(s, "://")
	if i < 0 {
		return "***"
	}
	scheme := s[:i+3]
	rest := s[i+3:]
	if j := strings.IndexByte(rest, '#'); j >= 0 {
		rest = rest[:j]
	}
	host := rest
	if at := strings.LastIndex(host, "@"); at >= 0 {
		host = host[at+1:] // 丢弃 userinfo
	}
	if q := strings.IndexByte(host, '?'); q >= 0 {
		host = host[:q]
	}
	if sl := strings.IndexByte(host, '/'); sl >= 0 {
		host = host[:sl]
	}
	return scheme + maskHost(host)
}

// maskHost 仅在 host 看起来像主机名/IP(:port) 时展示，否则用 *** 隐藏。
func maskHost(h string) string {
	h = strings.TrimSpace(h)
	if h != "" && len(h) <= 40 && (strings.Contains(h, ".") || strings.Contains(h, ":")) &&
		!strings.ContainsAny(h, " /=+") {
		return h
	}
	return "***"
}
