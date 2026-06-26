package api

import "testing"

func TestGuessRegion(t *testing.T) {
	cases := []struct {
		name     string
		wantCode string
	}{
		// 国旗 emoji 优先
		{"🇯🇵 Tokyo 01", "JP"},
		// 中文/全称关键词
		{"香港 IEPL 专线", "HK"},
		{"United States 03", "US"},
		// 两字母国家码需词边界
		{"US01-Los Angeles", "US"},
		{"IN-Mumbai", "IN"},
		// 关键误判防护：AUS/AUSTRIA 不应判成美国 US
		{"AUSTRIA-Wien", ""},
		{"AUS-Sydney", "AU"},
		// 无任何线索
		{"Premium-Node-001", ""},
	}
	for _, c := range cases {
		got, _ := guessRegion(c.name)
		if got != c.wantCode {
			t.Errorf("guessRegion(%q)=%q want %q", c.name, got, c.wantCode)
		}
	}
}

func TestContainsCodeBoundary(t *testing.T) {
	if containsCode("AUSTRIA", "US") {
		t.Error("US 不应命中 AUSTRIA(无词边界)")
	}
	if !containsCode("US01", "US") {
		t.Error("US 应命中 US01")
	}
	if !containsCode("X-US", "US") {
		t.Error("US 应命中 X-US")
	}
}
