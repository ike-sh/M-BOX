// Package store 提供 daemon 的轻量持久化：把订阅元数据、面板设置等以 JSON
// 落盘。MVP 阶段不引入 SQLite，分层 JSON 已足够。
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Subscription 是一条机场订阅的元数据（节点本身由 mihomo provider 拉取）。
type Subscription struct {
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	UpdatedAt time.Time `json:"updatedAt"`
	Interval  int       `json:"interval"` // 秒
	NodeCount int       `json:"nodeCount"`
	Upload    int64     `json:"upload"`
	Download  int64     `json:"download"`
	Total     int64     `json:"total"`
	Expire    int64     `json:"expire"` // unix 秒，0 表示无
	LastError string    `json:"lastError,omitempty"`
	// Disabled=true 时该订阅的 proxy-provider 不注入 mihomo（节点不可用），但保留元数据与
	// provider 文件。用 Disabled 而非 Enabled 是为了让历史数据（无此字段）默认为启用。
	Disabled bool `json:"disabled,omitempty"`
}

// Settings 面板侧的可持久化设置。
type Settings struct {
	AuthEnabled bool   `json:"authEnabled"`
	Theme       string `json:"theme"`
	// 节点测速参数（面板侧设置，不属于 mihomo 配置）：测速 URL、单次超时(ms)、自动测速间隔(秒)。
	TestURL      string `json:"testUrl,omitempty"`
	TestTimeout  int    `json:"testTimeout,omitempty"`
	TestInterval int    `json:"testInterval,omitempty"`
}

// DevicePolicy 是「按设备策略」的一条记录：把某个源 IP（局域网设备）的流量
// 指向特定策略组/目标（如某机场策略组、DIRECT 直连、REJECT 拦截）。
// 落地为 mihomo 规则 `SRC-IP-CIDR,<ip>,<target>` 并置于规则最前以最高优先级生效。
type DevicePolicy struct {
	ID      string `json:"id"`
	Name    string `json:"name"`    // 备注名，如「客厅电视」
	IP      string `json:"ip"`      // 设备 IP 或 CIDR，如 192.168.1.50 或 192.168.1.0/24
	Target  string `json:"target"`  // 目标策略组名 / DIRECT / REJECT
	Enabled bool   `json:"enabled"` // 关闭时不下发对应规则
}

// TrafficBucket 是某个时间桶的累计流量（上/下行字节）。
type TrafficBucket struct {
	Key  string `json:"key"`  // 小时桶 "2006-01-02T15"，天桶 "2006-01-02"
	Up   int64  `json:"up"`   // 累计上行字节
	Down int64  `json:"down"` // 累计下行字节
}

// TrafficStats 历史流量按小时/天聚合，跨重启持久化，供「流量统计」看板使用。
type TrafficStats struct {
	Hourly []TrafficBucket `json:"hourly"`
	Daily  []TrafficBucket `json:"daily"`
}

// Data 是整个持久化文档。
type Data struct {
	Subscriptions []Subscription `json:"subscriptions"`
	Settings      Settings       `json:"settings"`
	Devices       []DevicePolicy `json:"devices"`
	Traffic       TrafficStats   `json:"traffic"`
}

// Store 包装一份带锁的内存数据，并负责读写磁盘。
type Store struct {
	path string
	mu   sync.RWMutex
	data Data
}

// Open 从 path 加载持久化数据；文件不存在时返回空 store。
func Open(path string) (*Store, error) {
	s := &Store{path: path, data: Data{Settings: Settings{Theme: "dark"}}}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s.data)
	}
	return s, nil
}

func (s *Store) flush() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Subscriptions 返回订阅列表副本。
func (s *Store) Subscriptions() []Subscription {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Subscription, len(s.data.Subscriptions))
	copy(out, s.data.Subscriptions)
	return out
}

// UpsertSubscription 新增或更新一条订阅（以 Name 为主键）。
func (s *Store) UpsertSubscription(sub Subscription) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Subscriptions {
		if s.data.Subscriptions[i].Name == sub.Name {
			s.data.Subscriptions[i] = sub
			return s.flush()
		}
	}
	s.data.Subscriptions = append(s.data.Subscriptions, sub)
	return s.flush()
}

// SetSubscriptionEnabled 设置订阅的启用状态（持久化）。返回更新后的订阅副本与是否存在。
func (s *Store) SetSubscriptionEnabled(name string, enabled bool) (Subscription, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Subscriptions {
		if s.data.Subscriptions[i].Name == name {
			s.data.Subscriptions[i].Disabled = !enabled
			cp := s.data.Subscriptions[i]
			return cp, true, s.flush()
		}
	}
	return Subscription{}, false, nil
}

// RemoveSubscription 删除指定订阅。
func (s *Store) RemoveSubscription(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.data.Subscriptions[:0]
	for _, sub := range s.data.Subscriptions {
		if sub.Name != name {
			out = append(out, sub)
		}
	}
	s.data.Subscriptions = out
	return s.flush()
}

// Devices 返回设备策略列表副本。
func (s *Store) Devices() []DevicePolicy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]DevicePolicy, len(s.data.Devices))
	copy(out, s.data.Devices)
	return out
}

// UpsertDevice 新增或更新一条设备策略（以 ID 为主键）。
func (s *Store) UpsertDevice(d DevicePolicy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Devices {
		if s.data.Devices[i].ID == d.ID {
			s.data.Devices[i] = d
			return s.flush()
		}
	}
	s.data.Devices = append(s.data.Devices, d)
	return s.flush()
}

// RemoveDevice 删除指定设备策略。
func (s *Store) RemoveDevice(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.data.Devices[:0]
	for _, d := range s.data.Devices {
		if d.ID != id {
			out = append(out, d)
		}
	}
	s.data.Devices = out
	return s.flush()
}

// Settings 返回当前设置。
func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Settings
}

// TrafficStats 返回历史流量聚合的副本（切片深拷贝，避免外部持有内部数据）。
func (s *Store) TrafficStats() TrafficStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return TrafficStats{
		Hourly: append([]TrafficBucket(nil), s.data.Traffic.Hourly...),
		Daily:  append([]TrafficBucket(nil), s.data.Traffic.Daily...),
	}
}

// SaveTrafficStats 持久化历史流量聚合。
func (s *Store) SaveTrafficStats(t TrafficStats) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Traffic = TrafficStats{
		Hourly: append([]TrafficBucket(nil), t.Hourly...),
		Daily:  append([]TrafficBucket(nil), t.Daily...),
	}
	return s.flush()
}

// SaveSettings 保存设置。
func (s *Store) SaveSettings(set Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Settings = set
	return s.flush()
}
