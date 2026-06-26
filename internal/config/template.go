package config

import (
	"regexp"

	"gopkg.in/yaml.v3"
)

// 推荐策略模板：参考主流 OpenClash/Clash 订阅模板，结合 M-BOX 适配。
// 仅用 mihomo 内置 GEOSITE/GEOIP（安装包已带 geoip/geosite.dat），不依赖第三方
// rule-provider，离线可用、稳定。地区组用正则 filter 从订阅自动按地区分桶。

const (
	tplDirect = "🎯 全球直连"
	tplManual = "🚀 手动选择"
	tplAuto   = "♻️ 自动选择"
)

// tplRegion 是一个地区分组定义：Name 为组名，Filter 为匹配订阅节点名的正则。
type tplRegion struct{ Name, Filter string }

var tplRegions = []tplRegion{
	{"🇭🇰 香港节点", "(?i)(🇭🇰|香港|港|\\bHK\\b|Hong ?Kong|HKG)"},
	{"🇺🇸 美国节点", "(?i)(🇺🇸|美国|美|\\bUS\\b|United ?States|USA|America|LAX|SFO|SEA|NYC|JFK)"},
	{"🇯🇵 日本节点", "(?i)(🇯🇵|日本|东京|大阪|\\bJP\\b|Japan|JPN|NRT|HND|KIX|Tokyo|Osaka)"},
	{"🇸🇬 新加坡节点", "(?i)(🇸🇬|新加坡|狮城|坡|\\bSG\\b|Singapore|SIN)"},
	{"🇹🇼 台湾节点", "(?i)(🇹🇼|🇼🇸|台湾|台|\\bTW\\b|Taiwan|TWN|TPE)"},
	{"🇰🇷 韩国节点", "(?i)(🇰🇷|韩国|首尔|韩|\\bKR\\b|Korea|KOR|ICN|Seoul)"},
}

// tplCategories 是分类分流组（select），命中对应规则的流量走该组。
// 参考用户提供的主流模板，结合 M-BOX 用「内置 GEOSITE」适配（不依赖第三方 rule-provider）。
// 顺序即面板展示顺序；名称需与 recommendedRules / default.yaml 中的目标组名严格一致。
var tplCategories = []string{
	"💬 即时通讯", "🌐 社交媒体", "🚀 GitHub", "🤖 ChatGPT", "🤖 AI服务",
	"🎶 TikTok", "📹 YouTube", "🎥 Netflix", "🎥 DisneyPlus", "🎥 HBO",
	"🎥 PrimeVideo", "🎥 AppleTV+", "🎥 Emby", "🎻 Spotify", "📺 Bahamut",
	"🌎 国外媒体", "🛒 国外电商", "📢 谷歌FCM", "🇬 谷歌服务", "🍎 苹果服务",
	"Ⓜ️ 微软服务", "🎮 游戏平台", "🎮 Steam", "🚀 测速工具", "🐟 漏网之鱼",
}

func tplSeq(items []string) *yaml.Node {
	seq := &yaml.Node{Kind: yaml.SequenceNode}
	for _, s := range items {
		seq.Content = append(seq.Content, scalarStr(s))
	}
	return seq
}

func tplSelect(name string, members, providers []string) *yaml.Node {
	g := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(g, "name", scalarStr(name))
	mapSet(g, "type", scalarStr("select"))
	if len(providers) > 0 {
		mapSet(g, "use", tplSeq(providers))
	}
	if len(members) > 0 {
		mapSet(g, "proxies", tplSeq(members))
	}
	return g
}

func tplURLTest(name, filter string, providers []string) *yaml.Node {
	g := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(g, "name", scalarStr(name))
	mapSet(g, "type", scalarStr("url-test"))
	mapSet(g, "url", scalarStr("https://cp.cloudflare.com/generate_204"))
	mapSet(g, "interval", scalarInt(300))
	mapSet(g, "tolerance", scalarInt(50))
	if len(providers) > 0 {
		mapSet(g, "use", tplSeq(providers))
	}
	if filter != "" {
		mapSet(g, "filter", scalarStr(filter))
	}
	return g
}

