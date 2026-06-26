#!/usr/bin/env bash
# M-BOX 离线整包构建脚本（Linux / CI）。
#
# 交叉编译 mbox(daemon) + 构建前端 + 下载 mihomo 内核与 geo 数据，连同默认配置和
# 离线安装脚本打成 tar.gz，产物在 dist-pkg/。Windows 维护者请用 scripts/build-package.ps1。
#
# 环境变量：
#   ARCHES="amd64 arm64"        目标架构（默认两个都打）
#   MIHOMO_VERSION=v1.19.27     mihomo 版本（默认 latest，联网查询）
#   EDGE_GH_MIRROR=https://...  GitHub 下载镜像前缀（国内加速用，默认直连）
#   SKIP_WEB=1                  跳过前端构建，复用已存在的 web/dist
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_DIR="$SCRIPT_DIR/.cache"
OUT_DIR="$REPO_ROOT/dist-pkg"
STAGE_ROOT="$REPO_ROOT/.pkg-stage"

ARCHES="${ARCHES:-amd64 arm64}"
MIHOMO_VERSION="${MIHOMO_VERSION:-latest}"
GH="${EDGE_GH_MIRROR:-https://github.com}"
SKIP_WEB="${SKIP_WEB:-0}"

MBOX_VERSION="0.1.0"
[ -f "$REPO_ROOT/VERSION" ] && MBOX_VERSION="$(tr -d ' \r\n' < "$REPO_ROOT/VERSION")"

log() { printf '\033[1;32m[M-BOX]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[M-BOX]\033[0m %s\n' "$*" >&2; exit 1; }

for c in go tar curl gunzip; do
  command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
done
if [ "$SKIP_WEB" != "1" ]; then
  command -v npm >/dev/null 2>&1 || die "缺少 npm（或设 SKIP_WEB=1 复用 web/dist）"
fi

mkdir -p "$CACHE_DIR" "$OUT_DIR"

get_cached() { # <url> <out>
  local url="$1" out="$2"
  if [ -f "$out" ]; then log "缓存命中：$(basename "$out")"; return; fi
  log "下载：$url"
  curl -fsSL "$url" -o "$out.part"
  mv -f "$out.part" "$out"
}

if [ "$MIHOMO_VERSION" = "latest" ]; then
  log "查询 mihomo 最新 stable 版本…"
  MIHOMO_VERSION="$(curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest \
    | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | cut -d'"' -f4 || true)"
  [ -n "$MIHOMO_VERSION" ] || die "无法获取最新版本，请用 MIHOMO_VERSION=v1.19.x 显式指定"
fi
log "M-BOX v$MBOX_VERSION · mihomo $MIHOMO_VERSION"

# geo 数据（两架构共用）
GEO_BASE="$GH/MetaCubeX/meta-rules-dat/releases/download/latest"
for f in geoip.dat geosite.dat; do
  get_cached "$GEO_BASE/$f" "$CACHE_DIR/$f"
done

# 前端（一次，所有架构共用）
if [ "$SKIP_WEB" = "1" ]; then
  [ -d "$REPO_ROOT/web/dist" ] || die "SKIP_WEB=1 但 $REPO_ROOT/web/dist 不存在"
  log "复用已有前端：web/dist"
else
  log "构建前端（npm ci && npm run build）…"
  ( cd "$REPO_ROOT/web" && { npm ci || npm install; } && npm run build )
fi
[ -d "$REPO_ROOT/web/dist" ] || die "前端产物缺失：web/dist"

# 架构 → mihomo 资产 token（amd64 用 compatible 兼容老 CPU / 各类 VM）
asset_token() { case "$1" in amd64) echo amd64-compatible;; arm64) echo arm64;; *) die "不支持的架构：$1";; esac; }

for a in $ARCHES; do
  log "=== 组装 linux-$a ==="
  pkg="mbox-v$MBOX_VERSION-linux-$a"
  stage="$STAGE_ROOT/$pkg"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/geo"

  log "交叉编译 mbox (linux/$a)…"
  ( cd "$REPO_ROOT" && GOOS=linux GOARCH="$a" CGO_ENABLED=0 \
      go build -trimpath \
        -ldflags "-s -w -X github.com/mbox/mbox/internal/version.Version=$MBOX_VERSION" \
        -o "$stage/mbox" ./cmd/mbox )

  token="$(asset_token "$a")"
  gz="mihomo-linux-$token-$MIHOMO_VERSION.gz"
  get_cached "$GH/MetaCubeX/mihomo/releases/download/$MIHOMO_VERSION/$gz" "$CACHE_DIR/$gz"
  gunzip -c "$CACHE_DIR/$gz" > "$stage/bin/mihomo"
  chmod +x "$stage/bin/mihomo"

  cp "$CACHE_DIR/geoip.dat"   "$stage/geo/geoip.dat"
  cp "$CACHE_DIR/geosite.dat" "$stage/geo/geosite.dat"
  cp -r "$REPO_ROOT/web/dist" "$stage/web"
  cp "$REPO_ROOT/internal/config/default.yaml" "$stage/config.yaml"
  cp "$SCRIPT_DIR/offline-install.sh"   "$stage/install.sh"
  cp "$SCRIPT_DIR/offline-uninstall.sh" "$stage/uninstall.sh"
  printf 'M-BOX v%s 离线整包\nmihomo: %s\narch: linux-%s\nbuilt: %s\n' \
    "$MBOX_VERSION" "$MIHOMO_VERSION" "$a" "$(date '+%Y-%m-%d %H:%M:%S')" > "$stage/VERSION"

  ( cd "$STAGE_ROOT" && tar -czf "$OUT_DIR/$pkg.tar.gz" "$pkg" )
  log "产物：$OUT_DIR/$pkg.tar.gz ($(du -h "$OUT_DIR/$pkg.tar.gz" | cut -f1))"
done

rm -rf "$STAGE_ROOT"
log "全部完成 ✅"
