package api

// 以下 DTO 的 JSON 字段与前端 web/src/types/index.ts 严格对齐。

type ProxyNode struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Region     string  `json:"region"`
	Flag       string  `json:"flag"`
	Delay      int     `json:"delay"`
	Multiplier float64 `json:"multiplier,omitempty"`
	UDP        bool    `json:"udp"`
}

type ProxyGroup struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Now     string   `json:"now"`
	Proxies []string `json:"proxies"`
}

type ProxiesResp struct {
	Nodes  []ProxyNode  `json:"nodes"`
	Groups []ProxyGroup `json:"groups"`
}

type Subscription struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	URL       string  `json:"url"`
	Used      float64 `json:"used"`
	Total     float64 `json:"total"`
	Expire    string  `json:"expire"`
	NodeCount int     `json:"nodeCount"`
	UpdatedAt string  `json:"updatedAt"`
	Interval  int     `json:"interval"`
	Enabled   bool    `json:"enabled"`
}

type RuleItem struct {
	Type    string `json:"type"`
	Payload string `json:"payload"`
	Target  string `json:"target"`
	Hit     int    `json:"hit,omitempty"`
}

type RuleProvider struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Behavior  string `json:"behavior"`
	Count     int    `json:"count"`
	UpdatedAt string `json:"updatedAt"`
}

type RulesResp struct {
	Rules     []RuleItem     `json:"rules"`
	Providers []RuleProvider `json:"providers"`
}

type Connection struct {
	ID       string   `json:"id"`
	Host     string   `json:"host"`
	DestIP   string   `json:"destIP"`
	SourceIP string   `json:"sourceIP,omitempty"`
	Type     string   `json:"type"`
	Rule     string   `json:"rule"`
	Chain    []string `json:"chain"`
	Upload   int64    `json:"upload"`
	Download int64    `json:"download"`
	ULSpeed  int64    `json:"ulSpeed"`
	DLSpeed  int64    `json:"dlSpeed"`
	Start    int64    `json:"start"`
	Process  string   `json:"process,omitempty"`
}

type SystemInfo struct {
	Hostname    string     `json:"hostname"`
	OS          string     `json:"os"`
	Kernel      string     `json:"kernel"`
	Uptime      string     `json:"uptime"`
	CPU         float64    `json:"cpu"`
	Mem         Pair       `json:"mem"`
	Disk        Pair       `json:"disk"`
	LoadAvg     [3]float64 `json:"loadavg"`
	Core        CoreInfo   `json:"core"`
	MBoxVersion string     `json:"mboxVersion"` // M-BOX 自身版本
}

type CoreInfo struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Managed bool   `json:"managed"`
	Error   string `json:"error,omitempty"`
}

type Pair struct {
	Used  float64 `json:"used"`
	Total float64 `json:"total"`
}

type DnsConfig struct {
	Enable                     bool              `json:"enable"`
	EnhancedMode               string            `json:"enhancedMode"`
	FakeIPRange                string            `json:"fakeIpRange"`
	Listen                     string            `json:"listen"`
	IPv6                       bool              `json:"ipv6"`
	Nameservers                []string          `json:"nameservers"`
	DefaultNameservers         []string          `json:"defaultNameservers"`
	FakeIPFilter               []string          `json:"fakeIpFilter"`
	FakeIPFilterMode           string            `json:"fakeIpFilterMode"`
	NameserverPolicy           []DnsPolicyEntry  `json:"nameserverPolicy"`
	ProxyServerNameserver      []string          `json:"proxyServerNameserver"`
	DirectNameserver           []string          `json:"directNameserver"`
	DirectNameserverFollowRule bool              `json:"directNameserverFollowRule"`
	Fallback                   []string          `json:"fallback"`
	FallbackFilter             DnsFallbackFilter `json:"fallbackFilter"`
	CacheAlgorithm             string            `json:"cacheAlgorithm"`
	RespectRules               bool              `json:"respectRules"`
	AdBlock                    bool              `json:"adBlock"`
	PreferH3                   bool              `json:"preferH3"`
	UseHosts                   bool              `json:"useHosts"`
	UseSystemHosts             bool              `json:"useSystemHosts"`
	Hosts                      []DnsHostEntry    `json:"hosts"`
}

// DnsPolicyEntry 域名分流条目。
type DnsPolicyEntry struct {
	Domain  string   `json:"domain"`
	Servers []string `json:"servers"`
}

// DnsHostEntry 自定义 hosts 条目。
type DnsHostEntry struct {
	Domain string   `json:"domain"`
	Values []string `json:"values"`
}

// DnsFallbackFilter 防污染过滤条件。
type DnsFallbackFilter struct {
	GeoIP     bool     `json:"geoip"`
	GeoIPCode string   `json:"geoipCode"`
	GeoSite   []string `json:"geosite"`
	IPCIDR    []string `json:"ipcidr"`
	Domain    []string `json:"domain"`
}

type TunConfig struct {
	Enable                 bool     `json:"enable"`
	Device                 string   `json:"device"`
	Stack                  string   `json:"stack"`
	AutoRoute              bool     `json:"autoRoute"`
	AutoRedirect           bool     `json:"autoRedirect"`
	StrictRoute            bool     `json:"strictRoute"`
	Gso                    bool     `json:"gso"`
	EndpointIndependentNat bool     `json:"endpointIndependentNat"`
	DNSHijack              []string `json:"dnsHijack"`
	ExcludeCidr            []string `json:"excludeCidr"`
}

type DiagItem struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Desc   string `json:"desc"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type TrafficMsg struct {
	Up   int64 `json:"up"`
	Down int64 `json:"down"`
}

// TrafficPoint 是「流量统计」看板的一条历史采样，字段与前端
// web/src/types TrafficPoint 严格对齐（速率单位 KB/s）。
// Ts 为 unix 毫秒时间戳，便于前端精确对齐/跨日聚合；T 保留人类可读时分秒以兼容旧前端。
type TrafficPoint struct {
	T    string `json:"t"`
	Ts   int64  `json:"ts"`
	Up   int64  `json:"up"`   // KB/s
	Down int64  `json:"down"` // KB/s
}
