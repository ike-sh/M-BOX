package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// HealthResult 是单个节点的健康度评测结果。
type HealthResult struct {
	Name       string  `json:"name"`
	Median     int     `json:"median"`     // 延迟中位数(ms)，-1 表示全部失败
	Jitter     int     `json:"jitter"`     // 抖动=成功样本标准差(ms)
	Loss       float64 `json:"loss"`       // 丢包率 0~1
	Samples    int     `json:"samples"`    // 实际采样次数
	OK         int     `json:"ok"`         // 成功次数
	Multiplier float64 `json:"multiplier"` // 节点倍率(从名称推断，0=未知)
	Score      float64 `json:"score"`      // 综合健康分 0~100，越高越好
}

// healthSamplesDefault / healthSamplesMax 限制每节点采样次数（次数越多越准但越慢）。
const (
	healthSamplesDefault = 3
	healthSamplesMax     = 10
	healthConc           = 16
)

// handleBatchHealth 对一批节点做多次测速并综合评分（延迟中位数 + 抖动 + 丢包 + 倍率），
// 供「自动选优」参考。相比单次 delay，多采样能过滤抖动、识别不稳定节点。
func (s *Server) handleBatchHealth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Names   []string `json:"names"`
		URL     string   `json:"url"`
		Timeout int      `json:"timeout"` // 毫秒/单次
		Samples int      `json:"samples"` // 每节点采样次数
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	testURL := strings.TrimSpace(body.URL)
	if testURL == "" || testURL == "http://www.gstatic.com/generate_204" {
		testURL = "https://www.gstatic.com/generate_204"
	}
	timeout := body.Timeout
	if timeout <= 0 {
		timeout = 5000
	}
	samples := body.Samples
	if samples <= 0 {
		samples = healthSamplesDefault
	}
	if samples > healthSamplesMax {
		samples = healthSamplesMax
	}

	// 整体超时随 节点数 × 采样次数 自适应（含 1 批缓冲），并设 8 分钟上限。
	batches := (len(body.Names) + healthConc - 1) / healthConc
	overall := time.Duration((batches+1)*samples) * time.Duration(timeout) * time.Millisecond
	if overall < 30*time.Second {
		overall = 30 * time.Second
	}
	if overall > 8*time.Minute {
		overall = 8 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), overall)
	defer cancel()

	results := make([]HealthResult, 0, len(body.Names))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, healthConc)
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
			delays := make([]int, 0, samples)
			for i := 0; i < samples; i++ {
				if ctx.Err() != nil {
					break
				}
				d, err := s.client.ProxyDelay(ctx, n, testURL, timeout)
				if err == nil && d > 0 {
					delays = append(delays, d)
				}
			}
			res := evalHealth(n, delays, samples, guessMultiplier(n))
			mu.Lock()
			results = append(results, res)
			mu.Unlock()
		}(name)
	}
	wg.Wait()

	// 按健康分降序返回，方便前端直接取 Top-N 作为选优候选。
	sort.SliceStable(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// evalHealth 由成功延迟样本与计划采样次数计算一个节点的健康度结果（纯函数，便于测试）。
func evalHealth(name string, delays []int, samples int, multiplier float64) HealthResult {
	ok := len(delays)
	if samples <= 0 {
		samples = ok
	}
	loss := 1.0
	if samples > 0 {
		loss = float64(samples-ok) / float64(samples)
	}
	median := medianInt(delays)
	jitter := stdDevInt(delays)
	return HealthResult{
		Name:       name,
		Median:     median,
		Jitter:     jitter,
		Loss:       loss,
		Samples:    samples,
		OK:         ok,
		Multiplier: multiplier,
		Score:      scoreHealth(median, jitter, loss, multiplier),
	}
}

// scoreHealth 把 延迟/抖动/丢包/倍率 综合成 0~100 健康分（越高越好）。
//   - 全部失败(median<0) 直接 0；
//   - 延迟权重 0.5、丢包 0.3、抖动 0.2；
//   - 倍率>1 施加温和惩罚（高倍率更耗流量，选优时降权）。
func scoreHealth(median, jitter int, loss, multiplier float64) float64 {
	if median < 0 {
		return 0
	}
	latencyScore := clamp01(1 - float64(median)/800.0)
	jitterScore := clamp01(1 - float64(jitter)/200.0)
	lossScore := clamp01(1 - loss)
	base := 0.5*latencyScore + 0.3*lossScore + 0.2*jitterScore
	factor := 1.0
	if multiplier > 1 {
		factor = 1.0 / (1.0 + (multiplier-1)*0.15)
	}
	score := base * 100 * factor
	return math.Round(score*10) / 10
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

// medianInt 返回整数切片的中位数；空切片返回 -1。
func medianInt(xs []int) int {
	if len(xs) == 0 {
		return -1
	}
	s := append([]int(nil), xs...)
	sort.Ints(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

// stdDevInt 返回总体标准差（四舍五入为整数）；样本数<2 返回 0。
func stdDevInt(xs []int) int {
	if len(xs) < 2 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += float64(x)
	}
	mean := sum / float64(len(xs))
	var v float64
	for _, x := range xs {
		d := float64(x) - mean
		v += d * d
	}
	v /= float64(len(xs))
	return int(math.Round(math.Sqrt(v)))
}
