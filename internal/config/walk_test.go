package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// TestRemoveRulePrefix 验证：面板传入不含尾部选项的规则文本，
// 也能删掉 config 里带 no-resolve 等选项的同一条规则。
func TestRemoveRulePrefix(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "mode: rule\nrules:\n  - GEOIP,CN,DIRECT,no-resolve\n  - DOMAIN-SUFFIX,openai.com,PROXY\n  - MATCH,PROXY\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := RemoveRule(p, "GEOIP,CN,DIRECT"); err != nil {
		t.Fatal(err)
	}
	out, _ := os.ReadFile(p)
	if strings.Contains(string(out), "GEOIP,CN,DIRECT") {
		t.Fatalf("带选项的规则未被删除:\n%s", out)
	}
	if !strings.Contains(string(out), "DOMAIN-SUFFIX,openai.com,PROXY") {
		t.Fatalf("误删了其它规则:\n%s", out)
	}
	if !strings.Contains(string(out), "MATCH,PROXY") {
		t.Fatalf("误删了 MATCH:\n%s", out)
	}
}

// TestAddProxyProviderInjectsGroups 验证订阅注入后：provider 写入 +
// 含 use 的策略组都被追加该 provider，且重复注入不产生重复项。
func TestAddProxyProviderInjectsGroups(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "proxy-groups:\n  - name: PROXY\n    type: select\n    use:\n      - sub1\n  - name: AUTO\n    type: url-test\n    use:\n      - sub1\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AddProxyProvider(p, "airport", "https://x/y", "./providers/airport.yaml", 86400); err != nil {
		t.Fatal(err)
	}
	// 再注入一次（幂等）。
	if err := AddProxyProvider(p, "airport", "https://x/y", "./providers/airport.yaml", 86400); err != nil {
		t.Fatal(err)
	}
	out, _ := os.ReadFile(p)
	body := string(out)
	if !strings.Contains(body, "proxy-providers:") || !strings.Contains(body, "airport:") {
		t.Fatalf("provider 未写入:\n%s", body)
	}
	if strings.Count(body, "- airport") != 2 {
		t.Fatalf("airport 应被加进 2 个 use 组各一次（共2），实际:\n%s", body)
	}
}

// TestAddProxyProviderCreatesUse 验证：默认配置形态（节点组只有 proxies、没有 use）
// 添加订阅时，会为「真正承载节点的组」自动创建 use 并注入 provider；而「全球直连」这类
// 仅含 DIRECT 的兜底组不应被注入。
func TestAddProxyProviderCreatesUse(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "proxy-groups:\n" +
		"  - name: 节点选择\n    type: select\n    proxies:\n      - 全球直连\n" +
		"  - name: 全球直连\n    type: select\n    proxies:\n      - DIRECT\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AddProxyProvider(p, "test", "https://x/y", "./providers/test.yaml", 86400); err != nil {
		t.Fatal(err)
	}
	out, _ := os.ReadFile(p)
	body := string(out)
	if !strings.Contains(body, "proxy-providers:") || !strings.Contains(body, "test:") {
		t.Fatalf("provider 未写入:\n%s", body)
	}
	// 仅「节点选择」应创建 use 并加入 test（1 处）；「全球直连」不应被污染。
	if strings.Count(body, "- test") != 1 {
		t.Fatalf("应仅为「节点选择」创建 use 并加入 test（共1），实际:\n%s", body)
	}
}

