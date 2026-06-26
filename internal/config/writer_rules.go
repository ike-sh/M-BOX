package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// AddRule 在 rules 序列中插入一条规则（插到 MATCH 之前，保证兜底规则始终在最后）。
func AddRule(path, rule string) error {
	return editConfig(path, func(root *yaml.Node) error {
		insertRuleBeforeMatch(root, rule)
		return nil
	})
}

// insertRuleBeforeMatch 把 rule 插入 rules 序列中 MATCH 兜底之前；已存在则不重复。
func insertRuleBeforeMatch(root *yaml.Node, rule string) {
	rules := mapGet(root, "rules")
	if rules == nil || rules.Kind != yaml.SequenceNode {
		rules = &yaml.Node{Kind: yaml.SequenceNode}
		mapSet(root, "rules", rules)
	}
	for _, r := range rules.Content {
		if r.Value == rule {
			return
		}
	}
	node := scalarStr(rule)
	insertAt := len(rules.Content)
	for i, r := range rules.Content {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(r.Value)), "MATCH") {
			insertAt = i
			break
		}
	}
	rules.Content = append(rules.Content[:insertAt],
		append([]*yaml.Node{node}, rules.Content[insertAt:]...)...)
}

// RemoveRule 从 rules 序列删除规则。优先精确匹配；若不存在精确匹配，则按
// 「前缀 + 逗号」匹配同一条带尾部选项的规则——因为面板里的规则文本来自 mihomo
// /rules（已剥离 no-resolve 等选项），而 config.yaml 里常写成
// `GEOIP,CN,DIRECT,no-resolve`，二者不会精确相等。这样可正确删除带选项的规则。
func RemoveRule(path, rule string) error {
	return editConfig(path, func(root *yaml.Node) error {
		rules := mapGet(root, "rules")
		if rules == nil || rules.Kind != yaml.SequenceNode {
			return nil
		}
		want := strings.TrimSpace(rule)
		prefix := want + ","
		out := rules.Content[:0]
		removed := false
		for _, r := range rules.Content {
			v := strings.TrimSpace(r.Value)
			// 只删第一条匹配项，避免误删多条同前缀规则。
			if !removed && (v == want || strings.HasPrefix(v, prefix)) {
				removed = true
				continue
			}
			out = append(out, r)
		}
		rules.Content = out
		return nil
	})
}

// UpdateRule 用 newRaw 原地替换 rules 序列中等于 oldRaw（或以 "oldRaw," 前缀匹配带
// 尾部选项如 no-resolve 的同一条）的第一条规则，**保留其在列表中的位置**。
// 面板"编辑规则"用它实现就地修改，而不是删除后重加（那样会丢失规则的优先级位置）。
func UpdateRule(path, oldRaw, newRaw string) error {
	oldRaw = strings.TrimSpace(oldRaw)
	newRaw = strings.TrimSpace(newRaw)
	if newRaw == "" {
		return fmt.Errorf("新规则不能为空")
	}
	return editConfig(path, func(root *yaml.Node) error {
		rules := mapGet(root, "rules")
		if rules == nil || rules.Kind != yaml.SequenceNode {
			return fmt.Errorf("配置中没有 rules 列表")
		}
		prefix := oldRaw + ","
		for i, r := range rules.Content {
			v := strings.TrimSpace(r.Value)
			if v == oldRaw || strings.HasPrefix(v, prefix) {
				// 若目标位置已是 newRaw，避免与列表中其它条目重复。
				for j, other := range rules.Content {
					if j != i && strings.TrimSpace(other.Value) == newRaw {
						return fmt.Errorf("规则已存在：%s", newRaw)
					}
				}
				rules.Content[i] = scalarStr(newRaw)
				return nil
			}
		}
		return fmt.Errorf("未找到要更新的规则：%s", oldRaw)
	})
}

// RuleProviderFilePath 返回某规则集缓存文件的绝对路径（workDir/rule-providers/<name>.yaml）。
func RuleProviderFilePath(workDir, name string) string {
	return filepath.Join(workDir, "rule-providers", name+".yaml")
}

// RuleProviderInfo 是配置文件里一个 rule-provider 的概要。
type RuleProviderInfo struct {
	Name     string
	Behavior string
	Type     string
	Format   string
}

// RuleProviders 读取 config.yaml 里定义的 rule-providers。用于面板展示「配置里已有、
// 但内核运行态尚未列出（如刚添加、远程还没下载完成/失败）」的规则集，避免列表空白。
func RuleProviders(path string) []RuleProviderInfo {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc struct {
		RuleProviders map[string]struct {
			Type     string `yaml:"type"`
			Behavior string `yaml:"behavior"`
			Format   string `yaml:"format"`
		} `yaml:"rule-providers"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	out := make([]RuleProviderInfo, 0, len(doc.RuleProviders))
	for name, p := range doc.RuleProviders {
		out = append(out, RuleProviderInfo{Name: name, Behavior: p.Behavior, Type: p.Type, Format: p.Format})
	}
	return out
}

// AddRuleProvider 把一个远程规则集注入 config.yaml 的 rule-providers，并追加一条
// RULE-SET 规则（插到 MATCH 之前）使其立即生效。providerPath 为相对工作目录的缓存路径。
func AddRuleProvider(path, name, url, behavior, format, target, providerPath string, intervalSec int) error {
	return editConfig(path, func(root *yaml.Node) error {
		providers := ensureMap(root, "rule-providers")
		entry := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(entry, "type", scalarStr("http"))
		mapSet(entry, "behavior", scalarStr(behavior))
		if format != "" {
			mapSet(entry, "format", scalarStr(format))
		}
		mapSet(entry, "url", scalarStr(url))
		mapSet(entry, "path", scalarStr(providerPath))
		mapSet(entry, "interval", scalarInt(intervalSec))
		mapSet(providers, name, entry)

		insertRuleBeforeMatch(root, "RULE-SET,"+name+","+target)
		return nil
	})
}

// RemoveRuleProvider 从 config.yaml 删除 rule-provider 及其对应的 RULE-SET 规则。
func RemoveRuleProvider(path, name string) error {
	return editConfig(path, func(root *yaml.Node) error {
		if providers := mapGet(root, "rule-providers"); providers != nil && providers.Kind == yaml.MappingNode {
			out := providers.Content[:0]
			for i := 0; i+1 < len(providers.Content); i += 2 {
				if providers.Content[i].Value != name {
					out = append(out, providers.Content[i], providers.Content[i+1])
				}
			}
			providers.Content = out
		}
		if rules := mapGet(root, "rules"); rules != nil && rules.Kind == yaml.SequenceNode {
			exact := "RULE-SET," + name
			prefix := exact + ","
			out := rules.Content[:0]
			for _, r := range rules.Content {
				v := strings.TrimSpace(r.Value)
				if v == exact || strings.HasPrefix(v, prefix) {
					continue
				}
				out = append(out, r)
			}
			rules.Content = out
		}
		return nil
	})
}
