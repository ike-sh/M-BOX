package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/mbox/mbox/internal/config"
)

func (s *Server) handleDNS(w http.ResponseWriter, r *http.Request) {
	mc, err := config.LoadMihomo(s.cfg.ConfigPath())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	policy, adBlock := dnsPolicyEntries(mc.DNS.NameserverPolicyOrdered())
	ff := mc.DNS.FallbackFilter
	writeJSON(w, http.StatusOK, DnsConfig{
		Enable:                     mc.DNS.Enable,
		EnhancedMode:               orStr(mc.DNS.EnhancedMode, "fake-ip"),
		FakeIPRange:                mc.DNS.FakeIPRange,
		Listen:                     mc.DNS.Listen,
		IPv6:                       mc.DNS.IPv6,
		Nameservers:                nilSafe(mc.DNS.Nameserver),
		DefaultNameservers:         nilSafe(mc.DNS.Default),
		FakeIPFilter:               nilSafe(mc.DNS.FakeIPFilter),
		FakeIPFilterMode:           orStr(mc.DNS.FakeIPFilterMode, "blacklist"),
		NameserverPolicy:           policy,
		ProxyServerNameserver:      nilSafe(mc.DNS.ProxyServerNameserver),
		DirectNameserver:           nilSafe(mc.DNS.DirectNameserver),
		DirectNameserverFollowRule: mc.DNS.DirectNameserverFollowRule,
		Fallback:                   nilSafe(mc.DNS.Fallback),
		FallbackFilter: DnsFallbackFilter{
			GeoIP:     ff.GeoIP,
			GeoIPCode: orStr(ff.GeoIPCode, "CN"),
			GeoSite:   nilSafe(ff.GeoSite),
			IPCIDR:    nilSafe(ff.IPCIDR),
			Domain:    nilSafe(ff.Domain),
		},
		CacheAlgorithm: orStr(mc.DNS.CacheAlgorithm, "lru"),
		RespectRules:   mc.DNS.RespectRules,
		AdBlock:        adBlock,
		PreferH3:       mc.DNS.PreferH3,
		UseHosts:       mc.DNS.UseHosts,
		UseSystemHosts: mc.DNS.UseSystemHosts,
		Hosts:          dnsHostEntries(mc.Hosts),
	})
}

// dnsHostEntries 把顶层 hosts 映射转为有序条目列表。
func dnsHostEntries(m map[string]any) []DnsHostEntry {
	entries := []DnsHostEntry{}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		vals := toStringSlice(m[k])
		if len(vals) == 0 {
			continue
		}
		entries = append(entries, DnsHostEntry{Domain: k, Values: vals})
	}
	return entries
}

// dnsAdBlockKey/Val 用 nameserver-policy 在 DNS 层拦截广告域名（借鉴 MosDNS 的 reject）。
const (
	dnsAdBlockKey = "geosite:category-ads-all"
	dnsAdBlockVal = "rcode://success"
)

// dnsPolicyEntries 把 mihomo 的 nameserver-policy（已按配置顺序解析）转成有序条目列表；
// 同时识别去广告条目（geosite:category-ads-all -> rcode），从列表剔除并返回 adBlock=true。
// 保留原始顺序——nameserver-policy 在 mihomo 里按顺序匹配，不能按字母重排。
func dnsPolicyEntries(policies []config.PolicyKV) ([]DnsPolicyEntry, bool) {
	entries := []DnsPolicyEntry{}
	adBlock := false
	for _, p := range policies {
		if p.Key == dnsAdBlockKey {
			for _, srv := range p.Servers {
				if strings.HasPrefix(srv, "rcode://") {
					adBlock = true
				}
			}
			if adBlock {
				continue
			}
		}
		if len(p.Servers) == 0 {
			continue
		}
		entries = append(entries, DnsPolicyEntry{Domain: p.Key, Servers: p.Servers})
	}
	return entries, adBlock
}

// toStringSlice 把 yaml 解析出的 any（string 或 []any）规整为 []string。
func toStringSlice(v any) []string {
	switch t := v.(type) {
	case string:
		if t == "" {
			return nil
		}
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if str, ok := e.(string); ok && str != "" {
				out = append(out, str)
			}
		}
		return out
	case []string:
		return t
	default:
		return nil
	}
}