// TestApplyRecommendedTemplate 验证推荐模板：生成的配置可被解析、含关键策略组、
// 订阅 provider 被 use 引用、规则被替换为推荐集。
func TestApplyRecommendedTemplate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "mode: rule\n" +
		"proxy-providers:\n  test:\n    type: http\n    url: https://x/y\n    path: ./providers/test.yaml\n    interval: 86400\n" +
		"proxy-groups:\n  - name: OLD\n    type: select\n    proxies: [DIRECT]\n" +
		"rules:\n  - MATCH,OLD\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	// 传入含香港/美国的节点名：应生成香港、美国地区组。
	nodeNames := []string{"🇭🇰 香港 01", "🇭🇰 香港 02", "🇺🇸 美国 LA01"}
	if err := ApplyRecommendedTemplate(p, []string{"test"}, nodeNames); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMihomo(p); err != nil {
		t.Fatalf("生成的配置无法解析: %v", err)
	}
	body, _ := os.ReadFile(p)
	s := string(body)
	for _, g := range []string{"🚀 手动选择", "♻️ 自动选择", "🇭🇰 香港节点", "🇺🇸 美国节点", "🤖 AI", "🎯 全球直连"} {
		if !strings.Contains(s, g) {
			t.Fatalf("缺少策略组 %s:\n%s", g, s)
		}
	}
	if !strings.Contains(s, "- test") {
		t.Fatalf("provider 未被 use 引用:\n%s", s)
	}
	if !strings.Contains(s, "GEOSITE,category-ads-all,REJECT") {
		t.Fatalf("推荐规则未写入:\n%s", s)
	}
	if strings.Contains(s, "MATCH,OLD") {
		t.Fatalf("旧规则未被替换:\n%s", s)
	}
}

// TestApplyTemplateRegionFilter 验证：只为订阅里确有匹配节点的地区生成地区组，
// 没有节点的地区不生成空组（mihomo 空组会退化为 COMPATIBLE）。
func TestApplyTemplateRegionFilter(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "mode: rule\n" +
		"proxy-providers:\n  test:\n    type: http\n    url: https://x/y\n    path: ./providers/test.yaml\n    interval: 86400\n" +
		"proxy-groups:\n  - name: OLD\n    type: select\n    proxies: [DIRECT]\n" +
		"rules:\n  - MATCH,OLD\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	// 只有美国 / 日本节点，没有港/新/台/韩。
	nodeNames := []string{"美国＝三网优化01", "美国＝三网优化02", "日本＝无界总固"}
	if err := ApplyRecommendedTemplate(p, []string{"test"}, nodeNames); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMihomo(p); err != nil {
		t.Fatalf("生成的配置无法解析: %v", err)
	}
	s := string(mustRead(t, p))
	for _, g := range []string{"🇺🇸 美国节点", "🇯🇵 日本节点"} {
		if !strings.Contains(s, g) {
			t.Fatalf("应生成有节点的地区组 %s:\n%s", g, s)
		}
	}
	for _, g := range []string{"🇭🇰 香港节点", "🇸🇬 新加坡节点", "🇹🇼 台湾节点", "🇰🇷 韩国节点"} {
		if strings.Contains(s, g) {
			t.Fatalf("不该生成无节点的地区组 %s:\n%s", g, s)
		}
	}
}

// TestApplyTemplateNoNodeNames 验证：没有节点名（provider 文件读不到）时退化为
// 「仅自动选择、无地区分桶」，不生成任何空地区组，且配置仍可解析。
func TestApplyTemplateNoNodeNames(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "mode: rule\nproxy-groups:\n  - name: OLD\n    type: select\n    proxies: [DIRECT]\nrules:\n  - MATCH,OLD\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ApplyRecommendedTemplate(p, []string{"test"}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMihomo(p); err != nil {
		t.Fatalf("生成的配置无法解析: %v", err)
	}
	s := string(mustRead(t, p))
	if !strings.Contains(s, "♻️ 自动选择") || !strings.Contains(s, "🚀 手动选择") {
		t.Fatalf("应保留自动/手动选择组:\n%s", s)
	}
	for _, g := range []string{"🇭🇰 香港节点", "🇺🇸 美国节点", "🇯🇵 日本节点"} {
		if strings.Contains(s, g) {
			t.Fatalf("无节点名时不该生成地区组 %s:\n%s", g, s)
		}
	}
}

