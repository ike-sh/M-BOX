#!/usr/bin/env bash
# M-BOX 一键安装脚本：mihomo 内核 + daemon 后端 + Web 面板 + TUN 透明代理 + systemd
#
# 一体化部署：daemon 托管 mihomo 子进程，并对外提供面板（默认 http://本机:8088）。
#
# 用法（Debian 12 旁路由 VM，root 运行，在仓库根目录下执行）：
#   sudo bash scripts/install.sh                          # 全量安装，订阅稍后填
#   sudo MBOX_SUB_URL="https://你的订阅" bash scripts/install.sh
#   sudo MIHOMO_VERSION=v1.19.0 bash scripts/install.sh    # 指定 mihomo 版本
#   sudo EDGE_GH_MIRROR=https://gh.llkk.cc/https://github.com bash scripts/install.sh  # 国内镜像
#
# 产物来源：脚本优先使用仓库内预编译的 ./mbox 与 ./web/dist；
# 若不存在则尝试用本机的 go / npm 现场构建。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

MBOX_DIR="/etc/mbox"
MBOX_BIN="/usr/local/bin/mbox"
MIHOMO_BIN="/usr/local/bin/mihomo"
SERVICE_NAME="mbox-daemon"
PANEL_PORT="${MBOX_PORT:-8088}"
MIHOMO_VERSION="${MIHOMO_VERSION:-latest}"
GH="${EDGE_GH_MIRROR:-https://github.com}"
SUB_URL="${MBOX_SUB_URL:-}"
ARCH=""

log()  { printf '\033[1;32m[M-BOX]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[M-BOX]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[M-BOX]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash install.sh"
}

require_cmds() {
  for c in curl gunzip sed; do
    command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c（请先 apt-get install -y $c）"
  done
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l|armv7)  ARCH="armv7" ;;
    *) die "不支持的架构：$(uname -m)" ;;
  esac
  log "架构：$ARCH"
}

resolve_version() {
  if [ "$MIHOMO_VERSION" = "latest" ]; then
    log "查询 mihomo 最新 stable 版本…"
    MIHOMO_VERSION="$(curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest \
      | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | cut -d'"' -f4 || true)"
    [ -n "$MIHOMO_VERSION" ] || die "无法获取最新版本，请用 MIHOMO_VERSION=v1.19.x 显式指定"
  fi
  log "mihomo 版本：$MIHOMO_VERSION"
}

install_mihomo() {
  local fname url tmp
  fname="mihomo-linux-${ARCH}-${MIHOMO_VERSION}.gz"
  url="${GH}/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${fname}"
  tmp="$(mktemp -d)"
  log "下载 mihomo：$url"
  curl -fsSL "$url" -o "${tmp}/mihomo.gz" || die "下载失败（可设 EDGE_GH_MIRROR 用国内镜像）"
  gunzip -c "${tmp}/mihomo.gz" > "$MIHOMO_BIN" || die "解压失败"
  chmod +x "$MIHOMO_BIN"
  rm -rf "$tmp"
  log "mihomo 已安装：$("$MIHOMO_BIN" -v 2>/dev/null | head -n1)"
}

install_geodata() {
  mkdir -p "$MBOX_DIR"
  local base="${GH}/MetaCubeX/meta-rules-dat/releases/download/latest"
  local f
  for f in geoip.dat geosite.dat; do
    if [ ! -f "${MBOX_DIR}/${f}" ]; then
      log "下载 geo 数据：$f"
      curl -fsSL "${base}/${f}" -o "${MBOX_DIR}/${f}" \
        || warn "geo 数据 $f 下载失败（mihomo 首启会尝试自动更新）"
    fi
  done
}

setup_sysctl() {
  log "开启 ip_forward + 放宽 rp_filter（旁路由必需）"
  cat > /etc/sysctl.d/99-mbox.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
EOF
  sysctl --system >/dev/null
}

# free_port53 释放 53 端口：Debian 默认的 systemd-resolved 会监听 127.0.0.53:53，
# 导致 mihomo 的 dns.listen=0.0.0.0:53 绑定失败、DNS 服务起不来。这里关闭其
# Stub 监听并把本机 resolv.conf 指向 mihomo（127.0.0.1），保留公共 DNS 兜底。
free_port53() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet systemd-resolved 2>/dev/null; then
    log "检测到 systemd-resolved 占用 53 端口，关闭其 DNS Stub 监听"
    mkdir -p /etc/systemd/resolved.conf.d
    cat > /etc/systemd/resolved.conf.d/mbox.conf <<'EOF'
# M-BOX：让出 53 端口给 mihomo DNS
[Resolve]
DNSStubListener=no
EOF
    systemctl restart systemd-resolved 2>/dev/null || true
    # resolv.conf 若是指向 stub(127.0.0.53) 的软链/记录，改为本机 mihomo DNS。
    if [ -L /etc/resolv.conf ] || grep -q '127.0.0.53' /etc/resolv.conf 2>/dev/null; then
      rm -f /etc/resolv.conf
      printf 'nameserver 127.0.0.1\nnameserver 223.5.5.5\n' > /etc/resolv.conf
      log "已将 /etc/resolv.conf 指向本机 mihomo DNS（兜底 223.5.5.5）"
    fi
  else
    # 其它占用者（dnsmasq 等）只提示，不擅自改动。
    if command -v ss >/dev/null 2>&1 && ss -lnp 2>/dev/null | grep -qE ':53\s'; then
      warn "检测到 53 端口已被占用，若 mihomo DNS 无法启动请先停掉占用进程（ss -lnp | grep :53）"
    fi
  fi
}

