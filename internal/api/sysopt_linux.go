//go:build linux

package api

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func kernelRelease() string {
	b, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	return strings.TrimSpace(string(b))
}

// bbrModuleAvailable 判断内核是否能用 BBR：已加载(available 含 bbr)，或 tcp_bbr.ko 模块文件存在(可加载)。
func bbrModuleAvailable() bool {
	if b, err := os.ReadFile("/proc/sys/net/ipv4/tcp_available_congestion_control"); err == nil &&
		strings.Contains(string(b), "bbr") {
		return true
	}
	if rel := kernelRelease(); rel != "" {
		m, _ := filepath.Glob("/lib/modules/" + rel + "/kernel/net/ipv4/tcp_bbr.ko*")
		return len(m) > 0
	}
	return false
}

// bbrStatus 返回 BBR 当前是否启用、内核是否可用（含"模块存在但未加载"也算可用）。
func bbrStatus() (enabled, available bool) {
	if b, err := os.ReadFile("/proc/sys/net/ipv4/tcp_congestion_control"); err == nil {
		enabled = strings.TrimSpace(string(b)) == "bbr"
	}
	available = bbrModuleAvailable()
	return
}

// applyBBR 启用/关闭 BBR。daemon 自身没有 CAP_SYS_MODULE 无法直接 modprobe，
// 故通过 modules-load.d + `systemctl restart systemd-modules-load`（PID1 以全权限加载模块）
// 让 tcp_bbr 就绪，再切运行时拥塞算法；同时写 sysctl 持久化，保证重启后仍生效。
func applyBBR(on bool) error {
	const modConf = "/etc/modules-load.d/mbox-bbr.conf"
	const sysConf = "/etc/sysctl.d/99-mbox-bbr.conf"
	if on {
		_ = os.WriteFile(modConf, []byte("tcp_bbr\n"), 0o644)
		// 优先直接 modprobe（若 daemon 恰有权限）；否则借 systemd 加载模块。
		_ = exec.Command("modprobe", "tcp_bbr").Run()
		_ = exec.Command("systemctl", "restart", "systemd-modules-load").Run()
		_ = os.WriteFile("/proc/sys/net/core/default_qdisc", []byte("fq\n"), 0o644)
		_ = os.WriteFile(sysConf, []byte("# 由 M-BOX 写入：启用 BBR 拥塞控制\nnet.core.default_qdisc = fq\nnet.ipv4.tcp_congestion_control = bbr\n"), 0o644)
		if err := os.WriteFile("/proc/sys/net/ipv4/tcp_congestion_control", []byte("bbr\n"), 0o644); err != nil {
			return fmt.Errorf("BBR 已配置（已写开机加载 + sysctl，重启后生效），但即时启用失败（内核模块尚未就绪）：%v", err)
		}
		return nil
	}
	_ = os.Remove(modConf)
	_ = os.Remove(sysConf)
	_ = os.WriteFile("/proc/sys/net/ipv4/tcp_congestion_control", []byte("cubic\n"), 0o644)
	return nil
}

// scheduleServiceControl 异步重启/停止 daemon 服务：延迟一会儿执行，让本次 HTTP 响应
// 先返回给前端（否则 systemctl stop 会先把 daemon 杀掉、响应发不出去）。
func scheduleServiceControl(action string) {
	go func() {
		time.Sleep(700 * time.Millisecond)
		_ = exec.Command("systemctl", action, serviceName).Run()
	}()
}