func (s *Server) handleApplyDNS(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable             *bool     `json:"enable"`
		EnhancedMode       *string   `json:"enhancedMode"`
		IPv6               *bool     `json:"ipv6"`
		Nameservers        *[]string `json:"nameservers"`
		DefaultNameservers *[]string `json:"defaultNameservers"`
		FakeIPFilter       *[]string `json:"fakeIpFilter"`
		FakeIPFilterMode   *string   `json:"fakeIpFilterMode"`
		NameserverPolicy   *[]struct {
			Domain  string   `json:"domain"`
			Servers []string `json:"servers"`
		} `json:"nameserverPolicy"`
		ProxyServerNameserver      *[]string `json:"proxyServerNameserver"`
		DirectNameserver           *[]string `json:"directNameserver"`
		DirectNameserverFollowRule *bool     `json:"directNameserverFollowRule"`
		Fallback                   *[]string `json:"fallback"`
		FallbackFilter             *struct {
			GeoIP     bool     `json:"geoip"`
			GeoIPCode string   `json:"geoipCode"`
			GeoSite   []string `json:"geosite"`
			IPCIDR    []string `json:"ipcidr"`
			Domain    []string `json:"domain"`
		} `json:"fallbackFilter"`
		CacheAlgorithm *string `json:"cacheAlgorithm"`
		RespectRules   *bool   `json:"respectRules"`
		AdBlock        *bool   `json:"adBlock"`
		PreferH3       *bool   `json:"preferH3"`
		UseHosts       *bool   `json:"useHosts"`
		UseSystemHosts *bool   `json:"useSystemHosts"`
		Hosts          *[]struct {
			Domain string   `json:"domain"`
			Values []string `json:"values"`
		} `json:"hosts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}

	patch := config.DNSPatch{
		Enable:                     body.Enable,
		EnhancedMode:               body.EnhancedMode,
		IPv6:                       body.IPv6,
		Nameservers:                body.Nameservers,
		DefaultNameservers:         body.DefaultNameservers,
		FakeIPFilter:               body.FakeIPFilter,
		FakeIPFilterMode:           body.FakeIPFilterMode,
		ProxyServerNameserver:      body.ProxyServerNameserver,
		DirectNameserver:           body.DirectNameserver,
		DirectNameserverFollowRule: body.DirectNameserverFollowRule,
		Fallback:                   body.Fallback,
		CacheAlgorithm:             body.CacheAlgorithm,
		RespectRules:               body.RespectRules,
		PreferH3:                   body.PreferH3,
		UseHosts:                   body.UseHosts,
		UseSystemHosts:             body.UseSystemHosts,
	}
	if body.Hosts != nil {
		hosts := make([]config.DNSHostEntry, 0, len(*body.Hosts))
		for _, h := range *body.Hosts {
			hosts = append(hosts, config.DNSHostEntry{Domain: h.Domain, Values: h.Values})
		}
		patch.Hosts = &hosts
	}
	// 域名分流 + 去广告（去广告条目以 nameserver-policy 形式合并写入）。
	if body.NameserverPolicy != nil || body.AdBlock != nil {
		entries := []config.DNSPolicyEntry{}
		if body.AdBlock != nil && *body.AdBlock {
			entries = append(entries, config.DNSPolicyEntry{Domain: dnsAdBlockKey, Servers: []string{dnsAdBlockVal}})
		}
		if body.NameserverPolicy != nil {
			for _, e := range *body.NameserverPolicy {
				if e.Domain == dnsAdBlockKey {
					continue // 去广告条目由 AdBlock 开关统一管理
				}
				entries = append(entries, config.DNSPolicyEntry{Domain: e.Domain, Servers: e.Servers})
			}
		}
		patch.NameserverPolicy = &entries
	}
	if body.FallbackFilter != nil {
		patch.FallbackFilter = &config.DNSFallbackFilter{
			GeoIP:     body.FallbackFilter.GeoIP,
			GeoIPCode: body.FallbackFilter.GeoIPCode,
			GeoSite:   body.FallbackFilter.GeoSite,
			IPCIDR:    body.FallbackFilter.IPCIDR,
			Domain:    body.FallbackFilter.Domain,
		}
	}

	s.cfgMu.Lock()
	err := config.ApplyDNS(s.cfg.ConfigPath(), patch)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	s.handleDNS(w, r) // 返回最新 DNS 配置
}

// handleDnsQuery 通过 mihomo 控制器实时解析一个域名，回显命中的上游与结果，
// 便于在 UI 内自测分流/防污染是否生效（MosDNS 无此 UI，是我们的差异化能力）。
func (s *Server) handleDnsQuery(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		writeErr(w, http.StatusBadRequest, "请提供要解析的域名 name")
		return
	}
	qtype := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("type")))
	if qtype == "" {
		qtype = "A"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	raw, err := s.client.GetRaw(ctx, "/dns/query?name="+url.QueryEscape(name)+"&type="+url.QueryEscape(qtype))
	if err != nil {
		writeErr(w, http.StatusBadGateway, "解析失败（内核未运行或 DNS 未启用）："+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}
