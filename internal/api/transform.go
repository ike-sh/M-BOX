package api

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// parseStartMillis 把 mihomo 的 RFC3339 起始时间转换为毫秒时间戳。
func parseStartMillis(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		if t, err = time.Parse(time.RFC3339, s); err != nil {
			return 0
		}
	}
	return t.UnixMilli()
}

// mihomoProxy 是 mihomo /proxies 中单个条目的形状（只取需要的字段）。
type mihomoProxy struct {
	Type    string   `json:"type"`
	Name    string   `json:"name"`
	Now     string   `json:"now"`
	All     []string `json:"all"`
	UDP     bool     `json:"udp"`
	History []struct {
		Delay int `json:"delay"`
	} `json:"history"`
}

var groupTypes = map[string]string{
	"selector":    "select",
	"urltest":     "url-test",
	"fallback":    "fallback",
	"loadbalance": "load-balance",
}

// builtinOutbounds 是 mihomo 内置出站（非真实节点）。它们不进「节点」列表展示，
// 避免污染节点数/区域识别（如 PASS-RULE 被误判区域）；DIRECT/REJECT 仍会作为
// 策略组成员的字面量在组里正常显示与选择。
var builtinOutbounds = map[string]bool{
	"direct": true, "reject": true, "reject-drop": true, "rejectdrop": true,
	"pass": true, "passrule": true, "pass-rule": true, "compatible": true, "dns": true,
}

// transformProxies 把 mihomo 的代理映射转换为面板需要的 nodes + groups。
func transformProxies(raw map[string]json.RawMessage) ProxiesResp {
	resp := ProxiesResp{Nodes: []ProxyNode{}, Groups: []ProxyGroup{}}
	var globalOrder []string
	for name, rm := range raw {
		var p mihomoProxy
		if err := json.Unmarshal(rm, &p); err != nil {
			continue
		}
		if p.Name == "" {
			p.Name = name
		}
		// GLOBAL 是 mihomo 的全局兜底组（包含所有策略组），面板不单独展示它；
		// 但借它的成员顺序来还原 config.yaml 里的策略组顺序（/proxies 本身是无序 map）。
		if strings.EqualFold(p.Name, "GLOBAL") {
			globalOrder = p.All
			continue
		}
		lt := strings.ToLower(p.Type)
		if gt, ok := groupTypes[lt]; ok {
			resp.Groups = append(resp.Groups, ProxyGroup{
				Name:    p.Name,
				Type:    gt,
				Now:     p.Now,
				Proxies: p.All,
			})
			continue
		}
		// 内置出站不作为可选节点展示。
		if builtinOutbounds[lt] {
			continue
		}
		delay := -1
		if n := len(p.History); n > 0 {
			if d := p.History[n-1].Delay; d > 0 {
				delay = d
			}
		}
		region, flag := guessRegion(p.Name)
		resp.Nodes = append(resp.Nodes, ProxyNode{
			Name:       p.Name,
			Type:       normalizeType(lt),
			Region:     region,
			Flag:       flag,
			Delay:      delay,
			Multiplier: guessMultiplier(p.Name),
			UDP:        p.UDP,
		})
	}
	sort.Slice(resp.Nodes, func(i, j int) bool { return resp.Nodes[i].Name < resp.Nodes[j].Name })
	// 策略组按 GLOBAL 成员顺序（≈ config 顺序）排列；不在其中的排到末尾按名排序。
	orderIndex := make(map[string]int, len(globalOrder))
	for i, n := range globalOrder {
		orderIndex[n] = i
	}
	sort.SliceStable(resp.Groups, func(i, j int) bool {
		oi, iok := orderIndex[resp.Groups[i].Name]
		oj, jok := orderIndex[resp.Groups[j].Name]
		if iok && jok {
			return oi < oj
		}
		if iok != jok {
			return iok
		}
		return resp.Groups[i].Name < resp.Groups[j].Name
	})
	return resp
}