// recommendedRules 返回基于内置 GEOSITE/GEOIP 的分流规则（参考用户模板顺序）。
// 目标组名与生成/默认的策略组严格一致；全部用内置 GEOSITE/GEOIP，离线可用。
func recommendedRules() []string {
	return []string{
		"GEOSITE,private," + tplDirect,
		"GEOIP,private," + tplDirect + ",no-resolve",
		"GEOSITE,category-ads-all,REJECT",
		"GEOSITE,google-cn," + tplDirect,
		"GEOSITE,category-games@cn," + tplDirect,
		"GEOSITE,category-communication,💬 即时通讯",
		"GEOSITE,category-social-media-!cn,🌐 社交媒体",
		"GEOSITE,github,🚀 GitHub",
		"GEOSITE,openai,🤖 ChatGPT",
		"GEOSITE,category-ai-!cn,🤖 AI服务",
		"GEOSITE,tiktok,🎶 TikTok",
		"GEOSITE,youtube,📹 YouTube",
		"GEOSITE,netflix,🎥 Netflix",
		"GEOSITE,disney,🎥 DisneyPlus",
		"GEOSITE,hbo,🎥 HBO",
		"GEOSITE,primevideo,🎥 PrimeVideo",
		"GEOSITE,apple-tvplus,🎥 AppleTV+",
		"GEOSITE,category-emby,🎥 Emby",
		"GEOSITE,spotify,🎻 Spotify",
		"GEOSITE,bahamut,📺 Bahamut",
		"GEOSITE,category-entertainment,🌎 国外媒体",
		"GEOSITE,category-ecommerce,🛒 国外电商",
		"GEOSITE,googlefcm,📢 谷歌FCM",
		"GEOSITE,google,🇬 谷歌服务",
		"GEOSITE,apple,🍎 苹果服务",
		"GEOSITE,microsoft,Ⓜ️ 微软服务",
		"GEOSITE,steam,🎮 Steam",
		"GEOSITE,category-games,🎮 游戏平台",
		"GEOSITE,category-speedtest,🚀 测速工具",
		"GEOSITE,geolocation-!cn," + tplManual,
		"GEOIP,telegram,💬 即时通讯,no-resolve",
		"GEOIP,twitter,🌐 社交媒体,no-resolve",
		"GEOIP,facebook,🌐 社交媒体,no-resolve",
		"GEOIP,netflix,🎥 Netflix,no-resolve",
		"GEOIP,google,🇬 谷歌服务,no-resolve",
		"GEOSITE,cn," + tplDirect,
		"GEOIP,cn," + tplDirect + ",no-resolve",
		"MATCH,🐟 漏网之鱼",
	}
}

// matchedRegions 返回在 nodeNames 中「至少有一个节点名匹配」的地区分组定义。
// 用于只生成订阅里确有节点的地区组，避免生成空的地区组（mihomo 对空组会退化为
// COMPATIBLE 占位、选中后流量无法走代理，且面板上一堆空组也很丑）。
// nodeNames 为空（如 provider 文件尚未下载、读不到节点名）时返回 nil——调用方据此
// 退化为「只有自动选择、无地区分桶」的布局，仍然可用且不会出现空组。
func matchedRegions(nodeNames []string) []tplRegion {
	if len(nodeNames) == 0 {
		return nil
	}
	out := make([]tplRegion, 0, len(tplRegions))
	for _, rg := range tplRegions {
		re, err := regexp.Compile(rg.Filter)
		if err != nil {
			continue
		}
		for _, n := range nodeNames {
			if re.MatchString(n) {
				out = append(out, rg)
				break
			}
		}
	}
	return out
}

// ApplyRecommendedTemplate 用「推荐策略模板」重写 config.yaml 的 proxy-groups 与 rules，
// 其余配置(dns/tun/proxy-providers/proxies 等)保持不变。providers 为要纳入的订阅
// provider 名称列表（通常是已启用订阅）；nodeNames 为这些订阅里的全部节点名（用于按
// 地区分桶时只生成确有节点的地区组）。providers 为空时退化为「手动选择→全球直连」的
// 基础布局，保证零订阅也能正常启动。
func ApplyRecommendedTemplate(path string, providers []string, nodeNames []string) error {
	return editConfig(path, func(root *yaml.Node) error {
		hasNodes := len(providers) > 0
		// 仅保留订阅里确有匹配节点的地区组。
		regions := matchedRegions(nodeNames)
		regionNames := make([]string, 0, len(regions))
		for _, rg := range regions {
			regionNames = append(regionNames, rg.Name)
		}

		groups := &yaml.Node{Kind: yaml.SequenceNode}

		// 顶层：手动选择（含自动/地区/直连作为可选项），并 use 全部订阅以便直接选具体节点。
		manualMembers := []string{}
		if hasNodes {
			manualMembers = append(manualMembers, tplAuto)
			manualMembers = append(manualMembers, regionNames...)
		}
		manualMembers = append(manualMembers, tplDirect)
		groups.Content = append(groups.Content, tplSelect(tplManual, manualMembers, providers))

		if hasNodes {
			// 自动选择：对全部节点做 url-test 选最快。
			groups.Content = append(groups.Content, tplURLTest(tplAuto, ".*", providers))
			// 地区组：按正则从订阅分桶并 url-test（只生成确有节点的地区）。
			for _, rg := range regions {
				groups.Content = append(groups.Content, tplURLTest(rg.Name, rg.Filter, providers))
			}
		}

		// 分类分流组（成员只引用确实存在的地区组，避免悬空引用）。
		catMembers := []string{tplManual}
		if hasNodes {
			catMembers = append(catMembers, tplAuto)
			catMembers = append(catMembers, regionNames...)
		}
		catMembers = append(catMembers, tplDirect)
		for _, cat := range tplCategories {
			groups.Content = append(groups.Content, tplSelect(cat, catMembers, providers))
		}

		// 全球直连（纯 DIRECT，兜底/直连专用）。
		groups.Content = append(groups.Content, tplSelect(tplDirect, []string{"DIRECT"}, nil))

		mapSet(root, "proxy-groups", groups)
		mapSet(root, "rules", tplSeq(recommendedRules()))
		return nil
	})
}
