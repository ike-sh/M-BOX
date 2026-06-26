// Package version 提供 M-BOX 自身的版本号（单一来源）。
// 发布构建可用 -ldflags "-X github.com/mbox/mbox/internal/version.Version=X.Y.Z" 注入，
// 与仓库根目录 VERSION 文件保持一致。
package version

// Version 是 M-BOX 版本号（语义化版本，不含前缀 v）。构建时可被 ldflags 覆盖。
var Version = "0.1.0"
