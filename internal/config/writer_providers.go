package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// AddProxyProvider 把一个 http 订阅注入 config.yaml 的 proxy-providers，并把它
// 加进所有带 `use:` 的策略组，使新订阅的节点立即可用。providerPath 为相对工作目录的路径。
func AddProxyProvider(path, name, url, providerPath string, intervalSec int) error {
	return editConfig(path, func(root *yaml.Node) error {
		providers := ensureMap(root, "proxy-providers")

		entry := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(entry, "type", scalarStr("http"))
		mapSet(entry, "url", scalarStr(url))
		mapSet(entry, "path", scalarStr(providerPath))
		mapSet(entry, "interval", scalarInt(intervalSec))
		hc := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(hc, "enable", scalarBool(true))
		mapSet(hc, "url", scalarStr("https://www.gstatic.com/generate_204"))
		mapSet(hc, "interval", scalarInt(300))
		mapSet(entry, "health-check", hc)
		mapSet(providers, name, entry)

		// 把 provider 注入到「承载节点的策略组」的 use 列表：
		//   - 组已有 use → 直接追加；
		//   - 组没有 use 但属于节点型组(select/url-test/fallback/load-balance/relay) → 新建 use 再加。
		// 否则像默认配置那样策略组只有 proxies、没有 use 时，订阅节点会无组可去（面板看不到）。
		if groups := mapGet(root, "proxy-groups"); groups != nil && groups.Kind == yaml.SequenceNode {
			for _, g := range groups.Content {
				if g.Kind != yaml.MappingNode || !groupAcceptsProvider(g) {
					continue
				}
				use := mapGet(g, "use")
				if use == nil || use.Kind != yaml.SequenceNode {
					use = &yaml.Node{Kind: yaml.SequenceNode}
					mapSet(g, "use", use)
				}
				exists := false
				for _, u := range use.Content {
					if u.Value == name {
						exists = true
						break
					}
				}
				if !exists {
					use.Content = append(use.Content, scalarStr(name))
				}
			}
		}
		return nil
	})
}

// groupAcceptsProvider 判断是否应把订阅 provider 注入该策略组的 use：
//   - 已有 use 的组：是（继续追加）；
//   - 节点型组(select/url-test/fallback/load-balance/relay) 且含「非直连成员」(说明是真正
//     承载节点的组)：是（缺 use 时会自动创建）；
//   - 仅含 DIRECT/REJECT/PASS 的组(如「全球直连」)：否（避免污染直连/兜底组）。
func groupAcceptsProvider(g *yaml.Node) bool {
	if use := mapGet(g, "use"); use != nil && use.Kind == yaml.SequenceNode {
		return true
	}
	t := ""
	if tn := mapGet(g, "type"); tn != nil {
		t = strings.ToLower(strings.TrimSpace(tn.Value))
	}
	switch t {
	case "select", "selector", "url-test", "urltest", "fallback", "load-balance", "loadbalance", "relay":
		// 节点型组，继续判断是否「直连/兜底专用」。
	default:
		return false
	}
	ps := mapGet(g, "proxies")
	if ps == nil || ps.Kind != yaml.SequenceNode || len(ps.Content) == 0 {
		return true // 节点型组且没有静态 proxies → 接受（建 use）
	}
	for _, x := range ps.Content {
		v := strings.ToUpper(strings.TrimSpace(x.Value))
		if v != "DIRECT" && v != "REJECT" && v != "PASS" {
			return true // 含非直连成员(节点/其它组) → 真正的节点组
		}
	}
	return false // 仅 DIRECT/REJECT/PASS → 直连/兜底组，跳过
}

