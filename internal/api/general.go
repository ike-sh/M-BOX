package api

import (
	"encoding/json"
	"net/http"

	"github.com/mbox/mbox/internal/config"
)

// GeneralConfig 是「代理设置」页的综合配置视图（端口/基础/性能/网络/嗅探/GEO/认证）。
// 与前端 web/src/types GeneralConfig 严格对齐。运行模式(mode)与 IPv6 仍各用独立接口。
type GeneralConfig struct {
	MixedPort               int            `json:"mixedPort"`
	SocksPort               int            `json:"socksPort"`
	HTTPPort                int            `json:"httpPort"`
	AllowLan                bool           `json:"allowLan"`
	LogLevel                string         `json:"logLevel"`
	UnifiedDelay            bool           `json:"unifiedDelay"`
	TCPConcurrent           bool           `json:"tcpConcurrent"`
	FindProcessMode         string         `json:"findProcessMode"`
	GlobalClientFingerprint string         `json:"globalClientFingerprint"`
	InterfaceName           string         `json:"interfaceName"`
	RoutingMark             int            `json:"routingMark"`
	KeepAliveInterval       int            `json:"keepAliveInterval"`
	KeepAliveIdle           int            `json:"keepAliveIdle"`
	DisableKeepAlive        bool           `json:"disableKeepAlive"`
	GlobalUA                string         `json:"globalUa"`
	GeodataMode             bool           `json:"geodataMode"`
	GeoAutoUpdate           bool           `json:"geoAutoUpdate"`
	GeoUpdateInterval       int            `json:"geoUpdateInterval"`
	GeodataLoader           string         `json:"geodataLoader"`
	Authentication          []string       `json:"authentication"`
	Sniffer                 GeneralSniffer `json:"sniffer"`
	// 节点测速参数（面板侧设置，存 store，不写 config.yaml；由节点测试接口使用）。
	TestURL      string `json:"testUrl"`
	TestTimeout  int    `json:"testTimeout"`
	TestInterval int    `json:"testInterval"`
}

// testSettings 返回节点测速参数（带默认值）：测速 URL / 单次超时(ms) / 自动测速间隔(秒)。
func (s *Server) testSettings() (url string, timeout, interval int) {
	st := s.store.Settings()
	url = st.TestURL
	// 空值或旧的明文 gstatic 默认一律升级为 https：明文 generate_204 在部分网络
	// 会被针对性干扰（实测 http 超时、https 正常），导致节点延迟误判为超时。
	if url == "" || url == "http://www.gstatic.com/generate_204" {
		url = "https://www.gstatic.com/generate_204"
	}
	timeout = st.TestTimeout
	if timeout <= 0 {
		timeout = 5000
	}
	interval = st.TestInterval
	if interval <= 0 {
		interval = 300
	}
	return
}

// GeneralSniffer 流量嗅探的面板视图（三种协议用布尔开关表达）。
type GeneralSniffer struct {
	Enable              bool `json:"enable"`
	OverrideDestination bool `json:"overrideDestination"`
	HTTP                bool `json:"http"`
	TLS                 bool `json:"tls"`
	QUIC                bool `json:"quic"`
}

func (s *Server) handleGetGeneralFull(w http.ResponseWriter, r *http.Request) {
	mc, err := config.LoadMihomo(s.cfg.ConfigPath())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	testURL, testTimeout, testInterval := s.testSettings()
	writeJSON(w, http.StatusOK, GeneralConfig{
		MixedPort:               mc.MixedPort,
		SocksPort:               mc.SocksPort,
		HTTPPort:                mc.HTTPPort,
		AllowLan:                mc.AllowLan,
		LogLevel:                orStr(mc.LogLevel, "info"),
		UnifiedDelay:            mc.UnifiedDelay,
		TCPConcurrent:           mc.TCPConcurrent,
		FindProcessMode:         orStr(mc.FindProcessMode, "off"),
		GlobalClientFingerprint: mc.GlobalClientFingerprint,
		InterfaceName:           mc.InterfaceName,
		RoutingMark:             mc.RoutingMark,
		KeepAliveInterval:       mc.KeepAliveInterval,
		KeepAliveIdle:           mc.KeepAliveIdle,
		DisableKeepAlive:        mc.DisableKeepAlive,
		GlobalUA:                mc.GlobalUA,
		GeodataMode:             mc.GeodataMode,
		GeoAutoUpdate:           mc.GeoAutoUpdate,
		GeoUpdateInterval:       mc.GeoUpdateInterval,
		GeodataLoader:           orStr(mc.GeodataLoader, "memconservative"),
		Authentication:          nilSafe(mc.Authentication),
		Sniffer: GeneralSniffer{
			Enable:              mc.Sniffer.Enable,
			OverrideDestination: mc.Sniffer.OverrideDestination,
			HTTP:                mc.Sniffer.SniffEnabled("HTTP"),
			TLS:                 mc.Sniffer.SniffEnabled("TLS"),
			QUIC:                mc.Sniffer.SniffEnabled("QUIC"),
		},
		TestURL:      testURL,
		TestTimeout:  testTimeout,
		TestInterval: testInterval,
	})
}

