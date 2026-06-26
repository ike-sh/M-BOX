#!/usr/bin/env bash
# M-BOX 卸载 / 还原脚本：停服务、删程序，并把安装时对系统的改动还原到原状
# （IP 转发 / systemd-resolved 53 端口 / resolv.conf）。
#   sudo bash uninstall.sh         # 卸载并还原系统，保留 /etc/mbox 配置
#   sudo PURGE=1 bash uninstall.sh # 连 /etc/mbox（配置/订阅/geo）一起删除
#   也可直接： sudo mbox-uninstall  （安装时已注册的系统命令，加 PURGE=1 同理）
set -euo pipefail

SERVICE_NAME="mbox-daemon"
MBOX_DIR="/etc/mbox"

log()  { printf '\033[1;32m[M-BOX]\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行：sudo bash uninstall.sh" >&2; exit 1; }

# 1. 停止并移除 systemd 服务
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  log "已停止并移除服务 ${SERVICE_NAME}"
fi

# 2. 移除可执行文件与系统命令
rm -f /usr/local/bin/mbox /usr/local/bin/mihomo /usr/local/bin/mbox-uninstall
log "已移除可执行文件"

# 3. 还原 IP 转发（删持久化片段 + 运行时关回，恢复 Debian 默认）
rm -f /etc/sysctl.d/99-mbox.conf
[ -w /proc/sys/net/ipv4/ip_forward ] && echo 0 > /proc/sys/net/ipv4/ip_forward 2>/dev/null || true
sysctl --system >/dev/null 2>&1 || true
log "已还原 IP 转发设置"

# 4. 还原 systemd-resolved（恢复 53 端口 DNS Stub 与 resolv.conf 软链）
rm -f /etc/systemd/resolved.conf.d/mbox.conf
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^systemd-resolved\.service'; then
  systemctl restart systemd-resolved 2>/dev/null || true
  if [ -e /run/systemd/resolve/stub-resolv.conf ]; then
    ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
    log "已将 /etc/resolv.conf 还原为 systemd-resolved 软链"
  fi
  log "已还原 systemd-resolved（53 端口 DNS Stub）"
fi

# 5. 工作目录
if [ "${PURGE:-0}" = "1" ]; then
  rm -rf "${MBOX_DIR}"
  log "已清除工作目录 ${MBOX_DIR}"
else
  log "保留工作目录 ${MBOX_DIR}（如需彻底删除：sudo rm -rf ${MBOX_DIR}）"
fi

log "卸载并还原完成 ✅ 系统已恢复到安装前状态。"
