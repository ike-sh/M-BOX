package api

import (
	"context"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/store"
)

// StartScheduler 启动后台调度：按各订阅的 interval 到期后自动重新拉取，并触发 mihomo 重载。
// 调用方传入的 ctx 取消时调度停止。
func (s *Server) StartScheduler(ctx context.Context) {
	s.startDNSStats(ctx)
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.tickSubscriptions(ctx)
			}
		}
	}()
}

func (s *Server) tickSubscriptions(ctx context.Context) {
	now := time.Now()
	var due []store.Subscription
	for _, sub := range s.store.Subscriptions() {
		if sub.Interval <= 0 || sub.Disabled {
			continue // 间隔无效或订阅已停用，跳过自动更新与注入
		}
		dueAt := sub.UpdatedAt.Add(time.Duration(sub.Interval) * time.Second)
		if sub.UpdatedAt.IsZero() || now.After(dueAt) {
			due = append(due, sub)
		}
	}
	if len(due) == 0 {
		return
	}

	// 并发拉取（受限并发），避免一个慢订阅阻塞其它订阅与后续 tick；每个拉取前加入
	// 随机抖动错峰，避免同 interval 的订阅对机场形成瞬时突发（thundering herd）。
	const conc = 4
	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	for _, sub := range due {
		wg.Add(1)
		sem <- struct{}{}
		go func(cp store.Subscription) {
			defer wg.Done()
			defer func() { <-sem }()
			jitter := time.Duration(rand.Int63n(int64(800 * time.Millisecond)))
			select {
			case <-ctx.Done():
				return
			case <-time.After(jitter):
			}
			log.Printf("[M-BOX] 定时更新订阅: %s", cp.Name)
			s.fetchInto(ctx, &cp)
			// 确保 provider 已注入 config（幂等）。对 config 的写已由 cfgMu 串行化。
			providerRel := "./providers/" + safeFile(cp.Name) + ".yaml"
			s.cfgMu.Lock()
			_ = config.AddProxyProvider(s.cfg.ConfigPath(), cp.Name, cp.URL, providerRel, cp.Interval)
			s.cfgMu.Unlock()
		}(sub)
	}
	wg.Wait()
	s.reloadCore(ctx)
}
