// Package logbuf 提供 daemon 自身日志的内存环形缓冲与实时订阅：
// 把标准库 log 的输出同时写到 stderr(journal) 与本缓冲，供面板「日志」页
// 展示「后端日志」（区别于 mihomo 内核日志，后者走 external-controller /logs）。
package logbuf

import (
	"strings"
	"sync"
	"time"
)

// Line 是一条结构化后端日志，JSON 字段与前端对齐。
type Line struct {
	Time  string `json:"time"`  // HH:MM:SS
	Level string `json:"level"` // info / warning / error
	Msg   string `json:"msg"`
}

// Hub 是带订阅的日志环形缓冲。实现 io.Writer 以接入标准库 log。
type Hub struct {
	mu   sync.Mutex
	buf  []Line
	max  int
	subs map[chan Line]struct{}
}

// New 创建容量为 max 的日志缓冲（<=0 时取默认 500）。
func New(max int) *Hub {
	if max <= 0 {
		max = 500
	}
	return &Hub{max: max, subs: map[chan Line]struct{}{}}
}

// Write 实现 io.Writer：被 log 包调用，按行解析后存入环形缓冲并广播给订阅者。
// 向慢订阅者发送采用非阻塞 select，丢弃而非阻塞，避免拖慢业务里的 log 调用。
func (h *Hub) Write(p []byte) (int, error) {
	n := len(p)
	text := strings.TrimRight(string(p), "\n")
	if text == "" {
		return n, nil
	}
	h.mu.Lock()
	for _, raw := range strings.Split(text, "\n") {
		if raw == "" {
			continue
		}
		line := parseLine(raw)
		h.buf = append(h.buf, line)
		if len(h.buf) > h.max {
			h.buf = h.buf[len(h.buf)-h.max:]
		}
		for ch := range h.subs {
			select {
			case ch <- line:
			default:
			}
		}
	}
	h.mu.Unlock()
	return n, nil
}

// parseLine 给一行原始日志附上时间戳并按关键词粗分级别。
func parseLine(raw string) Line {
	lvl := "info"
	low := strings.ToLower(raw)
	switch {
	case strings.Contains(low, "error") || strings.Contains(low, "fail") ||
		strings.Contains(raw, "异常") || strings.Contains(raw, "失败") || strings.Contains(raw, "错误"):
		lvl = "error"
	case strings.Contains(low, "warn") || strings.Contains(raw, "警告"):
		lvl = "warning"
	}
	return Line{Time: time.Now().Format("15:04:05"), Level: lvl, Msg: raw}
}

// Snapshot 返回当前缓冲的副本（新连接先拉历史）。
func (h *Hub) Snapshot() []Line {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Line, len(h.buf))
	copy(out, h.buf)
	return out
}

// Subscribe 注册一个实时订阅，返回接收通道与取消函数。
func (h *Hub) Subscribe() (<-chan Line, func()) {
	ch := make(chan Line, 128)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	var once sync.Once
	cancel := func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.subs, ch)
			close(ch)
			h.mu.Unlock()
		})
	}
	return ch, cancel
}
