# M-BOX · 设计文档 (v0.1 草案)

> 家用透明代理网关 Appliance。目标：替换臃肿的 OpenWrt 旁路由，做一台**专职、轻量、自带 Web 面板**的代理网关。

## 1. 背景与目标

- **现状**：爱快主路由 + OpenWrt 旁路由 (OpenClash/mihomo)，给指定设备透明翻墙。
- **痛点**：OpenWrt 功能冗余、维护重、TUN 在容器里别扭。
- **目标**：PVE 上一台轻量 KVM VM，只干「透明代理 + 可视化管理」，开机即用、坏了秒回退。

## 2. 定位 / 非目标

**是什么**：单机透明代理网关 + 自研面板（基于 mihomo）。

**不做**（交给爱快）：DHCP、设备级"谁走代理"筛选、防火墙/NAT 主职、拨号。

**不做（至少 MVP 不做）**：多用户 SaaS、计费、自建转发内核、魔改 mihomo。

## 3. 整体架构

```text
[爱快主路由] --(DHCP 给选定设备下发 网关/DNS 指向)--> [M-BOX VM]
                                                         |
   +-----------------------------------------------------+
   |  PVE KVM VM (Debian 12 minimal)
   |  +--------------+   +----------------------+   +----------+
   |  | React Web UI |<->| gateway-daemon (Go)  |<->| mihomo   |
   |  +--------------+   |  进程管理/配置生成    |   | (子进程) |
   |                     |  订阅/规则/API        |   | TUN+API  |
   |                     +----------------------+   +----------+
   |  nftables(auto-redirect) + tun0 + ip_forward
   +- 出口: 直连->eth0 / 代理->机场节点
```

## 4. 技术选型（已定）

- **内核**：mihomo（MetaCubeX/mihomo，不 fork）。
  - 理由：xhttp/新协议全支持 + Clash 订阅生态 + TUN 移植自 sing-box。
  - 版本策略：默认 **stable release**；需要前沿协议时 **pin 某个 Alpha 构建**；二进制外置，面板支持选版本/升级，不锁死。
  - 不选：原版 Clash（弃）、Clash Premium（闭源停更）、第三方魔改内核（维护滞后）。
- **后端**：Go 单二进制（exec 托管 mihomo、生成 config、反代 mihomo external-controller API、自有 REST/WS、systemd 托管）。
- **前端**：React + Vite + 组件库 (antd 或 shadcn) + recharts + WebSocket 实时。
- **透明代理**：mihomo **TUN + auto-redirect**（nftables，性能优于 tproxy）。
- **DNS**：fake-ip + 上游 DoH/DoT + `dns-hijack any:53`。
- **状态存储**：SQLite（无 CGO 版）或分层 YAML/JSON。

## 5. 部署形态

- 交付：**一键安装脚本**（裸 Debian 12 → 装 mihomo + daemon + UI + systemd + nftables 初始化）。
- 资源：512MB~1G 内存 / 2G 磁盘。
- 回退：VM 挂掉 → 爱快把设备网关改回主路由即可。

## 6. 核心数据流

- **流量**：设备 -> VM eth0 -> nftables auto-redirect -> mihomo tun0 -> 分流(直连/代理) -> 出口。
- **DNS**：53 劫持 -> mihomo fake-ip -> 上游加密 DNS（防污染/泄漏）。
- **控制**：浏览器 -> Web -> daemon(REST/WS) -> 生成 config.yaml + 热重载 mihomo / 调 mihomo API 取实时数据。

## 7. 面板功能模块清单

1. **仪表盘**：实时上下行、连接数、当前节点、系统负载、内核状态。
2. **订阅管理**：多订阅、定时更新、Base64/V2Ray→Clash 转换、节点去重。
3. **节点 / 策略组**：列表、测速(延迟)、手动/自动 (url-test/fallback) 切换。
4. **规则管理**：rule-providers、GeoIP/GeoSite、自定义规则、优先级、可视化编辑。
5. **DNS 配置**：fake-ip 段、上游、hijack、防泄漏开关。
6. **透明代理控制**：TUN 开关、stack、auto-route/redirect、排除网段(局域网直连)。
7. **连接监控**：实时连接表(域名/IP/规则/上下行)，可断开。
8. **配置管理**：备份 / 恢复 / 版本回滚 / 导入导出。
9. **系统**：内核版本与升级、服务启停重启、日志；**鉴权可选(默认关)**。
10. **诊断**：连通性 / DNS / 泄漏 / 延迟 一键体检。

## 8. MVP 里程碑

- **M0 地基**：VM + 一键脚本 + mihomo 托管 + TUN 透明代理跑通（能翻墙）。
- **M1 最小面板**（无鉴权）：订阅导入/更新 + 节点列表 + 内核启停 + 实时流量/连接 (走 mihomo API)。
- **M2 规则策略**：策略组切换 + 规则集管理 + 分流可视化 + DNS 配置。
- **M3 运维增强**：配置备份/回滚 + 节点测速 + 日志 + 定时更新 + 一键诊断。
- **M4 进阶(后续)**：多内核可插拔抽象 + 按设备策略 + IPv6 完整 + 告警。

## 9. 关键风险与对策

- **DNS 泄漏 / IPv6 半开** → fake-ip + strict-route，IPv6 要么全代理要么干净关闭。
- **mihomo 热重载断连** → 优先用 API patch 配置，必要时再 reload，区分"软改/硬重启"。
- **旁路由单点** → daemon 健康检查 + 看门狗自拉起；文档给爱快侧回退步骤。
- **配置生成正确性** → 订阅 + 自定义规则**分层 merge**，生成后校验再下发。
- **安全** → 面板鉴权可选(默认关)、mihomo external-controller 绑 `127.0.0.1`、面板默认不暴露公网。

## 10. 建议目录结构

```text
M-BOX/
├── cmd/mbox/               # Go 入口
├── internal/core/          # mihomo 进程管理 + API 客户端
├── internal/config/        # 订阅拉取/转换/分层merge/校验
├── internal/api/           # REST + WS (鉴权可选)
├── internal/store/         # 持久化
├── web/                    # React + Vite
├── scripts/install.sh      # 一键安装
├── systemd/mbox.service
└── docs/                   # 设计文档
```

## 11. 决策记录 (ADR 摘要)

- **内核 = mihomo**：满足 xhttp/新协议 + Clash 订阅 + 优秀 TUN（移植自 sing-box），换 sing-box 纯亏；不 fork。
- **形态 = PVE KVM VM**（非 LXC）：LXC 对 TUN 不友好（需特权 + 设备透传 + 共享内核）。
- **拓扑 = 旁路由**：设备筛选交给爱快，M-BOX 只做"目标分流"，职责单一、可秒回退。
- **鉴权 = 可选默认关**：内网自用不暴露公网；mihomo API 绑 127.0.0.1 才是真正要守的面。
