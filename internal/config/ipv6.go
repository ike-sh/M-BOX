package config

import "gopkg.in/yaml.v3"

// ApplyIPv6 一处协调全局 IPv6 开关，避免「半开」导致 IPv6 流量绕过代理而泄漏：
// 要么全程启用（顶层 ipv6 + dns.ipv6 同时开），要么干净关闭（两者同时关）。
// 关闭时同时把 dns.ipv6 关掉，确保不解析出 AAAA 记录、不产生未代理的 IPv6 直连。
func ApplyIPv6(path string, enable bool) error {
	return editConfig(path, func(root *yaml.Node) error {
		mapSet(root, "ipv6", scalarBool(enable))
		dns := ensureMap(root, "dns")
		mapSet(dns, "ipv6", scalarBool(enable))
		return nil
	})
}