func normalizeType(t string) string {
	switch t {
	case "shadowsocks", "ss":
		return "ss"
	case "shadowsocksr", "ssr":
		return "ss"
	case "vmess":
		return "vmess"
	case "vless":
		return "vless"
	case "trojan":
		return "trojan"
	case "hysteria2", "hysteria":
		return "hysteria2"
	case "tuic":
		return "tuic"
	case "wireguard":
		return "wireguard"
	case "direct":
		return "direct"
	default:
		return t
	}
}

// region 关键词 -> (区域码, 旗帜 emoji)。覆盖常见机场命名。
var regionTable = []struct {
	keys []string
	code string
	flag string
}{
	{[]string{"香港", "HK", "Hong Kong", "🇭🇰"}, "HK", "🇭🇰"},
	{[]string{"台湾", "台灣", "TW", "Taiwan", "🇹🇼"}, "TW", "🇹🇼"},
	{[]string{"日本", "东京", "大阪", "JP", "Japan", "Tokyo", "Osaka", "🇯🇵"}, "JP", "🇯🇵"},
	{[]string{"新加坡", "狮城", "SG", "Singapore", "🇸🇬"}, "SG", "🇸🇬"},
	{[]string{"美国", "美國", "US", "United States", "Los Angeles", "San Jose", "🇺🇸"}, "US", "🇺🇸"},
	{[]string{"韩国", "韓國", "首尔", "KR", "Korea", "Seoul", "🇰🇷"}, "KR", "🇰🇷"},
	{[]string{"英国", "英國", "伦敦", "UK", "GB", "London", "🇬🇧"}, "UK", "🇬🇧"},
	{[]string{"德国", "德國", "法兰克福", "DE", "Germany", "🇩🇪"}, "DE", "🇩🇪"},
	{[]string{"法国", "FR", "France", "🇫🇷"}, "FR", "🇫🇷"},
	{[]string{"俄罗斯", "RU", "Russia", "🇷🇺"}, "RU", "🇷🇺"},
	{[]string{"印度", "IN", "India", "🇮🇳"}, "IN", "🇮🇳"},
	{[]string{"加拿大", "CA", "Canada", "🇨🇦"}, "CA", "🇨🇦"},
	{[]string{"澳大利亚", "澳洲", "悉尼", "墨尔本", "AU", "Australia", "Sydney", "Melbourne", "🇦🇺"}, "AU", "🇦🇺"},
	{[]string{"马来", "馬來", "MY", "Malaysia", "🇲🇾"}, "MY", "🇲🇾"},
	{[]string{"泰国", "TH", "Thailand", "🇹🇭"}, "TH", "🇹🇭"},
	{[]string{"越南", "VN", "Vietnam", "🇻🇳"}, "VN", "🇻🇳"},
	{[]string{"土耳其", "TR", "Turkey", "🇹🇷"}, "TR", "🇹🇷"},
	{[]string{"阿根廷", "AR", "Argentina", "🇦🇷"}, "AR", "🇦🇷"},
}

// guessRegion 从节点名推断区域。匹配优先级（高→低）：
//  1. 国旗 emoji（最可靠，不会误判）；
//  2. 关键词：两字母国家码要求「词边界」（两侧非 ASCII 字母），避免
//     "US" 命中 "AUS"/"AUSTRIA"、"IN" 命中 "AUSTIN" 之类的误判；
//     其余多字符关键词（中文/全称）大小写不敏感子串匹配。
func guessRegion(name string) (string, string) {
	for _, r := range regionTable {
		if strings.Contains(name, r.flag) {
			return r.code, r.flag
		}
	}
	upper := strings.ToUpper(name)
	for _, r := range regionTable {
		for _, k := range r.keys {
			if isCountryCode(k) {
				if containsCode(upper, k) {
					return r.code, r.flag
				}
			} else if strings.Contains(upper, strings.ToUpper(k)) {
				return r.code, r.flag
			}
		}
	}
	return "", "🏳️"
}

