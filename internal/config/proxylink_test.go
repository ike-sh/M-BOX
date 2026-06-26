package config

import (
	"encoding/base64"
	"os"
	"testing"

	"gopkg.in/yaml.v3"
)

func mustParse(t *testing.T, link string) map[string]any {
	t.Helper()
	p, err := ParseProxyLink(link)
	if err != nil {
		t.Fatalf("解析失败 %q: %v", link, err)
	}
	return p
}

func TestParseSS_SIP002(t *testing.T) {
	// base64(method:password)@host:port
	ui := base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secretpass"))
	p := mustParse(t, "ss://"+ui+"@1.2.3.4:8388#香港节点")
	if p["type"] != "ss" || p["server"] != "1.2.3.4" || p["port"].(int) != 8388 {
		t.Fatalf("ss 字段错误: %+v", p)
	}
	if p["cipher"] != "aes-256-gcm" || p["password"] != "secretpass" {
		t.Fatalf("ss 加密/密码错误: %+v", p)
	}
	if p["name"] != "香港节点" {
		t.Fatalf("ss 名称错误: %v", p["name"])
	}
}

func TestParseVMess(t *testing.T) {
	js := `{"v":"2","ps":"东京01","add":"jp.example.com","port":"443","id":"a-uuid","aid":"0","scy":"auto","net":"ws","host":"jp.example.com","path":"/path","tls":"tls","sni":"jp.example.com"}`
	link := "vmess://" + base64.StdEncoding.EncodeToString([]byte(js))
	p := mustParse(t, link)
	if p["type"] != "vmess" || p["server"] != "jp.example.com" || p["port"].(int) != 443 {
		t.Fatalf("vmess 基本字段错误: %+v", p)
	}
	if p["uuid"] != "a-uuid" || p["network"] != "ws" {
		t.Fatalf("vmess uuid/network 错误: %+v", p)
	}
	if p["tls"] != true || p["servername"] != "jp.example.com" {
		t.Fatalf("vmess tls 错误: %+v", p)
	}
	ws, ok := p["ws-opts"].(map[string]any)
	if !ok || ws["path"] != "/path" {
		t.Fatalf("vmess ws-opts 错误: %+v", p["ws-opts"])
	}
}

func TestParseVLESS_Reality(t *testing.T) {
	link := "vless://uuid-1@a.com:443?security=reality&type=grpc&serviceName=gsvc&pbk=PUBKEY&sid=ab12&fp=chrome&flow=xtls-rprx-vision#美国"
	p := mustParse(t, link)
	if p["type"] != "vless" || p["uuid"] != "uuid-1" || p["port"].(int) != 443 {
		t.Fatalf("vless 基本字段错误: %+v", p)
	}
	if p["flow"] != "xtls-rprx-vision" || p["network"] != "grpc" {
		t.Fatalf("vless flow/network 错误: %+v", p)
	}
	ro, ok := p["reality-opts"].(map[string]any)
	if !ok || ro["public-key"] != "PUBKEY" || ro["short-id"] != "ab12" {
		t.Fatalf("vless reality-opts 错误: %+v", p["reality-opts"])
	}
	grpc, ok := p["grpc-opts"].(map[string]any)
	if !ok || grpc["grpc-service-name"] != "gsvc" {
		t.Fatalf("vless grpc-opts 错误: %+v", p["grpc-opts"])
	}
}

func TestParseTrojan(t *testing.T) {
	p := mustParse(t, "trojan://pass123@t.com:443?sni=t.com&allowInsecure=1#香港")
	if p["type"] != "trojan" || p["password"] != "pass123" || p["sni"] != "t.com" {
		t.Fatalf("trojan 字段错误: %+v", p)
	}
	if p["skip-cert-verify"] != true {
		t.Fatalf("trojan skip-cert-verify 错误: %+v", p)
	}
}

func TestParseHysteria2(t *testing.T) {
	p := mustParse(t, "hysteria2://pw@h2.com:8443?sni=h2.com&insecure=1&obfs=salamander&obfs-password=op#hy2")
	if p["type"] != "hysteria2" || p["password"] != "pw" || p["port"].(int) != 8443 {
		t.Fatalf("hysteria2 字段错误: %+v", p)
	}
	if p["obfs"] != "salamander" || p["obfs-password"] != "op" || p["skip-cert-verify"] != true {
		t.Fatalf("hysteria2 obfs 错误: %+v", p)
	}
}

func TestParseTUIC(t *testing.T) {
	p := mustParse(t, "tuic://uuid-x:passw@tu.com:443?congestion_control=bbr&alpn=h3&sni=tu.com#tuic")
	if p["type"] != "tuic" || p["uuid"] != "uuid-x" || p["password"] != "passw" {
		t.Fatalf("tuic 字段错误: %+v", p)
	}
	if p["congestion-controller"] != "bbr" {
		t.Fatalf("tuic cc 错误: %+v", p)
	}
}

