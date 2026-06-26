// Package config 负责 M-BOX daemon 自身的运行参数，以及读取/解析 mihomo 的
// config.yaml（用于把 DNS / TUN / 规则等信息回显到面板）。
package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// Daemon 是 M-BOX 后端的运行配置。字段优先级：命令行参数 > 环境变量 > 默认值。
type Daemon struct {
	// Listen 是 daemon 自身 REST/WS 面板服务监听地址。
	Listen string
	// WorkDir 是 mihomo 的工作目录（-d 参数），存放 config.yaml / providers / geo 数据。
	WorkDir string
	// MihomoBin 是 mihomo 可执行文件路径；为空时 daemon 不托管进程（仅反代已有实例）。
	MihomoBin string
	// Controller 是 mihomo external-controller 地址（默认 127.0.0.1:9090）。
	Controller string
	// Secret 是 mihomo external-controller 的鉴权 secret（默认空）。
	Secret string
	// WebDir 指向已构建的前端静态资源目录；为空时使用内嵌资源。
	WebDir string
	// Manage 为 true 时由 daemon 负责拉起/守护 mihomo 子进程。
	Manage bool
	// Kernel 指定代理内核类型（mihomo / sing-box）。默认 mihomo。
	Kernel string
}

// ConfigPath 返回内核主配置文件路径。sing-box 用 config.json，其余默认 config.yaml。
func (d Daemon) ConfigPath() string {
	if d.Kernel == "sing-box" {
		return filepath.Join(d.WorkDir, "config.json")
	}
	return filepath.Join(d.WorkDir, "config.yaml")
}

// ProvidersDir 返回订阅 provider 的存放目录。
func (d Daemon) ProvidersDir() string {
	return filepath.Join(d.WorkDir, "providers")
}

// StatePath 返回 daemon 持久化状态文件路径。
func (d Daemon) StatePath() string {
	return filepath.Join(d.WorkDir, "mbox-state.json")
}

// Default 返回带默认值的配置。
func Default() Daemon {
	return Daemon{
		Listen:     getenv("MBOX_LISTEN", "0.0.0.0:8088"),
		WorkDir:    getenv("MBOX_WORKDIR", defaultWorkDir()),
		MihomoBin:  getenv("MBOX_MIHOMO_BIN", "mihomo"),
		Controller: getenv("MBOX_CONTROLLER", "127.0.0.1:9090"),
		Secret:     getenv("MBOX_SECRET", ""),
		WebDir:     getenv("MBOX_WEBDIR", ""),
		Manage:     getenv("MBOX_MANAGE", "1") == "1",
		Kernel:     getenv("MBOX_KERNEL", "mihomo"),
	}
}

func defaultWorkDir() string {
	// Linux 部署用 /etc/mbox；其它平台（本地开发）退回当前目录下的 .mbox。
	if _, err := os.Stat("/etc/mbox"); err == nil {
		return "/etc/mbox"
	}
	return filepath.Join(".", ".mbox")
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// EnsureControllerSecret 保证 mihomo external-controller 配了非空 secret，并返回最终值。
//   - override 非空（用户用 -secret/MBOX_SECRET 显式指定）：以它为准，必要时写回 config.yaml；
//   - 否则 config.yaml 已有 secret：沿用，不改动；
//   - 否则首启自动用 crypto/rand 生成一个随机 secret 并写回 config.yaml。
//
// 这样既兑现了“daemon 注入随机 secret”的承诺，又避免每次启动都改写用户的 secret。
func EnsureControllerSecret(configPath, override string) (string, error) {
	mc, err := LoadMihomo(configPath)
	if err != nil {
		return "", err
	}
	existing := ""
	if mc != nil {
		existing = strings.TrimSpace(mc.Secret)
	}
	desired := strings.TrimSpace(override)
	if desired == "" {
		if existing != "" {
			return existing, nil
		}
		gen, gerr := randomSecret(16)
		if gerr != nil {
			return "", gerr
		}
		desired = gen
	}
	if desired == existing {
		return desired, nil
	}
	if werr := SetSecret(configPath, desired); werr != nil {
		return "", werr
	}
	return desired, nil
}

// randomSecret 返回 n 字节的随机密钥的十六进制表示（来自 crypto/rand）。
func randomSecret(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
