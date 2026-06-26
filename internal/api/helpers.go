package api

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/mbox/mbox/internal/store"
)

// reloadCore 让 mihomo 重新加载 config.yaml。返回的 error 供调用方决定是否
// 把「重载失败」透传给前端（best-effort 调用方可忽略）。mihomo 未运行或拒绝
// 新配置时会返回错误，此时 mihomo 仍以旧配置运行。
func (s *Server) reloadCore(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	// mihomo 的 PUT /configs 要求 path 为绝对路径，否则返回
	// 400 "path is not a absolute path"。WorkDir 在本地开发时可能是相对路径
	// （如 .mbox-dev），这里统一转成绝对路径再下发。
	cfgPath := s.cfg.ConfigPath()
	if abs, err := filepath.Abs(cfgPath); err == nil {
		cfgPath = abs
	}
	if err := s.client.ReloadConfig(ctx, cfgPath, true); err != nil {
		log.Printf("[M-BOX] mihomo 重载失败（可能未运行或配置被拒绝）: %v", err)
		return err
	}
	return nil
}

func toSubDTO(idx int, sub store.Subscription) Subscription {
	const gb = float64(1 << 30)
	used := float64(sub.Upload+sub.Download) / gb
	total := float64(sub.Total) / gb
	expire := "—"
	if sub.Expire > 0 {
		expire = time.Unix(sub.Expire, 0).Format("2006-01-02")
	}
	updated := "从未"
	if !sub.UpdatedAt.IsZero() {
		updated = humanSinceTime(sub.UpdatedAt)
	}
	return Subscription{
		ID:        fmt.Sprintf("sub%d", idx+1),
		Name:      sub.Name,
		URL:       maskURL(sub.URL),
		Used:      round1f(used),
		Total:     round1f(total),
		Expire:    expire,
		NodeCount: sub.NodeCount,
		UpdatedAt: updated,
		Interval:  sub.Interval / 3600,
		Enabled:   !sub.Disabled,
	}
}

func round1f(f float64) float64 { return float64(int64(f*10+0.5)) / 10 }

// reloadWithWarn 重载内核；失败时返回给前端展示的 warning（成功返回空串）。
// 用于「写配置成功但内核拒绝重载」时把真相透传给用户，避免「显示已生效、实际仍跑旧配置」。
func (s *Server) reloadWithWarn(ctx context.Context) string {
	if err := s.reloadCore(ctx); err != nil {
		return "已写入配置，但 mihomo 重载失败（仍以旧配置运行）：" + err.Error()
	}
	return ""
}

// humanBytes 把字节数格式化为 KB/MB（用于备份大小显示）。
func humanBytes(n int64) string {
	const kb = 1024
	if n < kb {
		return fmt.Sprintf("%d B", n)
	}
	if n < kb*kb {
		return fmt.Sprintf("%.1f KB", float64(n)/kb)
	}
	return fmt.Sprintf("%.1f MB", float64(n)/(kb*kb))
}

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func nilSafe(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func maskURL(u string) string {
	if i := strings.Index(u, "token="); i >= 0 {
		return u[:i+6] + "••••••••"
	}
	if len(u) > 42 {
		return u[:38] + "••••"
	}
	return u
}

func safeFile(name string) string {
	r := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_", "*", "_", "?", "_")
	return r.Replace(name)
}

func humanSince(iso string) string {
	if iso == "" {
		return "—"
	}
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return iso
	}
	return humanSinceTime(t)
}

func humanSinceTime(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "刚刚"
	case d < time.Hour:
		return fmt.Sprintf("%d 分钟前", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d 小时前", int(d.Hours()))
	default:
		return fmt.Sprintf("%d 天前", int(d.Hours()/24))
	}
}
