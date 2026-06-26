//go:build !linux

package api

// 非 Linux（开发机）下的占位：实际部署目标恒为 Linux，BBR/系统控制见 sysopt_linux.go。
func bbrStatus() (bool, bool) { return false, false }

func applyBBR(bool) error { return nil }

func scheduleServiceControl(string) {}
