package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 同源校验：拒绝跨站站点连接 /ws/*（否则任意网页可跨域抓实时流量/日志）。
	// 无 Origin 视为非浏览器客户端放行；其余仅放行同源或本机回环（开发）。
	CheckOrigin: func(r *http.Request) bool {
		if r.Header.Get("Origin") == "" {
			return true
		}
		_, ok := allowedOrigin(r)
		return ok
	},
}

const (
	// wsWriteWait 单次写超时，避免慢客户端阻塞写协程。
	wsWriteWait = 10 * time.Second
	// wsPongWait 未收到 pong 的最长容忍时间；wsPingPeriod 须明显小于它。
	wsPongWait   = 60 * time.Second
	wsPingPeriod = 25 * time.Second
)

// wsWriter 串行化对单个 websocket 连接的写入（gorilla/websocket 不允许并发写）。
// 流量帧/心跳/ping 来自不同协程，统一经此写，避免并发写 panic。
type wsWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *wsWriter) writeJSON(v any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	return w.conn.WriteJSON(v)
}

func (w *wsWriter) ping() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	return w.conn.WriteMessage(websocket.PingMessage, nil)
}

// writeMessage 串行写入一帧原始消息（如转发 mihomo 日志的 JSON 文本帧）。
func (w *wsWriter) writeMessage(mt int, data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	return w.conn.WriteMessage(mt, data)
}

// handleTrafficWS 把 mihomo 的 /traffic WebSocket 转发给浏览器：
//   - 写入带超时 + 定期 ping/pong keepalive，避免 NAT 空闲断连与慢客户端阻塞；
//   - 上游断流时退避重连，连不上期间推 0 速率心跳，保持前端图表不崩。
func (s *Server) handleTrafficWS(w http.ResponseWriter, r *http.Request) {
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	writer := &wsWriter{conn: clientConn}

	// 浏览器侧：读取以感知关闭，并用 pong 续期读超时（keepalive）。
	_ = clientConn.SetReadDeadline(time.Now().Add(wsPongWait))
	clientConn.SetPongHandler(func(string) error {
		return clientConn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	go func() {
		for {
			if _, _, err := clientConn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	// 定期 ping 浏览器。
	go func() {
		t := time.NewTicker(wsPingPeriod)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if writer.ping() != nil {
					cancel()
					return
				}
			}
		}
	}()

	// 外层循环：断流后退避重连上游 /traffic；连不上则推 0 心跳并继续重试。
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		upstream, err := s.client.DialTraffic(ctx)
		if err != nil {
			if !s.fallbackTrafficFor(ctx, writer, backoff) {
				return // 客户端已断开或 ctx 取消
			}
			if backoff < 15*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		if !s.pumpTraffic(ctx, upstream, writer) {
			upstream.Close()
			return // 客户端断开
		}
		upstream.Close()
		// 上游断开：短暂回退后重连。
		if !s.fallbackTrafficFor(ctx, writer, time.Second) {
			return
		}
	}
}

// pumpTraffic 从上游持续读取并转发，同时记入历史。返回值表示「客户端是否仍存活」：
// 上游读失败返回 true（提示外层重连），客户端写失败返回 false（结束）。
func (s *Server) pumpTraffic(ctx context.Context, upstream *websocket.Conn, writer *wsWriter) bool {
	for {
		if ctx.Err() != nil {
			return false
		}
		_, msg, err := upstream.ReadMessage()
		if err != nil {
			return true // 上游断开，客户端可能仍在
		}
		// mihomo /traffic 消息形如 {"up":123,"down":456}（字节/秒）。
		var t TrafficMsg
		if json.Unmarshal(msg, &t) == nil {
			s.traffic.record(t.Up, t.Down)
			if writer.writeJSON(t) != nil {
				return false // 客户端断开
			}
		}
	}
}

// fallbackTrafficFor 在 dur 时间内每秒推 0 速率心跳。返回 true 表示可继续（到时/正常），
// false 表示客户端断开或 ctx 取消（应结束）。
func (s *Server) fallbackTrafficFor(ctx context.Context, writer *wsWriter, dur time.Duration) bool {
	deadline := time.After(dur)
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-deadline:
			return true
		case <-t.C:
			if writer.writeJSON(TrafficMsg{Up: 0, Down: 0}) != nil {
				return false
			}
		}
	}
}

// handleBackendLogsWS 把 daemon 自身日志（logHub）推送给浏览器：先补发历史快照，
// 再订阅实时增量。与 mihomo 内核日志(/ws/logs)分开，对应「日志」页的「后端日志」区。
func (s *Server) handleBackendLogsWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			if _, _, e := conn.ReadMessage(); e != nil {
				cancel()
				return
			}
		}
	}()

	if s.logHub == nil {
		<-ctx.Done()
		return
	}
	writer := &wsWriter{conn: conn}
	// 先把历史缓冲补发给新连接。
	for _, l := range s.logHub.Snapshot() {
		if writer.writeJSON(l) != nil {
			return
		}
	}
	ch, unsub := s.logHub.Subscribe()
	defer unsub()
	for {
		select {
		case <-ctx.Done():
			return
		case l, ok := <-ch:
			if !ok {
				return
			}
			if writer.writeJSON(l) != nil {
				return
			}
		}
	}
}
