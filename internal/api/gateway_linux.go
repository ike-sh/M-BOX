//go:build linux

package api

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// serviceName 是 install.sh 安装的 systemd 服务名（daemon 托管 mihomo + 面板）。
const serviceName = "mbox-daemon"

// enableIPForward 立即开启 IPv4 + IPv6 转发并写入 /etc/sysctl.d 持久化，
// 使重启后依然生效（旁路由/网关转发必需）。
// IPv6 转发为 best-effort：部分内核禁用了 IPv6（无 /proc/sys/net/ipv6），
// 此时仅开启 IPv4 不视为失败——否则纯 v4 环境会被误报错误。
func enableIPForward() (detail string, supported bool, err error) {
	supported = true
	// 运行时立即生效（IPv4 必需）。
	if werr := os.WriteFile("/proc/sys/net/ipv4/ip_forward", []byte("1\n"), 0o644); werr != nil {
		return "写入 /proc/sys/net/ipv4/ip_forward 失败（需 root 权限）", true, werr
	}
	// IPv6 转发：仅当系统启用了 IPv6 时才写，写失败不致命。
	v6Path := "/proc/sys/net/ipv6/conf/all/forwarding"
	v6on := false
	if _, statErr := os.Stat(v6Path); statErr == nil {
		v6on = os.WriteFile(v6Path, []byte("1\n"), 0o644) == nil
	}

	// 持久化（覆盖式写，幂等）。
	const conf = "/etc/sysctl.d/99-mbox-forward.conf"
	body := "# 由 M-BOX 自动写入：开启 IP 转发以支持透明代理网关\nnet.ipv4.ip_forward = 1\n"
	if v6on {
		body += "net.ipv6.conf.all.forwarding = 1\n"
	}
	scope := "IPv4"
	if v6on {
		scope = "IPv4 + IPv6"
	}
	if werr := os.WriteFile(conf, []byte(body), 0o644); werr != nil {
		// 运行时已生效，仅持久化失败：视为软成功但提示。
		return "已立即开启（" + scope + "），但持久化到 " + conf + " 失败：" + werr.Error(), true, nil
	}
	_ = exec.Command("sysctl", "-p", conf).Run()
	return "已开启并持久化（" + scope + "，重启后仍生效）", true, nil
}

// disableIPForward 关闭 IPv4/IPv6 转发（运行时）并移除持久化文件，
// 用于「完全卸载/还原网关」。best-effort：运行时关闭失败不致命，只要能移除
// 持久化配置即可保证重启后不再自动开启转发。
func disableIPForward() (detail string, supported bool, err error) {
	_ = os.WriteFile("/proc/sys/net/ipv4/ip_forward", []byte("0\n"), 0o644)
	v6Path := "/proc/sys/net/ipv6/conf/all/forwarding"
	if _, statErr := os.Stat(v6Path); statErr == nil {
		_ = os.WriteFile(v6Path, []byte("0\n"), 0o644)
	}
	const conf = "/etc/sysctl.d/99-mbox-forward.conf"
	if rmErr := os.Remove(conf); rmErr != nil && !os.IsNotExist(rmErr) {
		return "已关闭转发，但移除 " + conf + " 失败：" + rmErr.Error(), true, nil
	}
	return "已关闭 IP 转发并移除持久化配置（重启后不再自动开启）", true, nil
}

// ipForwardEnabled 读取当前 IPv4 ip_forward 是否为 1（状态以 v4 为准）。
func ipForwardEnabled() bool {
	b, err := os.ReadFile("/proc/sys/net/ipv4/ip_forward")
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(b)) == "1"
}

// setAutostart 通过 systemctl enable/disable 设置 daemon 的开机自启。
func setAutostart(on bool) (detail string, supported bool, err error) {
	if _, lerr := exec.LookPath("systemctl"); lerr != nil {
		return "未找到 systemctl，跳过开机自启设置", false, nil
	}
	action := "enable"
	if !on {
		action = "disable"
	}
	out, rerr := exec.Command("systemctl", action, serviceName).CombinedOutput()
	if rerr != nil {
		return fmt.Sprintf("systemctl %s %s 失败：%s", action, serviceName, strings.TrimSpace(string(out))), true, rerr
	}
	if on {
		return "已设置 " + serviceName + " 开机自启", true, nil
	}
	return "已取消 " + serviceName + " 开机自启", true, nil
}

// autostartEnabled 查询 daemon 是否已设为开机自启。
func autostartEnabled() bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	out, _ := exec.Command("systemctl", "is-enabled", serviceName).Output()
	return strings.TrimSpace(string(out)) == "enabled"
}
