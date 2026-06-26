package config

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// TUNPatch 用指针表示「仅修改提供的字段」。
type TUNPatch struct {
	Enable                 *bool
	Stack                  *string
	AutoRoute              *bool
	AutoRedirect           *bool
	StrictRoute            *bool
	Gso                    *bool
	EndpointIndependentNat *bool
}

// ApplyTUN 把 TUN 相关开关写回 config.yaml（仅写传入的非 nil 字段）。
func ApplyTUN(path string, fields TUNPatch) error {
	return editConfig(path, func(root *yaml.Node) error {
		tun := ensureMap(root, "tun")
		if fields.Enable != nil {
			mapSet(tun, "enable", scalarBool(*fields.Enable))
		}
		if fields.Stack != nil {
			mapSet(tun, "stack", scalarStr(*fields.Stack))
		}
		if fields.AutoRoute != nil {
			mapSet(tun, "auto-route", scalarBool(*fields.AutoRoute))
		}
		if fields.AutoRedirect != nil {
			mapSet(tun, "auto-redirect", scalarBool(*fields.AutoRedirect))
		}
		if fields.StrictRoute != nil {
			mapSet(tun, "strict-route", scalarBool(*fields.StrictRoute))
		}
		if fields.Gso != nil {
			mapSet(tun, "gso", scalarBool(*fields.Gso))
			// gso 开启时一并写出 gso-max-size（mihomo 默认 65536），显式化便于排查。
			if *fields.Gso {
				mapSet(tun, "gso-max-size", scalarInt(65536))
			}
		}
		if fields.EndpointIndependentNat != nil {
			mapSet(tun, "endpoint-independent-nat", scalarBool(*fields.EndpointIndependentNat))
		}
		return nil
	})
}

// SetExcludeCidr 用给定的局域网/排除网段替换 rules 里所有 `IP-CIDR,<x>,DIRECT,no-resolve`，
// 这些规则保证对应网段直连（不走代理）。其它规则保持不变。
func SetExcludeCidr(path string, cidrs []string) error {
	return editConfig(path, func(root *yaml.Node) error {
		rules := mapGet(root, "rules")
		if rules == nil || rules.Kind != yaml.SequenceNode {
			rules = &yaml.Node{Kind: yaml.SequenceNode}
			mapSet(root, "rules", rules)
		}
		// 先移除既有的 IP-CIDR ...,DIRECT 规则。
		kept := make([]*yaml.Node, 0, len(rules.Content))
		insertAt := -1
		for _, r := range rules.Content {
			parts := strings.Split(r.Value, ",")
			isExclude := len(parts) >= 3 &&
				strings.EqualFold(strings.TrimSpace(parts[0]), "IP-CIDR") &&
				strings.EqualFold(strings.TrimSpace(parts[2]), "DIRECT")
			if isExclude {
				if insertAt < 0 {
					insertAt = len(kept)
				}
				continue
			}
			kept = append(kept, r)
		}
		if insertAt < 0 {
			insertAt = 0
		}
		// 构造新的排除规则。
		add := make([]*yaml.Node, 0, len(cidrs))
		for _, c := range cidrs {
			c = strings.TrimSpace(c)
			if c == "" {
				continue
			}
			add = append(add, scalarStr("IP-CIDR,"+c+",DIRECT,no-resolve"))
		}
		merged := make([]*yaml.Node, 0, len(kept)+len(add))
		merged = append(merged, kept[:insertAt]...)
		merged = append(merged, add...)
		merged = append(merged, kept[insertAt:]...)
		rules.Content = merged
		return nil
	})
}