// RemoveProxyProvider 从 config.yaml 删除 proxy-provider 及策略组引用。
func RemoveProxyProvider(path, name string) error {
	return editConfig(path, func(root *yaml.Node) error {
		if providers := mapGet(root, "proxy-providers"); providers != nil && providers.Kind == yaml.MappingNode {
			out := providers.Content[:0]
			for i := 0; i+1 < len(providers.Content); i += 2 {
				if providers.Content[i].Value != name {
					out = append(out, providers.Content[i], providers.Content[i+1])
				}
			}
			providers.Content = out
		}
		if groups := mapGet(root, "proxy-groups"); groups != nil && groups.Kind == yaml.SequenceNode {
			for _, g := range groups.Content {
				use := mapGet(g, "use")
				if use == nil || use.Kind != yaml.SequenceNode {
					continue
				}
				out := use.Content[:0]
				for _, u := range use.Content {
					if u.Value != name {
						out = append(out, u)
					}
				}
				use.Content = out
			}
		}
		return nil
	})
}

// AddInlineProxies 把手动解析得到的节点写入 config.yaml 顶层 `proxies:`，并加入可选
// 策略组。重名自动追加序号去重。返回最终写入的节点名列表。
func AddInlineProxies(path string, proxies []map[string]any) ([]string, error) {
	var added []string
	err := editConfig(path, func(root *yaml.Node) error {
		seq := mapGet(root, "proxies")
		if seq == nil || seq.Kind != yaml.SequenceNode {
			seq = &yaml.Node{Kind: yaml.SequenceNode}
			mapSet(root, "proxies", seq)
		}
		taken := map[string]bool{}
		existingFP := map[string]bool{}
		for _, item := range seq.Content {
			if item.Kind == yaml.MappingNode {
				if nm := mapGet(item, "name"); nm != nil {
					taken[nm.Value] = true
				}
				existingFP[nodeFingerprintYAML(item)] = true
			}
		}
		for _, px := range proxies {
			// 节点去重：与已有节点指纹相同(同协议/服务器/端口/凭据)则跳过，避免重复写入。
			fp := proxyFingerprint(px)
			if existingFP[fp] {
				continue
			}
			existingFP[fp] = true
			name, _ := px["name"].(string)
			name = uniqueName(name, taken)
			px["name"] = name
			taken[name] = true
			var node yaml.Node
			if err := node.Encode(px); err != nil {
				return err
			}
			seq.Content = append(seq.Content, &node)
			added = append(added, name)
		}
		if len(added) > 0 {
			addNamesToGroups(root, added)
		}
		return nil
	})
	return added, err
}

// RemoveInlineProxy 从 config.yaml 删除指定名称的内联节点及其在各策略组中的引用。
func RemoveInlineProxy(path, name string) error {
	return editConfig(path, func(root *yaml.Node) error {
		if seq := mapGet(root, "proxies"); seq != nil && seq.Kind == yaml.SequenceNode {
			out := seq.Content[:0]
			for _, item := range seq.Content {
				if item.Kind == yaml.MappingNode {
					if nm := mapGet(item, "name"); nm != nil && nm.Value == name {
						continue
					}
				}
				out = append(out, item)
			}
			seq.Content = out
		}
		if groups := mapGet(root, "proxy-groups"); groups != nil && groups.Kind == yaml.SequenceNode {
			for _, g := range groups.Content {
				ps := mapGet(g, "proxies")
				if ps == nil || ps.Kind != yaml.SequenceNode {
					continue
				}
				out := ps.Content[:0]
				for _, x := range ps.Content {
					if x.Value != name {
						out = append(out, x)
					}
				}
				ps.Content = out
			}
		}
		return nil
	})
}

