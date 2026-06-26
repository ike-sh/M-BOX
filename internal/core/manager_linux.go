//go:build linux

package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// configureSysProcAttr 设置内核子进程的 Pdeathsig：当 daemon（父进程）因任何原因
// 退出（含 panic / OOM / kill -9 这类非优雅退出）时，由内核自动给子进程发 SIGTERM，
// 使 mihomo 随之退出。这从根上杜绝「daemon 没了、mihomo 变成 ppid=1 孤儿」的情况。
func configureSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Pdeathsig: syscall.SIGTERM,
	}
}

// reapStrayKernels 在启动内核前，清理「工作目录相同但不受本 daemon 托管」的残留内核
// 进程：例如上次 daemon 崩溃遗留的孤儿，或被手动 `mihomo -d <workDir>` 启动的重复实例。
// 不清理它们会导致多个内核争抢 TUN 设备 / external-controller(9090) / DNS(53)，
// 触发 "address already in use" 与分流/路由紊乱。
//
// 仅 Linux：扫描 /proc/<pid>/cmdline，匹配「可执行名为内核 + 命令行包含本工作目录」的进程。
func reapStrayKernels(binPath, workDir string) {
	self := os.Getpid()
	binBase := filepath.Base(binPath)

	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}
	absWork := workDir
	if a, err := filepath.Abs(workDir); err == nil {
		absWork = a
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == self {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", e.Name(), "cmdline"))
		if err != nil || len(raw) == 0 {
			continue
		}
		// /proc/<pid>/cmdline 以 NUL 分隔各参数。
		args := strings.Split(strings.TrimRight(string(raw), "\x00"), "\x00")
		if len(args) == 0 || args[0] == "" {
			continue
		}
		exe := filepath.Base(args[0])
		// 只认代理内核进程，避免误杀其它程序。
		if exe != binBase && exe != "mihomo" && exe != "sing-box" {
			continue
		}
		// 必须指向同一工作目录（绝对或原始写法皆可），确保是「同一台网关的内核实例」。
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, absWork) && !strings.Contains(joined, workDir) {
			continue
		}
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Signal(syscall.SIGKILL)
		}
	}
}
