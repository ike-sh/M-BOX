package api

import (
	"fmt"
	"os"
	"runtime"
)

// sysStats 是平台无关的系统采样结果。
type sysStats struct {
	Hostname string
	OS       string
	Kernel   string
	UptimeS  int64
	CPU      float64 // 0-100
	MemUsed  float64 // MB
	MemTotal float64 // MB
	DiskUsed float64 // GB
	DiskTot  float64 // GB
	Load     [3]float64
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "m-box"
	}
	return h
}

// humanUptime 把秒数格式化为「X天 Y小时 Z分」。
func humanUptime(sec int64) string {
	if sec <= 0 {
		return "—"
	}
	d := sec / 86400
	h := (sec % 86400) / 3600
	m := (sec % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%d天 %d小时 %d分", d, h, m)
	}
	if h > 0 {
		return fmt.Sprintf("%d小时 %d分", h, m)
	}
	return fmt.Sprintf("%d分", m)
}

func goosLabel() string {
	switch runtime.GOOS {
	case "linux":
		return "Linux"
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	default:
		return runtime.GOOS
	}
}
