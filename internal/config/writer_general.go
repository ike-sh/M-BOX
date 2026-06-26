package config

import "gopkg.in/yaml.v3"

// GeneralPatch 用指针表示「仅修改提供的字段」，统一承载「代理设置」页的综合配置。
type GeneralPatch struct {
	MixedPort               *int
	SocksPort               *int
	HTTPPort                *int
	AllowLan                *bool
	LogLevel                *string
	UnifiedDelay            *bool
	TCPConcurrent           *bool
	FindProcessMode         *string
	GlobalClientFingerprint *string
	InterfaceName           *string
	RoutingMark             *int
	KeepAliveInterval       *int
	KeepAliveIdle           *int
	DisableKeepAlive        *bool
	GlobalUA                *string
	GeodataMode             *bool
	GeoAutoUpdate           *bool
	GeoUpdateInterval       *int
	GeodataLoader           *string
	Authentication          *[]string
	Sniffer                 *SnifferPatch
}

// SnifferPatch 描述嗅探开关与三种协议是否启用（启用则写入默认端口段）。
type SnifferPatch struct {
	Enable              bool
	OverrideDestination bool
	HTTP                bool
	TLS                 bool
	QUIC                bool
}

// ApplyGeneral 把「代理设置」页的综合配置写回 config.yaml（仅写非 nil 字段）。
func ApplyGeneral(path string, f GeneralPatch) error {
	return editConfig(path, func(root *yaml.Node) error {
		setInt := func(k string, v *int) {
			if v != nil {
				mapSet(root, k, scalarInt(*v))
			}
		}
		setBool := func(k string, v *bool) {
			if v != nil {
				mapSet(root, k, scalarBool(*v))
			}
		}
		setStr := func(k string, v *string) {
			if v != nil {
				mapSet(root, k, scalarStr(*v))
			}
		}
		setInt("mixed-port", f.MixedPort)
		setInt("socks-port", f.SocksPort)
		setInt("port", f.HTTPPort)
		setBool("allow-lan", f.AllowLan)
		setStr("log-level", f.LogLevel)
		setBool("unified-delay", f.UnifiedDelay)
		setBool("tcp-concurrent", f.TCPConcurrent)
		setStr("find-process-mode", f.FindProcessMode)
		setStr("global-client-fingerprint", f.GlobalClientFingerprint)
		setStr("interface-name", f.InterfaceName)
		setInt("routing-mark", f.RoutingMark)
		setInt("keep-alive-interval", f.KeepAliveInterval)
		setInt("keep-alive-idle", f.KeepAliveIdle)
		setBool("disable-keep-alive", f.DisableKeepAlive)
		setStr("global-ua", f.GlobalUA)
		setBool("geodata-mode", f.GeodataMode)
		setBool("geo-auto-update", f.GeoAutoUpdate)
		setInt("geo-update-interval", f.GeoUpdateInterval)
		setStr("geodata-loader", f.GeodataLoader)
		if f.Authentication != nil {
			mapSet(root, "authentication", seqOf(*f.Authentication))
		}
		if f.Sniffer != nil {
			sn := ensureMap(root, "sniffer")
			mapSet(sn, "enable", scalarBool(f.Sniffer.Enable))
			mapSet(sn, "override-destination", scalarBool(f.Sniffer.OverrideDestination))
			sniff := &yaml.Node{Kind: yaml.MappingNode}
			if f.Sniffer.HTTP {
				mapSet(sniff, "HTTP", snifferProtoNode([]string{"80", "8080-8880"}))
			}
			if f.Sniffer.TLS {
				mapSet(sniff, "TLS", snifferProtoNode([]string{"443", "8443"}))
			}
			if f.Sniffer.QUIC {
				mapSet(sniff, "QUIC", snifferProtoNode([]string{"443"}))
			}
			mapSet(sn, "sniff", sniff)
		}
		return nil
	})
}

// snifferProtoNode 构造单个嗅探协议节点 {ports: [...]}。
func snifferProtoNode(ports []string) *yaml.Node {
	m := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(m, "ports", seqOf(ports))
	return m
}

// SetMode 写回顶层 mode（rule/global/direct）。
func SetMode(path, mode string) error {
	return editConfig(path, func(root *yaml.Node) error {
		mapSet(root, "mode", scalarStr(mode))
		return nil
	})
}

// SetSecret 写回顶层 external-controller 的 secret（鉴权口令）。
func SetSecret(path, secret string) error {
	return editConfig(path, func(root *yaml.Node) error {
		mapSet(root, "secret", scalarStr(secret))
		return nil
	})
}
