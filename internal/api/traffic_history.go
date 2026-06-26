package api

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/store"
)

const (
	// trafficHistoryCap 是秒级环形缓冲保留的点数，约等于看板首屏时间窗口。
	trafficHistoryCap = 120
	// trafficHourlyKeep / trafficDailyKeep 是聚合桶的保留上限（有界，防无限增长）。
	trafficHourlyKeep = 48 // 最近 48 小时
	trafficDailyKeep  = 60 // 最近 60 天
	// trafficFlushEvery 是聚合数据落盘的最小间隔，避免每秒写磁盘。
	trafficFlushEvery = 30 * time.Second
)

// trafficHistory 维护两层流量历史：
//  1. 秒级环形缓冲（points）——供看板首屏实时曲线；
//  2. 按小时/天聚合的累计量（hourly/daily）——节流持久化到 store，跨重启保留。
type trafficHistory struct {
	mu        sync.Mutex
	points    []TrafficPoint
	hourly    map[string]*store.TrafficBucket
	daily     map[string]*store.TrafficBucket
	store     *store.Store
	lastFlush time.Time
	// lastUpTotal/lastDownTotal 是上次见到的 mihomo 累计上/下行字节，用于对小时/天桶
	// 做单调差分；haveTotals 在首个采样后置位（首样仅建立基线，不计入增量）。
	lastUpTotal   int64
	lastDownTotal int64
	haveTotals    bool
}

// newTrafficHistory 构造历史流量记录器，并从 store 载入已持久化的聚合。
func newTrafficHistory(st *store.Store) *trafficHistory {
	h := &trafficHistory{
		points: make([]TrafficPoint, 0, trafficHistoryCap),
		hourly: map[string]*store.TrafficBucket{},
		daily:  map[string]*store.TrafficBucket{},
		store:  st,
	}
	if st != nil {
		prev := st.TrafficStats()
		for i := range prev.Hourly {
			b := prev.Hourly[i]
			h.hourly[b.Key] = &store.TrafficBucket{Key: b.Key, Up: b.Up, Down: b.Down}
		}
		for i := range prev.Daily {
			b := prev.Daily[i]
			h.daily[b.Key] = &store.TrafficBucket{Key: b.Key, Up: b.Up, Down: b.Down}
		}
	}
	h.lastFlush = time.Now()
	return h
}

// record 追加一条秒级速率点（仅用于看板首屏实时曲线）。upBytes/downBytes 为
// 「字节/秒」，转成 KB/s 存储。并发安全：WS 转发协程每收到一帧 /traffic 时调用。
// 注意：小时/天累计不再从这里的「速率」积分（间隔抖动会累积误差），改由
// recordTotals 基于 mihomo 累计量差分维护。
func (h *trafficHistory) record(upBytes, downBytes int64) {
	now := time.Now()
	h.mu.Lock()
	h.points = append(h.points, TrafficPoint{
		T:    now.Format("15:04:05"),
		Ts:   now.UnixMilli(),
		Up:   upBytes / 1024,
		Down: downBytes / 1024,
	})
	if len(h.points) > trafficHistoryCap {
		h.points = h.points[len(h.points)-trafficHistoryCap:]
	}
	h.mu.Unlock()
}

// recordTotals 用 mihomo 的累计上/下行字节（uploadTotal/downloadTotal）对小时/天桶做
// 单调差分累加，比把速率近似当增量更准，且与机场用量口径一致。
//   - 首次调用仅建立基线（haveTotals=false→true），不计增量；
//   - 增量为负（内核重启/计数归零）则跳过本次累加并以当前值重设基线。
//
// 由连接轮询协程定期调用（见 startDNSStats）。
func (h *trafficHistory) recordTotals(upTotal, downTotal int64) {
	now := time.Now()
	h.mu.Lock()
	if h.haveTotals {
		du := upTotal - h.lastUpTotal
		dd := downTotal - h.lastDownTotal
		if du >= 0 && dd >= 0 && (du > 0 || dd > 0) {
			addBucket(h.hourly, now.Format("2006-01-02T15"), du, dd)
			addBucket(h.daily, now.Format("2006-01-02"), du, dd)
		}
	}
	h.lastUpTotal = upTotal
	h.lastDownTotal = downTotal
	h.haveTotals = true

	// 节流持久化：距上次落盘达到阈值才写盘（构造快照在锁内，落盘在锁外）。
	var toSave *store.TrafficStats
	if h.store != nil && now.Sub(h.lastFlush) >= trafficFlushEvery {
		h.lastFlush = now
		s := h.buildStatsLocked()
		toSave = &s
	}
	h.mu.Unlock()

	if toSave != nil {
		_ = h.store.SaveTrafficStats(*toSave)
	}
}

// addBucket 把 up/down 累加进 key 对应的时间桶（不存在则新建）。
func addBucket(m map[string]*store.TrafficBucket, key string, up, down int64) {
	b := m[key]
	if b == nil {
		b = &store.TrafficBucket{Key: key}
		m[key] = b
	}
	b.Up += up
	b.Down += down
}

// buildStatsLocked 构造按时间升序、已裁剪到上限的聚合快照（须在持锁时调用）。
func (h *trafficHistory) buildStatsLocked() store.TrafficStats {
	return store.TrafficStats{
		Hourly: trimBuckets(h.hourly, trafficHourlyKeep),
		Daily:  trimBuckets(h.daily, trafficDailyKeep),
	}
}

// trimBuckets 把桶 map 转为按 Key 升序的切片，仅保留最近 keep 个，并同步裁剪 map 以防无限增长。
func trimBuckets(m map[string]*store.TrafficBucket, keep int) []store.TrafficBucket {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > keep {
		for _, k := range keys[:len(keys)-keep] {
			delete(m, k)
		}
		keys = keys[len(keys)-keep:]
	}
	out := make([]store.TrafficBucket, 0, len(keys))
	for _, k := range keys {
		out = append(out, *m[k])
	}
	return out
}

// snapshot 返回秒级历史采样副本（最旧在前）。
func (h *trafficHistory) snapshot() []TrafficPoint {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]TrafficPoint, len(h.points))
	copy(out, h.points)
	return out
}

// stats 返回按小时/天聚合的历史流量（已裁剪、升序）。
func (h *trafficHistory) stats() store.TrafficStats {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.buildStatsLocked()
}

// handleTrafficHistory 返回最近的秒级流量采样（GET /api/traffic），供看板首屏。
func (s *Server) handleTrafficHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.traffic.snapshot())
}

// handleTrafficStats 返回按小时/天聚合的历史流量（GET /api/traffic/stats）。
func (s *Server) handleTrafficStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.traffic.stats())
}
