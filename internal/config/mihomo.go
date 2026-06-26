package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// MihomoConfig 只反序列化面板需要回显的字段，其余字段忽略（mihomo 配置很大）。
type MihomoConfig struct {
	Mode               string         `yaml:"mode"`
	IPv6               bool           `yaml:"ipv6"`
	ExternalController string         `yaml:"external-controller"`
	Secret             string         `yaml:"secret"`
	TUN                TUNConfig      `yaml:"tun"`
	DNS                DNSConfig      `yaml:"dns"`
	Hosts              map[string]any `yaml:"hosts"`
	Rules              []string       `yaml:"rules"`
	ProxyProviders     map[string]any `yaml:"proxy-providers"`

	// ── 综合代理设置（「代理设置」页统一管理）────────────────────────────
	MixedPort               int           `yaml:"mixed-port"`
	SocksPort               int           `yaml:"socks-port"`
	HTTPPort                int           `yaml:"port"`
	AllowLan                bool          `yaml:"allow-lan"`
	LogLevel                string        `yaml:"log-level"`
	UnifiedDelay            bool          `yaml:"unified-delay"`
	TCPConcurrent           bool          `yaml:"tcp-concurrent"`
	FindProcessMode         string        `yaml:"find-process-mode"`
	GlobalClientFingerprint string        `yaml:"global-client-fingerprint"`
	InterfaceName           string        `yaml:"interface-name"`
	RoutingMark             int           `yaml:"routing-mark"`
	KeepAliveInterval       int           `yaml:"keep-alive-interval"`
	KeepAliveIdle           int           `yaml:"keep-alive-idle"`
	DisableKeepAlive        bool          `yaml:"disable-keep-alive"`
	GlobalUA                string        `yaml:"global-ua"`
	GeodataMode             bool          `yaml:"geodata-mode"`
	GeoAutoUpdate           bool          `yaml:"geo-auto-update"`
	GeoUpdateInterval       int           `yaml:"geo-update-interval"`
	GeodataLoader           string        `yaml:"geodata-loader"`
	Authentication          []string      `yaml:"authentication"`
	Sniffer                 SnifferConfig `yaml:"sniffer"`
}

// SnifferConfig 流量嗅探（从握手提取真实域名用于按域名分流）。
type SnifferConfig struct {
	Enable              bool           `yaml:"enable"`
	OverrideDestination bool           `yaml:"override-destination"`
	Sniff               map[string]any `yaml:"sniff"`
}

// SniffEnabled 判断某协议(HTTP/TLS/QUIC)是否在嗅探列表内。
func (c SnifferConfig) SniffEnabled(proto string) bool {
	if c.Sniff == nil {
		return false
	}
	_, ok := c.Sniff[proto]
	return ok
}

// TUNConfig 透明代理相关。
type TUNConfig struct {
	Enable                 bool     `yaml:"enable"`
	Device                 string   `yaml:"device"`
	Stack                  string   `yaml:"stack"`
	AutoRoute              bool     `yaml:"auto-route"`
	AutoRedirect           bool     `yaml:"auto-redirect"`
	AutoDetectInterface    bool     `yaml:"auto-detect-interface"`
	StrictRoute            bool     `yaml:"strict-route"`
	Gso                    bool     `yaml:"gso"`
	EndpointIndependentNat bool     `yaml:"endpoint-independent-nat"`
	DNSHijack              []string `yaml:"dns-hijack"`
}

// DNSConfig DNS 相关。
type DNSConfig struct {
	Enable           bool     `yaml:"enable"`
	Listen           string   `yaml:"listen"`
	IPv6             bool     `yaml:"ipv6"`
	EnhancedMode     string   `yaml:"enhanced-mode"`
	FakeIPRange      string   `yaml:"fake-ip-range"`
	FakeIPFilter     []string `yaml:"fake-ip-filter"`
	FakeIPFilterMode string   `yaml:"fake-ip-filter-mode"`
	Nameserver       []string `yaml:"nameserver"`
	Default          []string `yaml:"default-nameserver"`
	// NameserverPolicy 以原始 yaml.Node 保存，保留配置中的出现顺序——nameserver-policy
	// 在 mihomo 里按顺序匹配，用 map 读回会丢序导致重叠规则优先级漂移。
	NameserverPolicy           yaml.Node               `yaml:"nameserver-policy"`
	ProxyServerNameserver      []string                `yaml:"proxy-server-nameserver"`
	DirectNameserver           []string                `yaml:"direct-nameserver"`
	DirectNameserverFollowRule bool                    `yaml:"direct-nameserver-follow-policy"`
	Fallback                   []string                `yaml:"fallback"`
	FallbackFilter             DNSFallbackFilterConfig `yaml:"fallback-filter"`
	CacheAlgorithm             string                  `yaml:"cache-algorithm"`
	RespectRules               bool                    `yaml:"respect-rules"`
	PreferH3                   bool                    `yaml:"prefer-h3"`
	UseHosts                   bool                    `yaml:"use-hosts"`
	UseSystemHosts             bool                    `yaml:"use-system-hosts"`
}

// DNSFallbackFilterConfig 防污染过滤（命中条件的解析结果改用 fallback 上游）。
type DNSFallbackFilterConfig struct {
	GeoIP     bool     `yaml:"geoip"`
	GeoIPCode string   `yaml:"geoip-code"`
	GeoSite   []string `yaml:"geosite"`
	IPCIDR    []string `yaml:"ipcidr"`
	Domain    []string `yaml:"domain"`
}

// PolicyKV 是一条有序的 nameserver-policy 条目（保留配置中的出现顺序）。
type PolicyKV struct {
	Key     string
	Servers []string
}

// NameserverPolicyOrdered 按 YAML 出现顺序解析 nameserver-policy 为有序条目，
// 避免用 map 读回丢序导致重叠规则优先级漂移。
func (c DNSConfig) NameserverPolicyOrdered() []PolicyKV {
	n := c.NameserverPolicy
	if n.Kind != yaml.MappingNode {
		return nil
	}
	out := make([]PolicyKV, 0, len(n.Content)/2)
	for i := 0; i+1 < len(n.Content); i += 2 {
		out = append(out, PolicyKV{Key: n.Content[i].Value, Servers: nodeStrings(n.Content[i+1])})
	}
	return out
}

// nodeStrings 把一个 yaml 值节点（标量或序列）规整为字符串切片。
func nodeStrings(n *yaml.Node) []string {
	if n == nil {
		return nil
	}
	switch n.Kind {
	case yaml.ScalarNode:
		if n.Value == "" {
			return nil
		}
		return []string{n.Value}
	case yaml.SequenceNode:
		out := make([]string, 0, len(n.Content))
		for _, e := range n.Content {
			if e.Value != "" {
				out = append(out, e.Value)
			}
		}
		return out
	default:
		return nil
	}
}

// LoadMihomo 读取并解析 mihomo 配置文件。文件不存在时返回零值与 nil 错误，
// 让面板能优雅显示「未配置」而非报错。
func LoadMihomo(path string) (*MihomoConfig, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &MihomoConfig{}, nil
		}
		return nil, err
	}
	var c MihomoConfig
	if err := yaml.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
