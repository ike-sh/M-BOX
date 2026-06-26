//go:build !linux

package api

import "runtime"

// collectStats 在非 Linux（本地开发）平台上返回尽力而为的占位数据，
// 保证面板可运行；真实部署在 Debian 上走 sysinfo_linux.go。
func collectStats(workDir string) sysStats {
	_ = workDir
	return sysStats{
		Hostname: hostname(),
		OS:       goosLabel() + " (dev)",
		Kernel:   runtime.Version(),
		UptimeS:  0,
		CPU:      0,
		MemUsed:  0,
		MemTotal: 0,
		DiskUsed: 0,
		DiskTot:  0,
		Load:     [3]float64{},
	}
}