// TestIsTemplatePending 验证「节点感知策略未生成」的识别：
// 全 select 的默认布局算 pending；一旦含 url-test 组则不算（不再自动改写）。
func TestIsTemplatePending(t *testing.T) {
	dir := t.TempDir()
	basic := filepath.Join(dir, "basic.yaml")
	if err := os.WriteFile(basic, []byte("proxy-groups:\n  - name: 🚀 手动选择\n    type: select\n    proxies: [🎯 全球直连]\n  - name: 🎯 全球直连\n    type: select\n    proxies: [DIRECT]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsTemplatePending(basic) {
		t.Fatal("全 select 的默认布局应判定为 pending")
	}
	applied := filepath.Join(dir, "applied.yaml")
	if err := os.WriteFile(applied, []byte("proxy-groups:\n  - name: 🚀 手动选择\n    type: select\n    proxies: [DIRECT]\n  - name: 🇭🇰 香港节点\n    type: url-test\n    use: [test]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsTemplatePending(applied) {
		t.Fatal("已含 url-test 组的配置不应判定为 pending")
	}
	none := filepath.Join(dir, "none.yaml")
	if err := os.WriteFile(none, []byte("mode: rule\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsTemplatePending(none) {
		t.Fatal("无 proxy-groups 应保守判定为非 pending（不自动改）")
	}
}

// TestDefaultConfigValid 验证内嵌默认配置：可解析、处于 pending（全 select、无 url-test）、
// 且所有规则目标 / 策略组成员引用都指向已定义的组或内置出站（不漏组、不写错名）。
func TestDefaultConfigValid(t *testing.T) {
	raw := DefaultConfigYAML()
	if len(raw) == 0 {
		t.Fatal("内嵌默认配置为空")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(p, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMihomo(p); err != nil {
		t.Fatalf("默认配置无法解析: %v", err)
	}
	if !IsTemplatePending(p) {
		t.Fatal("默认配置应处于 pending（全 select、无 url-test 组），以便加订阅时自动补齐")
	}

	var doc struct {
		ProxyGroups []struct {
			Name    string   `yaml:"name"`
			Type    string   `yaml:"type"`
			Proxies []string `yaml:"proxies"`
			Use     []string `yaml:"use"`
		} `yaml:"proxy-groups"`
		Rules []string `yaml:"rules"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	builtin := map[string]bool{"DIRECT": true, "REJECT": true, "REJECT-DROP": true, "PASS": true, "COMPATIBLE": true, "GLOBAL": true}
	groups := map[string]bool{}
	for _, g := range doc.ProxyGroups {
		groups[g.Name] = true
	}
	// 每个组的 proxies 成员必须是已定义组或内置出站（默认无内联节点）。
	for _, g := range doc.ProxyGroups {
		for _, m := range g.Proxies {
			if !groups[m] && !builtin[m] {
				t.Fatalf("策略组 %q 引用了未定义的成员 %q", g.Name, m)
			}
		}
	}
	// 每条规则的目标组必须存在（MATCH 取第 2 段，其余取第 3 段；尾部 no-resolve 等忽略）。
	for _, r := range doc.Rules {
		parts := strings.Split(r, ",")
		if len(parts) < 2 {
			t.Fatalf("规则格式异常: %q", r)
		}
		var target string
		if strings.EqualFold(strings.TrimSpace(parts[0]), "MATCH") {
			target = strings.TrimSpace(parts[1])
		} else {
			if len(parts) < 3 {
				t.Fatalf("规则缺少目标: %q", r)
			}
			target = strings.TrimSpace(parts[2])
		}
		if !groups[target] && !builtin[target] {
			t.Fatalf("规则 %q 的目标组 %q 未定义", r, target)
		}
	}
}

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestSetExcludeCidrRoundTrip 验证排除网段替换 + 读回。
func TestSetExcludeCidrRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "rules:\n  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve\n  - GEOSITE,cn,DIRECT\n  - MATCH,PROXY\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SetExcludeCidr(p, []string{"10.0.0.0/8", "172.16.0.0/12"}); err != nil {
		t.Fatal(err)
	}
	mc, err := LoadMihomo(p)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range mc.Rules {
		got[r] = true
	}
	if !got["IP-CIDR,10.0.0.0/8,DIRECT,no-resolve"] || !got["IP-CIDR,172.16.0.0/12,DIRECT,no-resolve"] {
		t.Fatalf("新排除网段未写入: %v", mc.Rules)
	}
	if got["IP-CIDR,192.168.0.0/16,DIRECT,no-resolve"] {
		t.Fatalf("旧排除网段未被替换: %v", mc.Rules)
	}
	if !got["GEOSITE,cn,DIRECT"] || !got["MATCH,PROXY"] {
		t.Fatalf("非排除规则被误删: %v", mc.Rules)
	}
}

// TestRuleProviderRoundTrip 验证规则集订阅：写入 rule-providers + RULE-SET 规则
// 插到 MATCH 之前；删除时连同 RULE-SET 规则一并移除，且不误伤其它规则。
func TestRuleProviderRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "rules:\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AddRuleProvider(p, "reject-ad", "https://x/y.yaml", "domain", "yaml", "REJECT", "./rule-providers/reject-ad.yaml", 86400); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(p)
	if !strings.Contains(string(body), "rule-providers:") || !strings.Contains(string(body), "reject-ad:") {
		t.Fatalf("rule-provider 未写入:\n%s", body)
	}
	iRS := strings.Index(string(body), "RULE-SET,reject-ad,REJECT")
	iMatch := strings.Index(string(body), "MATCH,PROXY")
	if iRS < 0 || iMatch < 0 || iRS > iMatch {
		t.Fatalf("RULE-SET 未插到 MATCH 之前:\n%s", body)
	}
	if err := RemoveRuleProvider(p, "reject-ad"); err != nil {
		t.Fatal(err)
	}
	body2, _ := os.ReadFile(p)
	if strings.Contains(string(body2), "reject-ad") {
		t.Fatalf("删除后仍残留 reject-ad:\n%s", body2)
	}
	if !strings.Contains(string(body2), "MATCH,PROXY") || !strings.Contains(string(body2), "GEOIP,CN,DIRECT") {
		t.Fatalf("误删了其它规则:\n%s", body2)
	}
}

// TestApplyDNSRoundTrip 验证 DNS 列表/模式写回后能读回，且保留注释。
func TestApplyDNSRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "# 顶部注释\nmode: rule\ndns:\n  enable: true\n  enhanced-mode: redir-host  # 行内注释\n  nameserver:\n    - 223.5.5.5\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	mode := "fake-ip"
	ns := []string{"https://1.1.1.1/dns-query", "https://dns.google/dns-query"}
	if err := ApplyDNS(p, DNSPatch{EnhancedMode: &mode, Nameservers: &ns}); err != nil {
		t.Fatal(err)
	}
	mc, err := LoadMihomo(p)
	if err != nil {
		t.Fatal(err)
	}
	if mc.DNS.EnhancedMode != "fake-ip" {
		t.Fatalf("enhanced-mode 未写回: %q", mc.DNS.EnhancedMode)
	}
	if len(mc.DNS.Nameserver) != 2 || mc.DNS.Nameserver[0] != "https://1.1.1.1/dns-query" {
		t.Fatalf("nameserver 列表未替换: %v", mc.DNS.Nameserver)
	}
	out, _ := os.ReadFile(p)
	if !strings.Contains(string(out), "# 顶部注释") {
		t.Fatalf("顶部注释丢失:\n%s", out)
	}
}

// TestAddRuleBeforeMatch 验证新规则插到 MATCH 之前。
func TestAddRuleBeforeMatch(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	src := "mode: rule\nrules:\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n"
	if err := os.WriteFile(p, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AddRule(p, "DOMAIN-SUFFIX,test.com,DIRECT"); err != nil {
		t.Fatal(err)
	}
	out, _ := os.ReadFile(p)
	body := string(out)
	iNew := strings.Index(body, "test.com")
	iMatch := strings.Index(body, "MATCH,PROXY")
	if iNew < 0 || iMatch < 0 || iNew > iMatch {
		t.Fatalf("新规则未插到 MATCH 之前:\n%s", body)
	}
}
