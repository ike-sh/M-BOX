//go:build !linux

package api

// 非 Linux 平台（本地开发，如 Windows/macOS）上，系统级转发与 systemd 自启不适用，
// 一律返回「不支持/跳过」，使一键开启在开发环境也能演示流程而不报错。

func enableIPForward() (detail string, supported bool, err error) {
	return "当前非 Linux 平台，IP 转发由真机网关负责，跳过", false, nil
}

func disableIPForward() (detail string, supported bool, err error) {
	return "当前非 Linux 平台，IP 转发由真机网关负责，跳过", false, nil
}

func ipForwardEnabled() bool { return false }

func setAutostart(on bool) (detail string, supported bool, err error) {
	return "当前非 Linux 平台，开机自启由真机 systemd 负责，跳过", false, nil
}

func autostartEnabled() bool { return false }
