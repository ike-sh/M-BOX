package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mbox/mbox/internal/config"
)

func (s *Server) handleTUN(w http.ResponseWriter, r *http.Request) {
	mc, err := config.LoadMihomo(s.cfg.ConfigPath())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, TunConfig{
		Enable:                 mc.TUN.Enable,
		Device:                 mc.TUN.Device,
		Stack:                  orStr(mc.TUN.Stack, "mixed"),
		AutoRoute:              mc.TUN.AutoRoute,
		AutoRedirect:           mc.TUN.AutoRedirect,
		StrictRoute:            mc.TUN.StrictRoute,
		Gso:                    mc.TUN.Gso,
		EndpointIndependentNat: mc.TUN.EndpointIndependentNat,
		DNSHijack:              nilSafe(mc.TUN.DNSHijack),
		ExcludeCidr:            excludeCidrFromRules(mc.Rules),
	})
}

func (s *Server) handleApplyTUN(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable                 *bool     `json:"enable"`
		Stack                  *string   `json:"stack"`
		AutoRoute              *bool     `json:"autoRoute"`
		AutoRedirect           *bool     `json:"autoRedirect"`
		StrictRoute            *bool     `json:"strictRoute"`
		Gso                    *bool     `json:"gso"`
		EndpointIndependentNat *bool     `json:"endpointIndependentNat"`
		ExcludeCidr            *[]string `json:"excludeCidr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	s.cfgMu.Lock()
	err := config.ApplyTUN(s.cfg.ConfigPath(), config.TUNPatch{
		Enable:                 body.Enable,
		Stack:                  body.Stack,
		AutoRoute:              body.AutoRoute,
		AutoRedirect:           body.AutoRedirect,
		StrictRoute:            body.StrictRoute,
		Gso:                    body.Gso,
		EndpointIndependentNat: body.EndpointIndependentNat,
	})
	if err == nil && body.ExcludeCidr != nil {
		err = config.SetExcludeCidr(s.cfg.ConfigPath(), *body.ExcludeCidr)
	}
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	s.handleTUN(w, r)
}

// excludeCidrFromRules 从规则里抽取直连的 IP-CIDR（即局域网/排除网段）。
func excludeCidrFromRules(rules []string) []string {
	out := []string{}
	for _, r := range rules {
		parts := strings.Split(r, ",")
		if len(parts) >= 3 && strings.EqualFold(strings.TrimSpace(parts[0]), "IP-CIDR") &&
			strings.EqualFold(strings.TrimSpace(parts[2]), "DIRECT") {
			out = append(out, strings.TrimSpace(parts[1]))
		}
	}
	return out
}
