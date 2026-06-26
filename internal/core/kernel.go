package core

import "path/filepath"

// Kind 标识代理内核类型。M-BOX 默认 mihomo，但通过 KernelSpec 抽象，
// 后续可插拔接入 sing-box 等同样兼容 Clash external-controller 的内核。
type Kind string

const (
	KindMihomo  Kind = "mihomo"
	KindSingBox Kind = "sing-box"
)

// KernelSpec 描述某种内核的差异点：可执行文件、启动参数、配置文件名、
// release 仓库。daemon 的进程管理与控制器客户端逻辑对所有内核保持一致
// （前提是该内核暴露 Clash 兼容的 external-controller）。
type KernelSpec struct {
	Kind        Kind   `json:"kind"`
	DisplayName string `json:"displayName"`
	// DefaultBin 是 PATH 中的默认可执行文件名。
	DefaultBin string `json:"defaultBin"`
	// ConfigFile 是工作目录下的主配置文件名。
	ConfigFile string `json:"configFile"`
	// ReleaseRepo 是 GitHub `owner/repo`，用于检查最新版本。
	ReleaseRepo string `json:"releaseRepo"`
	// ClashAPI 表示该内核是否兼容 Clash external-controller（决定面板实时数据可用性）。
	ClashAPI bool `json:"clashApi"`
	// args 根据 bin 与工作目录构造启动参数。
	args func(bin, workDir string) []string
}

// Args 返回启动该内核的命令行参数。
func (s KernelSpec) Args(bin, workDir string) []string {
	if s.args == nil {
		return []string{"-d", workDir}
	}
	return s.args(bin, workDir)
}

// kernelRegistry 是内置内核注册表。新增内核只需在此登记。
var kernelRegistry = map[Kind]KernelSpec{
	KindMihomo: {
		Kind:        KindMihomo,
		DisplayName: "mihomo (Clash.Meta)",
		DefaultBin:  "mihomo",
		ConfigFile:  "config.yaml",
		ReleaseRepo: "MetaCubeX/mihomo",
		ClashAPI:    true,
		args: func(_, workDir string) []string {
			return []string{"-d", workDir}
		},
	},
	KindSingBox: {
		Kind:        KindSingBox,
		DisplayName: "sing-box",
		DefaultBin:  "sing-box",
		ConfigFile:  "config.json",
		ReleaseRepo: "SagerNet/sing-box",
		ClashAPI:    true, // 需在 config.json 中开启 experimental.clash_api
		args: func(_, workDir string) []string {
			return []string{"run", "-D", workDir, "-c", filepath.Join(workDir, "config.json")}
		},
	},
}

// ResolveKernel 按类型返回 KernelSpec；未知类型回退到 mihomo。
func ResolveKernel(kind Kind) KernelSpec {
	if spec, ok := kernelRegistry[kind]; ok {
		return spec
	}
	return kernelRegistry[KindMihomo]
}

// Kernels 返回全部已登记内核（用于面板展示可选项）。
func Kernels() []KernelSpec {
	// 固定顺序，便于前端稳定渲染。
	order := []Kind{KindMihomo, KindSingBox}
	out := make([]KernelSpec, 0, len(order))
	for _, k := range order {
		out = append(out, kernelRegistry[k])
	}
	return out
}