// addNamesToGroups 把节点名加入所有「可选」策略组（跳过仅含 DIRECT/REJECT 的直连组）；
// 若配置中尚无策略组，则创建一个默认 select 组「PROXY」便于立即选用。
func addNamesToGroups(root *yaml.Node, names []string) {
	groups := mapGet(root, "proxy-groups")
	if groups == nil || groups.Kind != yaml.SequenceNode || len(groups.Content) == 0 {
		g := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(g, "name", scalarStr("PROXY"))
		mapSet(g, "type", scalarStr("select"))
		ps := &yaml.Node{Kind: yaml.SequenceNode}
		for _, n := range names {
			ps.Content = append(ps.Content, scalarStr(n))
		}
		ps.Content = append(ps.Content, scalarStr("DIRECT"))
		mapSet(g, "proxies", ps)
		seq := &yaml.Node{Kind: yaml.SequenceNode, Content: []*yaml.Node{g}}
		mapSet(root, "proxy-groups", seq)
		return
	}
	// 先挑出可选组；若一个都没有（全是直连组），退化为加到所有组。
	eligible := make([]*yaml.Node, 0, len(groups.Content))
	for _, g := range groups.Content {
		if g.Kind == yaml.MappingNode && eligibleGroup(g) {
			eligible = append(eligible, g)
		}
	}
	if len(eligible) == 0 {
		for _, g := range groups.Content {
			if g.Kind == yaml.MappingNode {
				eligible = append(eligible, g)
			}
		}
	}
	for _, g := range eligible {
		ps := mapGet(g, "proxies")
		if ps == nil || ps.Kind != yaml.SequenceNode {
			ps = &yaml.Node{Kind: yaml.SequenceNode}
			mapSet(g, "proxies", ps)
		}
		existing := map[string]bool{}
		for _, x := range ps.Content {
			existing[x.Value] = true
		}
		for _, n := range names {
			if !existing[n] {
				ps.Content = append(ps.Content, scalarStr(n))
			}
		}
	}
}

// eligibleGroup 判断一个策略组是否适合追加节点：含 use、含非直连成员、或无 proxies 字段。
func eligibleGroup(g *yaml.Node) bool {
	if use := mapGet(g, "use"); use != nil && use.Kind == yaml.SequenceNode && len(use.Content) > 0 {
		return true
	}
	ps := mapGet(g, "proxies")
	if ps == nil || ps.Kind != yaml.SequenceNode {
		return true
	}
	for _, x := range ps.Content {
		v := strings.ToUpper(strings.TrimSpace(x.Value))
		if v != "DIRECT" && v != "REJECT" && v != "PASS" {
			return true
		}
	}
	return len(ps.Content) == 0
}

// nodeFingerprintYAML 计算 config 中已存在节点(yaml 映射)的去重指纹，
// 与 proxyFingerprint(map) 共用 fingerprintFrom 以保证两侧格式一致。
func nodeFingerprintYAML(n *yaml.Node) string {
	return fingerprintFrom(func(k string) string {
		if v := mapGet(n, k); v != nil {
			return strings.TrimSpace(v.Value)
		}
		return ""
	})
}

// uniqueName 在已占用名集合中生成唯一名称（重名追加 -2/-3…）。
func uniqueName(name string, taken map[string]bool) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "node"
	}
	if !taken[name] {
		return name
	}
	for i := 2; ; i++ {
		cand := fmt.Sprintf("%s-%d", name, i)
		if !taken[cand] {
			return cand
		}
	}
}

// CountProviderNodes 解析 provider 文件，返回其中 proxies 节点数量。
func CountProviderNodes(providerFile string) int {
	raw, err := os.ReadFile(providerFile)
	if err != nil {
		return 0
	}
	var doc struct {
		Proxies []any `yaml:"proxies"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return 0
	}
	return len(doc.Proxies)
}

// ProviderNodeNames 解析 provider 文件，返回其中所有节点的 name 列表（用于推荐模板
// 按地区分桶时判断订阅里实际有哪些地区的节点）。读不到/解析失败时返回 nil。
func ProviderNodeNames(providerFile string) []string {
	raw, err := os.ReadFile(providerFile)
	if err != nil {
		return nil
	}
	var doc struct {
		Proxies []struct {
			Name string `yaml:"name"`
		} `yaml:"proxies"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	out := make([]string, 0, len(doc.Proxies))
	for _, p := range doc.Proxies {
		if strings.TrimSpace(p.Name) != "" {
			out = append(out, p.Name)
		}
	}
	return out
}

// ProviderFilePath 返回某订阅 provider 文件的绝对路径（workDir/providers/<name>.yaml）。
func ProviderFilePath(workDir, name string) string {
	return filepath.Join(workDir, "providers", name+".yaml")
}
