package config

import (
	_ "embed"
	"os"
	"path/filepath"
)

// defaultConfigYAML 是内嵌的开箱即用 mihomo 默认配置。打包时会被同步到
// 安装包根目录的 config.yaml；daemon 启动时若工作目录缺配置则用它兜底写出，
// 确保「解压即可用」——即使用户误删配置也能自愈。
//
//go:embed default.yaml
var defaultConfigYAML []byte

// DefaultConfigYAML 返回内嵌默认配置的副本。
func DefaultConfigYAML() []byte {
	out := make([]byte, len(defaultConfigYAML))
	copy(out, defaultConfigYAML)
	return out
}

// EnsureConfig 确保工作目录存在可用的内核主配置文件。
// 若已存在则原样保留（不覆盖用户改动）；若缺失则写出内嵌默认配置。
// 返回值 created 表示本次是否新写出了默认配置。
func (d Daemon) EnsureConfig() (created bool, err error) {
	// sing-box 用 config.json，没有内嵌默认，跳过自愈（由用户/安装包提供）。
	if d.Kernel == "sing-box" {
		return false, nil
	}
	path := d.ConfigPath()
	if _, statErr := os.Stat(path); statErr == nil {
		return false, nil
	} else if !os.IsNotExist(statErr) {
		return false, statErr
	}
	if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr != nil {
		return false, mkErr
	}
	if writeErr := os.WriteFile(path, defaultConfigYAML, 0o644); writeErr != nil {
		return false, writeErr
	}
	return true, nil
}
