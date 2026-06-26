package config

import (
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// urlTestGroupTypes 是「节点感知」策略组类型（需要实际节点做健康检查/分桶）。
// 推荐模板生成的 ♻️自动选择 与地区组都属于此类；默认配置只含 select 组。
var urlTestGroupTypes = map[string]bool{
	"url-test": true, "urltest": true,
	"fallback": true, "load-balance": true, "loadbalance": true,
}

// IsTemplatePending 判断「节点感知的完整策略（自动测速 + 地区分桶）尚未生成」。
// 依据：proxy-groups 存在且非空，但其中**没有任何 url-test/fallback/load-balance 组**。
//   - 旧的基础默认（只有 手动选择/全球直连，全 select）→ true；
//   - 新的完整默认（一堆分类 select 组，但还没有自动/地区 url-test 组）→ true；
//   - 已套用过推荐模板（含 ♻️自动选择/地区 url-test 组）→ false（不再重复改写）；
//   - 用户自己建过 url-test 组的自定义配置 → false（不覆盖用户配置）。
//
// 用于：添加/更新订阅时，若仍处于 pending，则自动套用推荐模板补齐 自动测速 + 地区组
// （节点感知，只建确有节点的地区），把默认布局升级成跟参考模板一样的完整布局。
// 读不到/解析失败/无策略组时保守返回 false（不自动改动）。
func IsTemplatePending(path string) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return false
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return false
	}
	groups := mapGet(doc.Content[0], "proxy-groups")
	if groups == nil || groups.Kind != yaml.SequenceNode || len(groups.Content) == 0 {
		return false
	}
	for _, g := range groups.Content {
		if g.Kind != yaml.MappingNode {
			continue
		}
		if t := mapGet(g, "type"); t != nil && urlTestGroupTypes[strings.ToLower(strings.TrimSpace(t.Value))] {
			return false
		}
	}
	return true
}