func (s *Server) handleApplyGeneral(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MixedPort               *int      `json:"mixedPort"`
		SocksPort               *int      `json:"socksPort"`
		HTTPPort                *int      `json:"httpPort"`
		AllowLan                *bool     `json:"allowLan"`
		LogLevel                *string   `json:"logLevel"`
		UnifiedDelay            *bool     `json:"unifiedDelay"`
		TCPConcurrent           *bool     `json:"tcpConcurrent"`
		FindProcessMode         *string   `json:"findProcessMode"`
		GlobalClientFingerprint *string   `json:"globalClientFingerprint"`
		InterfaceName           *string   `json:"interfaceName"`
		RoutingMark             *int      `json:"routingMark"`
		KeepAliveInterval       *int      `json:"keepAliveInterval"`
		KeepAliveIdle           *int      `json:"keepAliveIdle"`
		DisableKeepAlive        *bool     `json:"disableKeepAlive"`
		GlobalUA                *string   `json:"globalUa"`
		GeodataMode             *bool     `json:"geodataMode"`
		GeoAutoUpdate           *bool     `json:"geoAutoUpdate"`
		GeoUpdateInterval       *int      `json:"geoUpdateInterval"`
		GeodataLoader           *string   `json:"geodataLoader"`
		Authentication          *[]string `json:"authentication"`
		Sniffer                 *struct {
			Enable              bool `json:"enable"`
			OverrideDestination bool `json:"overrideDestination"`
			HTTP                bool `json:"http"`
			TLS                 bool `json:"tls"`
			QUIC                bool `json:"quic"`
		} `json:"sniffer"`
		TestURL      *string `json:"testUrl"`
		TestTimeout  *int    `json:"testTimeout"`
		TestInterval *int    `json:"testInterval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	patch := config.GeneralPatch{
		MixedPort:               body.MixedPort,
		SocksPort:               body.SocksPort,
		HTTPPort:                body.HTTPPort,
		AllowLan:                body.AllowLan,
		LogLevel:                body.LogLevel,
		UnifiedDelay:            body.UnifiedDelay,
		TCPConcurrent:           body.TCPConcurrent,
		FindProcessMode:         body.FindProcessMode,
		GlobalClientFingerprint: body.GlobalClientFingerprint,
		InterfaceName:           body.InterfaceName,
		RoutingMark:             body.RoutingMark,
		KeepAliveInterval:       body.KeepAliveInterval,
		KeepAliveIdle:           body.KeepAliveIdle,
		DisableKeepAlive:        body.DisableKeepAlive,
		GlobalUA:                body.GlobalUA,
		GeodataMode:             body.GeodataMode,
		GeoAutoUpdate:           body.GeoAutoUpdate,
		GeoUpdateInterval:       body.GeoUpdateInterval,
		GeodataLoader:           body.GeodataLoader,
		Authentication:          body.Authentication,
	}
	if body.Sniffer != nil {
		patch.Sniffer = &config.SnifferPatch{
			Enable:              body.Sniffer.Enable,
			OverrideDestination: body.Sniffer.OverrideDestination,
			HTTP:                body.Sniffer.HTTP,
			TLS:                 body.Sniffer.TLS,
			QUIC:                body.Sniffer.QUIC,
		}
	}

	// 节点测速参数存面板侧(store)，不写 config.yaml、无需热重载。
	if body.TestURL != nil || body.TestTimeout != nil || body.TestInterval != nil {
		st := s.store.Settings()
		if body.TestURL != nil {
			st.TestURL = *body.TestURL
		}
		if body.TestTimeout != nil {
			st.TestTimeout = *body.TestTimeout
		}
		if body.TestInterval != nil {
			st.TestInterval = *body.TestInterval
		}
		_ = s.store.SaveSettings(st)
	}

	s.cfgMu.Lock()
	err := config.ApplyGeneral(s.cfg.ConfigPath(), patch)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	s.handleGetGeneralFull(w, r)
}
