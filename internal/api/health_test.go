package api

import "testing"

func TestMedianInt(t *testing.T) {
	cases := []struct {
		in   []int
		want int
	}{
		{nil, -1},
		{[]int{}, -1},
		{[]int{100}, 100},
		{[]int{30, 10, 20}, 20},
		{[]int{10, 20, 30, 40}, 25},
	}
	for _, c := range cases {
		if got := medianInt(c.in); got != c.want {
			t.Errorf("medianInt(%v)=%d want %d", c.in, got, c.want)
		}
	}
}

func TestStdDevInt(t *testing.T) {
	if got := stdDevInt([]int{50}); got != 0 {
		t.Errorf("单样本应为 0，实际 %d", got)
	}
	if got := stdDevInt([]int{100, 100, 100}); got != 0 {
		t.Errorf("无波动应为 0，实际 %d", got)
	}
	// 10,20,30 -> mean 20, var=(100+0+100)/3=66.67, std≈8.16 -> 8
	if got := stdDevInt([]int{10, 20, 30}); got != 8 {
		t.Errorf("std(10,20,30) 期望 8，实际 %d", got)
	}
}

func TestScoreHealth(t *testing.T) {
	// 全失败 -> 0
	if got := scoreHealth(-1, 0, 1, 0); got != 0 {
		t.Errorf("全失败应为 0，实际 %v", got)
	}
	// 低延迟、零抖动、零丢包、未知倍率 -> 接近满分
	full := scoreHealth(0, 0, 0, 0)
	if full < 99 {
		t.Errorf("理想节点应接近 100，实际 %v", full)
	}
	// 倍率惩罚：同等指标下高倍率分数更低
	low := scoreHealth(100, 10, 0, 1)
	high := scoreHealth(100, 10, 0, 5)
	if !(high < low) {
		t.Errorf("高倍率(%v)应低于低倍率(%v)", high, low)
	}
	// 丢包惩罚：丢包越高分越低
	noLoss := scoreHealth(100, 10, 0, 0)
	halfLoss := scoreHealth(100, 10, 0.5, 0)
	if !(halfLoss < noLoss) {
		t.Errorf("丢包应降低分数: half=%v none=%v", halfLoss, noLoss)
	}
}

func TestEvalHealth(t *testing.T) {
	// 计划 4 次，成功 3 次 -> 丢包 0.25
	r := evalHealth("US-x2", []int{120, 100, 110}, 4, 2)
	if r.OK != 3 || r.Samples != 4 {
		t.Fatalf("采样统计错误: %+v", r)
	}
	if r.Loss < 0.24 || r.Loss > 0.26 {
		t.Fatalf("丢包率应≈0.25，实际 %v", r.Loss)
	}
	if r.Median != 110 {
		t.Fatalf("中位数应为 110，实际 %d", r.Median)
	}
	if r.Score <= 0 || r.Score > 100 {
		t.Fatalf("分数应在 (0,100]，实际 %v", r.Score)
	}
	// 全失败
	z := evalHealth("dead", nil, 3, 0)
	if z.Median != -1 || z.Loss != 1 || z.Score != 0 {
		t.Fatalf("全失败结果错误: %+v", z)
	}
}
