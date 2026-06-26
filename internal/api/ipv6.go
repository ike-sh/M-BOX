package api

import (
	"encoding/json"
	"net/http"

	"github.com/mbox/mbox/internal/config"
)

// IPv6Status 汇总当前 IPv6 相关开关，供面板判断是否存在「半开」风险。
type IPv6Status struct {
	Enabled    bool `json:"enabled"`    // 协调后的总开关（顶层 ipv6 && dns.ipv6）
	Top        bool `json:"top"`        // 顶层 ipv6
	DNS        bool `json:"dns"`        // dns.ipv6
	Consistent bool `json:"consistent"` // 顶层与 dns 是否一致（false=半开，存在泄漏风险）
}

func (s *Server) handleGetIPv6(w http.ResponseWriter, r *http.Request) {
	mc, err := config.LoadMihomo(s.cfg.ConfigPath())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, IPv6Status{
		Enabled:    mc.IPv6 && mc.DNS.IPv6,
		Top:        mc.IPv6,
		DNS:        mc.DNS.IPv6,
		Consistent: mc.IPv6 == mc.DNS.IPv6,
	})
}

func (s *Server) handleApplyIPv6(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable bool `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	s.cfgMu.Lock()
	err := config.ApplyIPv6(s.cfg.ConfigPath(), body.Enable)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	s.handleGetIPv6(w, r)
}
