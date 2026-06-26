package config

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// DNSPatch 用指针表示「仅修改提供的字段」。
type DNSPatch struct {
	Enable                     *bool
	EnhancedMode               *string
	IPv6                       *bool
	Nameservers                *[]string
	DefaultNameservers         *[]string
	FakeIPFilter               *[]string
	FakeIPFilterMode           *string
	NameserverPolicy           *[]DNSPolicyEntry
	ProxyServerNameserver      *[]string
	DirectNameserver           *[]string
	DirectNameserverFollowRule *bool
	Fallback                   *[]string
	FallbackFilter             *DNSFallbackFilter
	CacheAlgorithm             *string
	RespectRules               *bool
	PreferH3                   *bool
	UseHosts                   *bool
	UseSystemHosts             *bool
	Hosts                      *[]DNSHostEntry
}

// DNSPolicyEntry 是一条域名分流：把匹配 Domain 的查询交给 Servers 解析。
type DNSPolicyEntry struct {
	Domain  string
	Servers []string
}

// DNSFallbackFilter 防污染过滤条件。
type DNSFallbackFilter struct {
	GeoIP     bool
	GeoIPCode string
	GeoSite   []string
	IPCIDR    []string
	Domain    []string
}

// DNSHostEntry 自定义 hosts：把 Domain 解析到固定的一个或多个 IP/CNAME。
type DNSHostEntry struct {
	Domain string
	Values []string
}

// ApplyDNS 把 DNS 相关开关与列表写回 config.yaml。
func ApplyDNS(path string, fields DNSPatch) error {
	return editConfig(path, func(root *yaml.Node) error {
		dns := ensureMap(root, "dns")
		if fields.Enable != nil {
			mapSet(dns, "enable", scalarBool(*fields.Enable))
		}
		if fields.EnhancedMode != nil {
			mapSet(dns, "enhanced-mode", scalarStr(*fields.EnhancedMode))
		}
		if fields.IPv6 != nil {
			mapSet(dns, "ipv6", scalarBool(*fields.IPv6))
		}
		if fields.Nameservers != nil {
			mapSet(dns, "nameserver", seqOf(*fields.Nameservers))
		}
		if fields.DefaultNameservers != nil {
			mapSet(dns, "default-nameserver", seqOf(*fields.DefaultNameservers))
		}
		if fields.FakeIPFilter != nil {
			mapSet(dns, "fake-ip-filter", seqOf(*fields.FakeIPFilter))
		}
		if fields.NameserverPolicy != nil {
			mapSet(dns, "nameserver-policy", policyMapNode(*fields.NameserverPolicy))
		}
		if fields.Fallback != nil {
			mapSet(dns, "fallback", seqOf(*fields.Fallback))
		}
		if fields.FallbackFilter != nil {
			mapSet(dns, "fallback-filter", fallbackFilterNode(*fields.FallbackFilter))
		}
		if fields.CacheAlgorithm != nil {
			mapSet(dns, "cache-algorithm", scalarStr(*fields.CacheAlgorithm))
		}
		if fields.RespectRules != nil {
			mapSet(dns, "respect-rules", scalarBool(*fields.RespectRules))
		}
		if fields.FakeIPFilterMode != nil {
			mapSet(dns, "fake-ip-filter-mode", scalarStr(*fields.FakeIPFilterMode))
		}
		if fields.ProxyServerNameserver != nil {
			mapSet(dns, "proxy-server-nameserver", seqOf(*fields.ProxyServerNameserver))
		}
		if fields.DirectNameserver != nil {
			mapSet(dns, "direct-nameserver", seqOf(*fields.DirectNameserver))
		}
		if fields.DirectNameserverFollowRule != nil {
			mapSet(dns, "direct-nameserver-follow-policy", scalarBool(*fields.DirectNameserverFollowRule))
		}
		if fields.PreferH3 != nil {
			mapSet(dns, "prefer-h3", scalarBool(*fields.PreferH3))
		}
		if fields.UseHosts != nil {
			mapSet(dns, "use-hosts", scalarBool(*fields.UseHosts))
		}
		if fields.UseSystemHosts != nil {
			mapSet(dns, "use-system-hosts", scalarBool(*fields.UseSystemHosts))
		}
		if fields.Hosts != nil {
			// hosts 写在顶层（mihomo 的 hosts 是顶层键，不在 dns 下）。
			mapSet(root, "hosts", hostsMapNode(*fields.Hosts))
		}
		return nil
	})
}

// hostsMapNode 构造顶层 hosts 映射。单值写标量，多值写序列（两者 mihomo 都接受）。
func hostsMapNode(entries []DNSHostEntry) *yaml.Node {
	m := &yaml.Node{Kind: yaml.MappingNode}
	for _, e := range entries {
		dom := strings.TrimSpace(e.Domain)
		vals := make([]string, 0, len(e.Values))
		for _, v := range e.Values {
			if v = strings.TrimSpace(v); v != "" {
				vals = append(vals, v)
			}
		}
		if dom == "" || len(vals) == 0 {
			continue
		}
		if len(vals) == 1 {
			mapSet(m, dom, scalarStr(vals[0]))
		} else {
			mapSet(m, dom, seqOf(vals))
		}
	}
	return m
}

// policyMapNode 按给定顺序构造 nameserver-policy 映射节点（值统一写成序列，mihomo 兼容）。
func policyMapNode(entries []DNSPolicyEntry) *yaml.Node {
	m := &yaml.Node{Kind: yaml.MappingNode}
	for _, e := range entries {
		dom := strings.TrimSpace(e.Domain)
		if dom == "" || len(e.Servers) == 0 {
			continue
		}
		mapSet(m, dom, seqOf(e.Servers))
	}
	return m
}

// fallbackFilterNode 构造 fallback-filter 映射节点。
func fallbackFilterNode(f DNSFallbackFilter) *yaml.Node {
	m := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(m, "geoip", scalarBool(f.GeoIP))
	code := strings.TrimSpace(f.GeoIPCode)
	if code == "" {
		code = "CN"
	}
	mapSet(m, "geoip-code", scalarStr(code))
	if len(f.GeoSite) > 0 {
		mapSet(m, "geosite", seqOf(f.GeoSite))
	}
	if len(f.IPCIDR) > 0 {
		mapSet(m, "ipcidr", seqOf(f.IPCIDR))
	}
	if len(f.Domain) > 0 {
		mapSet(m, "domain", seqOf(f.Domain))
	}
	return m
}

// SetDNSList 设置 dns 下某个字符串列表字段（如 nameserver / default-nameserver / fake-ip-filter）。
func SetDNSList(path, key string, vals []string) error {
	return editConfig(path, func(root *yaml.Node) error {
		dns := ensureMap(root, "dns")
		mapSet(dns, key, seqOf(vals))
		return nil
	})
}
