package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

func (s *Server) handleProxies(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := reqCtx(r)
	defer cancel()
	raw, err := s.client.Proxies(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "mihomo 不可达："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, transformProxies(raw))
}

func (s *Server) handleSelectProxy(w http.ResponseWriter, r *http.Request) {
	group := r.PathValue("group")
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "缺少 name")
		return
	}
	ctx, cancel := reqCtx(r)
	defer cancel()
	if err := s.client.SelectProxy(ctx, group, body.Name); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": group, "name": body.Name, "ok": true})
}

func (s *Server) handleProxyDelay(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	su, sto, _ := s.testSettings()
	testURL := r.URL.Query().Get("url")
	if testURL == "" {
		testURL = su
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(sto)*time.Millisecond+5*time.Second)
	defer cancel()
	delay, err := s.client.ProxyDelay(ctx, name, testURL, sto)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"name": name, "delay": -1})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "delay": delay})
}

// handleBatchDelay 并发对一批节点测速，返回 name->delay（ms，-1 表示失败/超时）。
// 用受限并发在服务端聚合，避免前端对每个节点各发一次请求压垮内核/浏览器连接数。
func (s *Server) handleBatchDelay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Names   []string `json:"names"`
		URL     string   `json:"url"`
		Timeout int      `json:"timeout"` // 毫秒
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	su, sto, _ := s.testSettings()
	testURL := strings.TrimSpace(body.URL)
	if testURL == "" {
		testURL = su
	}
	timeout := body.Timeout
	if timeout <= 0 {
		timeout = sto
	}
	const conc = 16 // 限制并发，避免一次性压垮内核
	// 整体超时随节点规模自适应：约 ceil(N/并发) 批、每批 timeout，外加 1 批缓冲；
	// 固定 60s 会让大订阅(如 200 节点)后半段节点被整体超时误判为 -1。
	batches := (len(body.Names) + conc - 1) / conc
	overall := time.Duration(batches+1) * time.Duration(timeout) * time.Millisecond
	if overall < 30*time.Second {
		overall = 30 * time.Second
	}
	if overall > 5*time.Minute {
		overall = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), overall)
	defer cancel()

	results := make(map[string]int, len(body.Names))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, conc)
	for _, name := range body.Names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(n string) {
			defer wg.Done()
			defer func() { <-sem }()
			d, err := s.client.ProxyDelay(ctx, n, testURL, timeout)
			mu.Lock()
			if err != nil {
				results[n] = -1
			} else {
				results[n] = d
			}
			mu.Unlock()
		}(name)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}
