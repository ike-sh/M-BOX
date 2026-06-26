package config

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// SubInfo 来自机场订阅响应头 Subscription-Userinfo 的流量/到期信息。
type SubInfo struct {
	Upload   int64
	Download int64
	Total    int64
	Expire   int64
	NodeName string
}

// FetchSubscription 拉取订阅内容并写入 destPath（mihomo provider 文件）。
// 返回订阅的流量/到期信息（若机场提供）。
func FetchSubscription(ctx context.Context, rawURL, destPath string) (*SubInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	// 用 clash 标识，多数机场据此返回 Clash 格式。
	req.Header.Set("User-Agent", "clash.meta/mbox")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("订阅返回状态 %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20)) // 上限 16MB
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(destPath, body, 0o644); err != nil {
		return nil, err
	}

	info := parseUserInfo(resp.Header.Get("Subscription-Userinfo"))
	return info, nil
}

// parseUserInfo 解析形如 "upload=1;download=2;total=3;expire=4" 的头部。
func parseUserInfo(h string) *SubInfo {
	if h == "" {
		return &SubInfo{}
	}
	info := &SubInfo{}
	for _, part := range strings.Split(h, ";") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		n, _ := strconv.ParseInt(strings.TrimSpace(kv[1]), 10, 64)
		switch strings.TrimSpace(kv[0]) {
		case "upload":
			info.Upload = n
		case "download":
			info.Download = n
		case "total":
			info.Total = n
		case "expire":
			info.Expire = n
		}
	}
	return info
}