func TestParseMieru(t *testing.T) {
	link := "mierus://kM7zOCNYie:ZJUV0r5oPc@211.136.162.190:3599?handshake-mode=HANDSHAKE_STANDARD&mtu=1400&multiplexing=MULTIPLEXING_LOW&port=3599&profile=🇯🇵沪日✦IPLC&protocol=TCP"
	p := mustParse(t, link)
	if p["type"] != "mieru" || p["server"] != "211.136.162.190" || p["port"].(int) != 3599 {
		t.Fatalf("mieru 基本字段错误: %+v", p)
	}
	if p["username"] != "kM7zOCNYie" || p["password"] != "ZJUV0r5oPc" {
		t.Fatalf("mieru 用户名/密码错误: %+v", p)
	}
	if p["transport"] != "TCP" || p["multiplexing"] != "MULTIPLEXING_LOW" {
		t.Fatalf("mieru transport/multiplexing 错误: %+v", p)
	}
	if p["name"] != "🇯🇵沪日✦IPLC" {
		t.Fatalf("mieru 名称错误: %v", p["name"])
	}
	// 不应包含 mihomo 不支持的字段。
	if _, ok := p["handshake-mode"]; ok {
		t.Fatalf("不应写入 handshake-mode: %+v", p)
	}
}

func TestParseMultiAndBase64(t *testing.T) {
	raw := "trojan://p@a.com:443#A\nss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-128-gcm:x")) + "@b.com:8388#B"
	// 整段 base64
	enc := base64.StdEncoding.EncodeToString([]byte(raw))
	res := ParseProxyLinks(enc)
	if len(res.Proxies) != 2 {
		t.Fatalf("期望解析 2 个节点，实际 %d，errors=%v", len(res.Proxies), res.Errors)
	}
}

func TestParseProxyLinksDedup(t *testing.T) {
	// 同一节点(同 server/port/password)出现两次，仅名称不同：应去重为 1 个。
	raw := "trojan://pass@a.com:443#节点A\ntrojan://pass@a.com:443#节点A-别名\nss://" +
		base64.RawURLEncoding.EncodeToString([]byte("aes-128-gcm:x")) + "@b.com:8388#B"
	res := ParseProxyLinks(raw)
	if len(res.Proxies) != 2 {
		t.Fatalf("期望去重后 2 个节点，实际 %d", len(res.Proxies))
	}
}

func TestAddInlineProxiesDedupExisting(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/config.yaml"
	initial := "proxies:\n  - {name: 老节点, type: trojan, server: a.com, port: 443, password: p}\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies: [DIRECT]\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}
	// 第一个与已有节点指纹相同(仅名称不同)→应跳过；第二个是新节点→应写入。
	added, err := AddInlineProxies(path, []map[string]any{
		{"name": "重复节点", "type": "trojan", "server": "a.com", "port": 443, "password": "p"},
		{"name": "新节点", "type": "ss", "server": "c.com", "port": 8388, "cipher": "aes-128-gcm", "password": "y"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 1 || added[0] != "新节点" {
		t.Fatalf("应仅写入新节点，实际 added=%v", added)
	}
}

func TestAddInlineProxiesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/config.yaml"
	initial := "mode: rule\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,PROXY\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}
	added, err := AddInlineProxies(path, []map[string]any{
		{"name": "节点", "type": "trojan", "server": "a.com", "port": 443, "password": "p"},
		{"name": "节点", "type": "ss", "server": "b.com", "port": 8388, "cipher": "aes-128-gcm", "password": "x"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 2 || added[0] != "节点" || added[1] != "节点-2" {
		t.Fatalf("去重命名错误: %v", added)
	}
	// 验证能被 mihomo 解析器读回。
	mc, err := LoadMihomo(path)
	if err != nil {
		t.Fatal(err)
	}
	if mc.Mode != "rule" {
		t.Fatalf("mode 丢失: %+v", mc)
	}
	// 验证设备规则不在此处；这里只校验 proxies 数量与策略组引用。
	var doc struct {
		Proxies     []map[string]any `yaml:"proxies"`
		ProxyGroups []struct {
			Name    string   `yaml:"name"`
			Proxies []string `yaml:"proxies"`
		} `yaml:"proxy-groups"`
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Proxies) != 2 {
		t.Fatalf("proxies 数量错误: %d", len(doc.Proxies))
	}
	// PROXY 组应已追加两个节点（原本只有 DIRECT）。
	if len(doc.ProxyGroups) != 1 || len(doc.ProxyGroups[0].Proxies) != 3 {
		t.Fatalf("策略组引用错误: %+v", doc.ProxyGroups)
	}
}