install_config() {
  mkdir -p "${MBOX_DIR}/providers"
  if [ -f "${MBOX_DIR}/config.yaml" ]; then
    warn "已存在 ${MBOX_DIR}/config.yaml，跳过不覆盖（如需重置：rm ${MBOX_DIR}/config.yaml 后重装）"
    return
  fi
  # 单一配置来源：复用仓库内置默认配置 internal/config/default.yaml
  #（与离线整包、daemon 内嵌默认完全一致），避免在多处维护重复 mihomo 模板导致漂移。
  local src="${REPO_ROOT}/internal/config/default.yaml"
  [ -f "$src" ] || die "未找到默认配置模板：$src"
  log "写入 config.yaml（来源 internal/config/default.yaml）"
  install -m 0644 "$src" "${MBOX_DIR}/config.yaml"

  if [ -n "$SUB_URL" ]; then
    log "追加订阅 proxy-provider（节点接入策略组：面板「规则与配置 → 配置源码 → 一键推荐策略」可一键重建）"
    cat >> "${MBOX_DIR}/config.yaml" <<YAML

# —— 安装时注入的订阅 ——
proxy-providers:
  sub1:
    type: http
    url: "${SUB_URL}"
    path: ./providers/sub1.yaml
    interval: 86400
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300
YAML
  else
    warn "未提供订阅。可在面板「订阅管理」添加，或用 MBOX_SUB_URL=... 重装"
  fi
}

install_daemon() {
  local bin_src=""
  if [ -x "${REPO_ROOT}/mbox" ]; then
    bin_src="${REPO_ROOT}/mbox"
    log "使用仓库内预编译 daemon：${bin_src}"
  elif command -v go >/dev/null 2>&1; then
    log "用 go 现场构建 daemon…"
    ( cd "$REPO_ROOT" && CGO_ENABLED=0 go build -o mbox ./cmd/mbox ) || die "go build 失败"
    bin_src="${REPO_ROOT}/mbox"
  else
    die "未找到预编译 ${REPO_ROOT}/mbox，且本机无 go。请在有 go 的机器执行 'go build -o mbox ./cmd/mbox' 后把 mbox 放到仓库根目录再重试"
  fi
  install -m 0755 "$bin_src" "$MBOX_BIN"
  log "daemon 已安装：$MBOX_BIN"
}

install_web() {
  local dist="${REPO_ROOT}/web/dist"
  if [ ! -d "$dist" ]; then
    if command -v npm >/dev/null 2>&1; then
      log "现场构建前端（npm install && npm run build）…"
      ( cd "${REPO_ROOT}/web" && npm install && npm run build ) || die "前端构建失败"
    else
      die "未找到 ${dist}，且本机无 npm。请先在有 node 的机器执行 'cd web && npm run build' 再重试"
    fi
  fi
  mkdir -p "${MBOX_DIR}/web"
  rm -rf "${MBOX_DIR}/web"/*
  cp -r "${dist}/." "${MBOX_DIR}/web/"
  log "Web 面板已部署：${MBOX_DIR}/web"
}

install_service() {
  log "安装 systemd 服务：${SERVICE_NAME}（daemon 托管 mihomo + 面板）"
  # 若曾安装过仅跑内核的 mbox-core，停用它避免双开 mihomo。
  if systemctl list-unit-files 2>/dev/null | grep -q '^mbox-core\.service'; then
    systemctl disable --now mbox-core >/dev/null 2>&1 || true
    warn "已停用旧的 mbox-core.service（改由 mbox-daemon 托管 mihomo）"
  fi
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=M-BOX daemon (panel API + mihomo manager)
Documentation=https://github.com/ike-sh/M-BOX
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=MBOX_LISTEN=0.0.0.0:${PANEL_PORT}
Environment=MBOX_WORKDIR=${MBOX_DIR}
Environment=MBOX_MIHOMO_BIN=${MIHOMO_BIN}
Environment=MBOX_CONTROLLER=127.0.0.1:9090
Environment=MBOX_WEBDIR=${MBOX_DIR}/web
Environment=MBOX_MANAGE=1
ExecStart=${MBOX_BIN}
Restart=on-failure
RestartSec=3s
LimitNOFILE=1000000
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
}

print_next_steps() {
  cat <<EOF

$(log "安装完成 ✅")

下一步：
  1. 启动：     systemctl start ${SERVICE_NAME}
  2. 看状态：   systemctl status ${SERVICE_NAME} --no-pager
  3. 看日志：   journalctl -u ${SERVICE_NAME} -f
  4. 打开面板： http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PANEL_PORT}
                 （订阅可直接在面板「订阅管理」里添加，也可手动改 ${MBOX_DIR}/config.yaml）
  5. 主路由侧： 把需要代理的设备的 网关 + DNS 指向本机 IP（$(hostname -I 2>/dev/null | awk '{print $1}')）
  6. 验证：     设备能访问外网；DNS 无泄漏 https://browserleaks.com/dns

架构说明：
  - mbox-daemon 同时托管 mihomo 子进程 + 提供面板（${PANEL_PORT} 端口），无需再单独跑 mihomo。
  - daemon 工作目录 ${MBOX_DIR}，配置 ${MBOX_DIR}/config.yaml，面板静态资源 ${MBOX_DIR}/web。

排错：
  - 看服务是否在跑：        systemctl status ${SERVICE_NAME}
  - 面板健康检查：          curl http://127.0.0.1:${PANEL_PORT}/api/health
  - 看 TUN 网卡：           ip addr show mbox-tun
  - 看路由：               ip route ; ip rule
  - mihomo 控制 API：       curl http://127.0.0.1:9090/version
EOF
}

main() {
  require_root
  require_cmds
  detect_arch
  resolve_version
  install_mihomo
  install_geodata
  setup_sysctl
  install_config
  install_daemon
  install_web
  free_port53
  install_service
  print_next_steps
}

main "$@"
