//go:build !linux

package core

import "os/exec"

// 非 Linux（开发机，如 Windows/macOS）下无 Pdeathsig 与 /proc，留空实现：
// 实际部署目标恒为 Linux，平台特定的进程治理逻辑见 manager_linux.go。
func configureSysProcAttr(_ *exec.Cmd) {}

func reapStrayKernels(_, _ string) {}
