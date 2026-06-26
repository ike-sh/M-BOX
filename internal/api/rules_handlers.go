package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/config"
)

// mihomoTypeToConfig 把 mihomo 运行态 /rules 上报的规则类型（PascalCase 无连字符，
// 如 DstPort/IPCIDR）映射回 clash/mihomo 配置文件里使用的关键字（带连字符，如
// DST-PORT/IP-CIDR）。这样面板显示与 config.yaml 一致，且"编辑/删除"按显示文本
// 回写时能精确匹配到配置里的规则（否则 DSTPORT 匹配不到 DST-PORT，编辑无效）。
var mihomoTypeToConfig = map[string]string{
	"DOMAIN": "DOMAIN", "DOMAINSUFFIX": "DOMAIN-SUFFIX", "DOMAINKEYWORD": "DOMAIN-KEYWORD",
	"DOMAINREGEX": "DOMAIN-REGEX", "GEOSITE": "GEOSITE", "GEOIP": "GEOIP", "SRCGEOIP": "SRC-GEOIP",
	"IPASN": "IP-ASN", "SRCIPASN": "SRC-IP-ASN", "IPCIDR": "IP-CIDR", "IPCIDR6": "IP-CIDR6",
	"SRCIPCIDR": "SRC-IP-CIDR", "IPSUFFIX": "IP-SUFFIX", "SRCIPSUFFIX": "SRC-IP-SUFFIX",
	"SRCPORT": "SRC-PORT", "DSTPORT": "DST-PORT", "INPORT": "IN-PORT", "INUSER": "IN-USER",
	"INNAME": "IN-NAME", "INTYPE": "IN-TYPE", "DSCP": "DSCP", "PROCESS": "PROCESS-NAME",
	"PROCESSNAME": "PROCESS-NAME", "PROCESSPATH": "PROCESS-PATH",
	"PROCESSNAMEREGEX": "PROCESS-NAME-REGEX", "PROCESSPATHREGEX": "PROCESS-PATH-REGEX",
	"RULESET": "RULE-SET", "NETWORK": "NETWORK", "UID": "UID", "MATCH": "MATCH",
	"AND": "AND", "OR": "OR", "NOT": "NOT", "SUBRULE": "SUB-RULE",
}

// canonicalRuleType 规范化 mihomo 上报的规则类型为配置关键字。未知类型原样大写返回。
func canonicalRuleType(t string) string {
	u := strings.ToUpper(strings.TrimSpace(t))
	if c, ok := mihomoTypeToConfig[strings.ReplaceAll(u, "-", "")]; ok {
		return c
	}
	return u
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	resp := RulesResp{Rules: []RuleItem{}, Providers: []RuleProvider{}}

	if raw, err := s.client.GetRaw(ctx, "/rules"); err == nil {
		var rr struct {
			Rules []struct {
				Type    string `json:"type"`
				Payload string `json:"payload"`
				Proxy   string `json:"proxy"`
			} `json:"rules"`
		}
		if json.Unmarshal(raw, &rr) == nil {
			for _, x := range rr.Rules {
				resp.Rules = append(resp.Rules, RuleItem{
					Type:    canonicalRuleType(x.Type),
					Payload: x.Payload,
					Target:  x.Proxy,
				})
			}
		}
	}

	if raw, err := s.client.GetRaw(ctx, "/providers/rules"); err == nil {
		var pr struct {
			Providers map[string]struct {
				Name        string `json:"name"`
				Behavior    string `json:"behavior"`
				Type        string `json:"type"`
				VehicleType string `json:"vehicleType"`
				RuleCount   int    `json:"ruleCount"`
				UpdatedAt   string `json:"updatedAt"`
			} `json:"providers"`
		}
		if json.Unmarshal(raw, &pr) == nil {
			for _, p := range pr.Providers {
				resp.Providers = append(resp.Providers, RuleProvider{
					Name:      p.Name,
					Type:      strings.ToLower(p.VehicleType),
					Behavior:  strings.ToLower(p.Behavior),
					Count:     p.RuleCount,
					UpdatedAt: humanSince(p.UpdatedAt),
				})
			}
		}
	}
	// 规则实时命中：从当前活动连接派生每条规则命中的连接数（非累计，反映"此刻在用哪些规则"）。
	if raw, err := s.client.Connections(ctx); err == nil {
		var cc struct {
			Connections []struct {
				Rule        string `json:"rule"`
				RulePayload string `json:"rulePayload"`
			} `json:"connections"`
		}
		if json.Unmarshal(raw, &cc) == nil {
			hits := map[string]int{}
			for _, c := range cc.Connections {
				hits[canonicalRuleType(c.Rule)+"|"+c.RulePayload]++
			}
			for i := range resp.Rules {
				if h := hits[resp.Rules[i].Type+"|"+resp.Rules[i].Payload]; h > 0 {
					resp.Rules[i].Hit = h
				}
			}
		}
	}
	// 合并配置文件里已定义、但内核运行态尚未列出的规则集（刚添加 / 远程未下载完成或失败），
	// 避免「配置里有规则集但面板列表空白」。
	seen := map[string]bool{}
	for _, p := range resp.Providers {
		seen[p.Name] = true
	}
	for _, c := range config.RuleProviders(s.cfg.ConfigPath()) {
		if seen[c.Name] {
			continue
		}
		resp.Providers = append(resp.Providers, RuleProvider{
			Name:      c.Name,
			Type:      orStr(c.Type, "http"),
			Behavior:  c.Behavior,
			Count:     0,
			UpdatedAt: "",
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleUpdateRuleProvider 手动更新单个规则集（PUT 转发到 mihomo）。
func (s *Server) handleUpdateRuleProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeErr(w, http.StatusBadRequest, "缺少规则集名称")
		return
	}
	// 下载远程规则列表可能较慢，给宽松超时。
	ctx, cancel := context.WithTimeout(r.Context(), 95*time.Second)
	defer cancel()
	if err := s.client.UpdateRuleProvider(ctx, name); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "ok": true})
}

