package api

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/store"
)

// DeviceDTO 与前端 web/src/types DevicePolicy 对齐。
type DeviceDTO struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	IP      string `json:"ip"`
	Target  string `json:"target"`
	Enabled bool   `json:"enabled"`
}

func toDeviceDTO(d store.DevicePolicy) DeviceDTO {
	return DeviceDTO{ID: d.ID, Name: d.Name, IP: d.IP, Target: d.Target, Enabled: d.Enabled}
}

// DeviceLive 是按源 IP（局域网设备）聚合的实时连接/流量，用于设备页「在线设备」面板。
type DeviceLive struct {
	IP        string `json:"ip"`
	ConnCount int    `json:"connCount"`
	ULSpeed   int64  `json:"ulSpeed"`
	DLSpeed   int64  `json:"dlSpeed"`
	Upload    int64  `json:"upload"`
	Download  int64  `json:"download"`
}

// handleDevicesLive 从 mihomo 当前连接快照按源 IP 聚合出每台设备的活动连接数与实时速率，
// 让用户在网关上看到「哪些设备在线、各自跑了多少流量」。无源 IP 的连接（如本机发起）忽略。
func (s *Server) handleDevicesLive(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	raw, err := s.client.Connections(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	conns := transformConnections(raw)
	s.devSpeed.fill(conns)

	agg := map[string]*DeviceLive{}
	for i := range conns {
		c := &conns[i]
		ip := c.SourceIP
		if ip == "" {
			continue
		}
		d := agg[ip]
		if d == nil {
			d = &DeviceLive{IP: ip}
			agg[ip] = d
		}
		d.ConnCount++
		d.ULSpeed += c.ULSpeed
		d.DLSpeed += c.DLSpeed
		d.Upload += c.Upload
		d.Download += c.Download
	}

	out := make([]DeviceLive, 0, len(agg))
	for _, d := range agg {
		out = append(out, *d)
	}
	// 按实时总速率降序，最活跃设备排前。
	sort.Slice(out, func(i, j int) bool {
		return out[i].DLSpeed+out[i].ULSpeed > out[j].DLSpeed+out[j].ULSpeed
	})
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	devs := s.store.Devices()
	out := make([]DeviceDTO, 0, len(devs))
	for _, d := range devs {
		out = append(out, toDeviceDTO(d))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleUpsertDevice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		IP      string `json:"ip"`
		Target  string `json:"target"`
		Enabled *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	if strings.TrimSpace(body.IP) == "" || strings.TrimSpace(body.Target) == "" {
		writeErr(w, http.StatusBadRequest, "缺少 ip 或 target")
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	dev := store.DevicePolicy{
		ID:      body.ID,
		Name:    strings.TrimSpace(body.Name),
		IP:      strings.TrimSpace(body.IP),
		Target:  strings.TrimSpace(body.Target),
		Enabled: enabled,
	}
	if dev.ID == "" {
		dev.ID = newID("dev")
	}
	if dev.Name == "" {
		dev.Name = dev.IP
	}
	if err := s.store.UpsertDevice(dev); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.syncDevices(r); err != nil {
		writeErr(w, http.StatusInternalServerError, "写入规则失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toDeviceDTO(dev))
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.RemoveDevice(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.syncDevices(r); err != nil {
		writeErr(w, http.StatusInternalServerError, "写入规则失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// syncDevices 把当前已启用的设备策略下发为 SRC-IP-CIDR 规则并热重载内核。
func (s *Server) syncDevices(r *http.Request) error {
	rules := make([]config.DeviceRule, 0)
	for _, d := range s.store.Devices() {
		if d.Enabled {
			rules = append(rules, config.DeviceRule{IP: d.IP, Target: d.Target})
		}
	}
	s.cfgMu.Lock()
	err := config.SetDevicePolicies(s.cfg.ConfigPath(), rules)
	s.cfgMu.Unlock()
	if err != nil {
		return err
	}
	s.reloadCore(r.Context())
	return nil
}

// newID 生成一个带前缀的简易唯一 id。纳秒时间戳 + 随机后缀，避免在低精度时钟
// 平台（如 Windows）上同一纳秒内连续生成（如批量告警/设备）时发生主键碰撞。
func newID(prefix string) string {
	return fmt.Sprintf("%s-%d-%04d", prefix, time.Now().UnixNano(), rand.Intn(10000))
}
