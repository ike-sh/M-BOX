#!/usr/bin/env bash
# M-BOX 离线安装脚本（随整包分发，包内已内置内核/geo/前端/配置，全程不联网）
#
# 用法（Debian 12 旁路由，root 运行，解压后在包目录里执行）：
#   sudo bash install.sh                 # 一键部署并启动
#   sudo MBOX_PORT=8088 bash install.sh  # 自定义面板端口
#
# 部署完成后会打印 M-BOX 面板地址，局域网内任意设备浏览器打开即可使用。
set -euo pipefail

# 脚本所在目录即整包根目录（内含 mbox / bin/mihomo / geo / web / config.yaml）。
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MBOX_DIR="/etc/mbox"
MBOX_BIN="/usr/local/bin/mbox"
MIHOMO_BIN="/usr/local/bin/mihomo"
SERVICE_NAME="mbox-daemon"
PANEL_PORT="${MBOX_PORT:-8088}"

log()  { printf '\033[1;32m[M-BOX]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[M-BOX]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[M-BOX]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash install.sh"
}

check_payload() {
  [ -f "${PKG_DIR}/mbox" ]        || die "包内缺少 mbox（daemon 可执行文件），整包可能不完整"
  [ -f "${PKG_DIR}/bin/mihomo" ]  || die "包内缺少 bin/mihomo（内核），整包可能不完整"
  [ -d "${PKG_DIR}/web" ]         || die "包内缺少 web（前端静态资源），整包可能不完整"
  [ -f "${PKG_DIR}/config.yaml" ] || die "包内缺少 config.yaml（默认配置），整包可能不完整"
  log "整包内容校验通过（内核/前端/配置均已内置，离线安装）"
}

install_bins() {
  install -m 0755 "${PKG_DIR}/mbox" "$MBOX_BIN"
  install -m 0755 "${PKG_DIR}/bin/mihomo" "$MIHOMO_BIN"
  log "已安装可执行文件：${MBOX_BIN} / ${MIHOMO_BIN}"
  log "mihomo 版本：$("$MIHOMO_BIN" -v 2>/dev/null | head -n1 || echo '未知')"
}

# install_uninstaller 注册系统级卸载命令 mbox-uninstall，便于随时一键卸载并还原系统。
install_uninstaller() {
  if [ -f "${PKG_DIR}/uninstall.sh" ]; then
    install -m 0755 "${PKG_DIR}/uninstall.sh" /usr/local/bin/mbox-uninstall
    log "已注册卸载命令：mbox-uninstall（卸载并还原系统）"
  fi
}

install_assets() {
  mkdir -p "${MBOX_DIR}/providers"
  # geo 数据：不存在才放，避免覆盖用户后续自更新的数据。
  for f in geoip.dat geosite.dat; do
    if [ -f "${PKG_DIR}/geo/${f}" ] && [ ! -f "${MBOX_DIR}/${f}" ]; then
      install -m 0644 "${PKG_DIR}/geo/${f}" "${MBOX_DIR}/${f}"
      log "已部署 geo 数据：${f}"
    fi
  done
  # 前端静态资源：每次覆盖到最新。
  mkdir -p "${MBOX_DIR}/web"
  rm -rf "${MBOX_DIR}/web"/*
  cp -r "${PKG_DIR}/web/." "${MBOX_DIR}/web/"
  log "Web 面板已部署：${MBOX_DIR}/web"
  # 配置：仅在不存在时写入默认，已存在则保留用户改动。
  if [ -f "${MBOX_DIR}/config.yaml" ]; then
    warn "已存在 ${MBOX_DIR}/config.yaml，保留不覆盖（如需重置：rm ${MBOX_DIR}/config.yaml 后重装）"
  else
    install -m 0644 "${PKG_DIR}/config.yaml" "${MBOX_DIR}/config.yaml"
    log "已写入默认配置：${MBOX_DIR}/config.yaml（开箱即用，节点请在面板里添加）"
  fi
}

setup_sysctl() {
  log "开启 ip_forward + 放宽 rp_filter（旁路由必需）"
  cat > /etc/sysctl.d/99-mbox.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
EOF
  sysctl --system >/dev/null 2>&1 || warn "sysctl 应用失败，请手动检查 /etc/sysctl.d/99-mbox.conf"
}

# free_port53：Debian 默认 systemd-resolved 占用 127.0.0.53:53，会让 mihomo
# 的 dns.listen=0.0.0.0:53 绑定失败。关闭其 Stub 监听并把本机 DNS 指向 mihomo。
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
    if [ -L /etc/resolv.conf ] || grep -q '127.0.0.53' /etc/resolv.conf 2>/dev/null; then
      rm -f /etc/resolv.conf
      printf 'nameserver 127.0.0.1\nnameserver 223.5.5.5\n' > /etc/resolv.conf
      log "已将 /etc/resolv.conf 指向本机 mihomo DNS（兜底 223.5.5.5）"
    fi
  else
    if command -v ss >/dev/null 2>&1 && ss -lnp 2>/dev/null | grep -qE ':53\s'; then
      warn "检测到 53 端口已被占用，若 mihomo DNS 无法启动请先停掉占用进程（ss -lnp | grep :53）"
    fi
  fi
}

install_service() {
  log "安装 systemd 服务：${SERVICE_NAME}（daemon 托管 mihomo + 提供面板）"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=M-BOX daemon (panel API + mihomo manager)
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
  systemctl restart "${SERVICE_NAME}"
}

wait_health() {
  log "等待面板启动…"
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

print_done() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ip" ] || ip="<本机IP>"
  cat <<EOF

$(log "部署完成 ✅  M-BOX 已在后台运行")

  ┌────────────────────────────────────────────────┐
   面板地址： http://${ip}:${PANEL_PORT}
  └────────────────────────────────────────────────┘

  局域网内任意设备浏览器打开上面的地址即可使用。

下一步：
  1. 打开面板 → 「订阅管理」添加机场订阅，或「节点管理」手动添加节点
  2. 主路由侧：把需要代理的设备的 网关 + DNS 指向本机 IP（${ip}）
  3. 验证：设备能访问外网；DNS 无泄漏 https://browserleaks.com/dns

常用命令：
  看状态： systemctl status ${SERVICE_NAME} --no-pager
  看日志： journalctl -u ${SERVICE_NAME} -f
  重启：   systemctl restart ${SERVICE_NAME}
  停止：   systemctl stop ${SERVICE_NAME}
  卸载还原：sudo mbox-uninstall            （加 PURGE=1 连配置一起删：sudo PURGE=1 mbox-uninstall）
EOF
}

main() {
  require_root
  check_payload
  install_bins
  install_uninstaller
  install_assets
  setup_sysctl
  free_port53
  install_service
  if wait_health; then
    print_done
  else
    warn "面板健康检查未通过，请查看日志：journalctl -u ${SERVICE_NAME} -e"
    print_done
  fi
}

main "$@"