// isCountryCode 判断 k 是否为两位大写 ASCII 国家码（如 US/HK），这类需词边界匹配。
func isCountryCode(k string) bool {
	if len(k) != 2 {
		return false
	}
	return isASCIIAlpha(k[0]) && k[0] <= 'Z' && k[0] >= 'A' &&
		isASCIIAlpha(k[1]) && k[1] <= 'Z' && k[1] >= 'A'
}

// containsCode 在已大写的 name 中查找 code，且要求 code 两侧不是 ASCII 字母（词边界）。
func containsCode(upperName, code string) bool {
	from := 0
	for from <= len(upperName)-len(code) {
		i := strings.Index(upperName[from:], code)
		if i < 0 {
			return false
		}
		idx := from + i
		leftOK := idx == 0 || !isASCIIAlpha(upperName[idx-1])
		right := idx + len(code)
		rightOK := right >= len(upperName) || !isASCIIAlpha(upperName[right])
		if leftOK && rightOK {
			return true
		}
		from = idx + 1
	}
	return false
}

func isASCIIAlpha(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

var multiplierRe = regexp.MustCompile(`(?i)(?:x|×|倍率[:：]?)\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*(?:x|×|倍)`)

func guessMultiplier(name string) float64 {
	m := multiplierRe.FindStringSubmatch(name)
	if m == nil {
		return 0
	}
	for _, g := range m[1:] {
		if g != "" {
			if v, err := strconv.ParseFloat(g, 64); err == nil {
				return v
			}
		}
	}
	return 0
}

// mihomoConn 是 mihomo /connections 的形状（取需要字段）。
type mihomoConnections struct {
	DownloadTotal int64 `json:"downloadTotal"`
	UploadTotal   int64 `json:"uploadTotal"`
	Connections   []struct {
		ID          string   `json:"id"`
		Upload      int64    `json:"upload"`
		Download    int64    `json:"download"`
		Start       string   `json:"start"`
		Chains      []string `json:"chains"`
		Rule        string   `json:"rule"`
		RulePayload string   `json:"rulePayload"`
		Metadata    struct {
			Network         string `json:"network"`
			Type            string `json:"type"`
			Host            string `json:"host"`
			SourceIP        string `json:"sourceIP"`
			DestinationIP   string `json:"destinationIP"`
			DestinationPort string `json:"destinationPort"`
			Process         string `json:"process"`
		} `json:"metadata"`
	} `json:"connections"`
}

func transformConnections(raw json.RawMessage) []Connection {
	var mc mihomoConnections
	out := []Connection{}
	if err := json.Unmarshal(raw, &mc); err != nil {
		return out
	}
	for _, c := range mc.Connections {
		host := c.Metadata.Host
		if host == "" {
			host = c.Metadata.DestinationIP
		}
		rule := c.Rule
		if c.RulePayload != "" {
			rule = c.Rule + "," + c.RulePayload
		}
		out = append(out, Connection{
			ID:       c.ID,
			Host:     host,
			DestIP:   c.Metadata.DestinationIP,
			SourceIP: c.Metadata.SourceIP,
			Type:     strings.ToUpper(c.Metadata.Network),
			Rule:     rule,
			Chain:    c.Chains,
			Upload:   c.Upload,
			Download: c.Download,
			Start:    parseStartMillis(c.Start),
			Process:  c.Metadata.Process,
		})
	}
	return out
}

// parseConnTotals 从 mihomo /connections 原始响应提取累计上/下行字节（uploadTotal/
// downloadTotal）。这是内核自启动以来的单调累计量，用于按时间桶做精确差分统计，
// 比把「速率」近似当「增量」积分更准。解析失败返回 (0,0)。
func parseConnTotals(raw json.RawMessage) (up, down int64) {
	var mc struct {
		UploadTotal   int64 `json:"uploadTotal"`
		DownloadTotal int64 `json:"downloadTotal"`
	}
	if json.Unmarshal(raw, &mc) != nil {
		return 0, 0
	}
	return mc.UploadTotal, mc.DownloadTotal
}