// handleUpdateGeo 触发内核重新下载 GeoIP/GeoSite 数据库并热加载（"更新规则库"按钮）。
// 内置 GEOSITE/GEOIP 规则的归类依赖这些数据；下载走 mihomo 自身网络（含本机 TUN 代理）。
func (s *Server) handleUpdateGeo(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 95*time.Second)
	defer cancel()
	if err := s.client.UpdateGeo(ctx); err != nil {
		writeErr(w, http.StatusBadGateway, "更新 Geo 数据失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleUpdateAllRuleProviders 手动更新全部规则集，并发执行并逐个上报成功/失败。
func (s *Server) handleUpdateAllRuleProviders(w http.ResponseWriter, r *http.Request) {
	listCtx, listCancel := reqCtx(r)
	names, err := s.client.RuleProviderNames(listCtx)
	listCancel()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
	defer cancel()

	var mu sync.Mutex
	var wg sync.WaitGroup
	updated := []string{}
	failed := map[string]string{}
	for _, n := range names {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			e := s.client.UpdateRuleProvider(ctx, name)
			mu.Lock()
			defer mu.Unlock()
			if e != nil {
				failed[name] = e.Error()
			} else {
				updated = append(updated, name)
			}
		}(n)
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, map[string]any{
		"updated": updated,
		"failed":  failed,
		"count":   len(updated),
		"ok":      len(failed) == 0,
	})
}

// 规则集订阅的合法取值白名单。
var (
	validRuleBehaviors = map[string]bool{"domain": true, "ipcidr": true, "classical": true}
	validRuleFormats   = map[string]bool{"yaml": true, "text": true, "mrs": true}
)

// handleAddRuleProvider 新增一个远程规则集订阅：写入 rule-providers + 追加 RULE-SET
// 规则（插到 MATCH 之前），随后热重载使其立即生效。
func (s *Server) handleAddRuleProvider(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		URL      string `json:"url"`
		Behavior string `json:"behavior"`
		Format   string `json:"format"`
		Target   string `json:"target"`
		Interval int    `json:"interval"` // 秒，<=0 取默认 86400
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	name := strings.TrimSpace(body.Name)
	rawURL := strings.TrimSpace(body.URL)
	behavior := strings.ToLower(strings.TrimSpace(body.Behavior))
	target := strings.TrimSpace(body.Target)
	if name == "" || rawURL == "" || target == "" {
		writeErr(w, http.StatusBadRequest, "缺少 name/url/target")
		return
	}
	if !validRuleBehaviors[behavior] {
		writeErr(w, http.StatusBadRequest, "behavior 必须是 domain / ipcidr / classical")
		return
	}
	format := strings.ToLower(strings.TrimSpace(body.Format))
	if format == "" {
		format = "yaml"
	}
	if !validRuleFormats[format] {
		writeErr(w, http.StatusBadRequest, "format 必须是 yaml / text / mrs")
		return
	}
	interval := body.Interval
	if interval <= 0 {
		interval = 86400
	}
	// 确保规则集缓存目录存在（mihomo 需要 provider path 的父目录可写）。
	_ = os.MkdirAll(filepath.Join(s.cfg.WorkDir, "rule-providers"), 0o755)
	providerRel := "./rule-providers/" + safeFile(name) + ".yaml"
	s.cfgMu.Lock()
	err := config.AddRuleProvider(s.cfg.ConfigPath(), name, rawURL, behavior, format, target, providerRel, interval)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	resp := map[string]any{"ok": true, "name": name}
	if wmsg := s.reloadWithWarn(r.Context()); wmsg != "" {
		resp["warning"] = wmsg
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleDeleteRuleProvider 删除一个规则集订阅及其 RULE-SET 规则，并清理缓存文件。
func (s *Server) handleDeleteRuleProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeErr(w, http.StatusBadRequest, "缺少规则集名称")
		return
	}
	s.cfgMu.Lock()
	err := config.RemoveRuleProvider(s.cfg.ConfigPath(), name)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	warn := s.reloadWithWarn(r.Context())
	_ = os.Remove(config.RuleProviderFilePath(s.cfg.WorkDir, safeFile(name)))
	resp := map[string]any{"ok": true}
	if warn != "" {
		resp["warning"] = warn
	}
	writeJSON(w, http.StatusOK, resp)
}
