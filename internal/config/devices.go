package config

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// DeviceRule 是「按设备策略」下发到 mihomo 的一条规则原料。
type DeviceRule struct {
	IP     string // 设备 IP 或 CIDR
	Target string // 目标策略组 / DIRECT / REJECT
}

// normalizeSrcCidr 把裸 IP 补成 CIDR：IPv4 -> /32，IPv6 -> /128；已带掩码则原样返回。
func normalizeSrcCidr(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" || strings.Contains(ip, "/") {
		return ip
	}
	if strings.Contains(ip, ":") {
		return ip + "/128"
	}
	return ip + "/32"
}

// SetDevicePolicies 用给定设备策略替换 rules 里所有 `SRC-IP-CIDR,...` 规则，
// 并把它们放在规则序列最前面，使按设备分流拥有最高优先级（先于 GEOIP/域名等规则）。
// 其它规则保持原有相对顺序。
func SetDevicePolicies(path string, rules []DeviceRule) error {
	return editConfig(path, func(root *yaml.Node) error {
		rs := mapGet(root, "rules")
		if rs == nil || rs.Kind != yaml.SequenceNode {
			rs = &yaml.Node{Kind: yaml.SequenceNode}
			mapSet(root, "rules", rs)
		}
		// 移除已存在的 SRC-IP-CIDR 规则，保留其余。
		kept := make([]*yaml.Node, 0, len(rs.Content))
		for _, r := range rs.Content {
			parts := strings.Split(r.Value, ",")
			if len(parts) >= 1 && strings.EqualFold(strings.TrimSpace(parts[0]), "SRC-IP-CIDR") {
				continue
			}
			kept = append(kept, r)
		}
		// 构造新的设备规则，置于最前。
		add := make([]*yaml.Node, 0, len(rules))
		for _, d := range rules {
			cidr := normalizeSrcCidr(d.IP)
			target := strings.TrimSpace(d.Target)
			if cidr == "" || target == "" {
				continue
			}
			add = append(add, scalarStr("SRC-IP-CIDR,"+cidr+","+target))
		}
		rs.Content = append(add, kept...)
		return nil
	})
}
