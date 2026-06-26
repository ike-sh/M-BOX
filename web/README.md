# M-BOX Web 管理面板

M-BOX 透明代理网关的可视化管理面板。**macOS Tahoe「Liquid Glass」液态玻璃**风格 —— 深色为主、极光渐变背景、毛玻璃悬浮面板、弹性动效，商业级精致度。

## 技术栈

- **React 18 + Vite 5 + TypeScript**
- **react-router-dom** 路由（HashRouter，免服务端 fallback）
- **recharts** 实时流量图表
- **lucide-react** 矢量图标
- 纯手写 CSS 设计系统（`src/styles/global.css`），不依赖重型组件库以精确还原玻璃质感

## 功能模块（对应 DESIGN.md 面板清单）

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 仪表盘 | `/` | 实时上下行、连接数、节点状态、系统负载、规则命中、最近连接 |
| 节点与策略 | `/proxies` | 策略组切换、节点延迟、一键测速、按区域筛选 |
| 连接监控 | `/connections` | 实时连接表（域名/IP/规则/链路/速率），搜索、暂停、断开 |
| 订阅管理 | `/subscriptions` | 机场订阅、流量用量、定时更新、启用开关 |
| 分流规则 | `/rules` | 规则集（rule-providers）、规则列表与命中统计 |
| DNS 配置 | `/dns` | fake-ip、加密上游、防泄漏状态、过滤名单 |
| 透明代理 | `/tun` | TUN 开关、协议栈、auto-route/redirect、DNS 劫持、局域网排除 |
| 配置管理 | `/config` | 当前配置预览、备份历史、恢复/回滚、导入导出 |
| 系统状态 | `/system` | 资源占用、主机信息、内核服务启停、实时日志 |
| 一键诊断 | `/diagnostics` | 内核/TUN/转发/DNS/泄漏/连通性/Geo 逐项体检 |

## 开发

```bash
npm install
npm run dev      # http://localhost:5173
```

## 构建

```bash
npm run build    # 产物输出到 dist/
npm run preview  # 本地预览构建产物
```

## 数据来源 / 对接 daemon

当前所有数据为 **mock**（前端先行），统一收口在 `src/lib/api.ts`：

- REST：`/api/*`（开发期由 Vite 反代到 daemon `127.0.0.1:9091`）
- 实时：`/ws/*`（WebSocket，流量/连接推送）

待 Go daemon 就绪后，把 `src/lib/api.ts` 中 `MOCK = true` 改为 `false`，组件层无需改动即可接入真实数据。

## 主题

右上角可切换深色 / 浅色，偏好持久化到 `localStorage`。默认深色，更贴合「商业化」基调。
