import { Suspense, lazy, useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { TopBar, type Mode } from "./components/TopBar";
import { SystemProvider } from "./lib/system";
import { SubAlertsProvider } from "./lib/subAlerts";
import { I18nProvider, useI18n } from "./lib/i18n";

/**
 * 页面按路由懒加载（code-split）：首屏只下载仪表盘所需代码，其余页面在导航到时
 * 才按需加载，减小首包体积、加快首屏。仪表盘作为默认落地页保持静态导入以避免首屏闪烁。
 */
import { Dashboard } from "./pages/Dashboard";
const Proxies = lazy(() => import("./pages/Proxies").then((m) => ({ default: m.Proxies })));
const Connections = lazy(() => import("./pages/Connections").then((m) => ({ default: m.Connections })));
const Subscriptions = lazy(() => import("./pages/Subscriptions").then((m) => ({ default: m.Subscriptions })));
const Rules = lazy(() => import("./pages/Rules").then((m) => ({ default: m.Rules })));
const Dns = lazy(() => import("./pages/Dns").then((m) => ({ default: m.Dns })));
const Tun = lazy(() => import("./pages/Tun").then((m) => ({ default: m.Tun })));
const ProxySettings = lazy(() => import("./pages/ProxySettings").then((m) => ({ default: m.ProxySettings })));
const Devices = lazy(() => import("./pages/Devices").then((m) => ({ default: m.Devices })));
const Kernels = lazy(() => import("./pages/Kernels").then((m) => ({ default: m.Kernels })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Logs = lazy(() => import("./pages/Logs").then((m) => ({ default: m.Logs })));

/** 懒加载页面切换时的占位，避免空白闪烁。 */
function PageFallback() {
  return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 240, color: "var(--t3)" }}>
      <span className="spin" style={{ width: 22, height: 22, border: "2px solid var(--hairline)", borderTopColor: "var(--blue)", borderRadius: "50%" }} />
    </div>
  );
}

const META: Record<string, { title: [string, string]; sub: [string, string] }> = {
  "/": { title: ["仪表盘", "Dashboard"], sub: ["实时流量、节点与系统总览", "Real-time traffic, proxies & system overview"] },
  "/proxies": { title: ["节点管理", "Proxies"], sub: ["策略组切换、节点延迟与测速", "Group switching, latency & speed test"] },
  "/connections": { title: ["连接监控", "Connections"], sub: ["实时连接表 · 域名 / 规则 / 速率", "Live connections · host / rule / rate"] },
  "/subscriptions": { title: ["订阅管理", "Subscriptions"], sub: ["机场订阅、定时更新与流量", "Airport subscriptions, auto-update & traffic"] },
  "/rules": { title: ["规则与配置", "Rules & Config"], sub: ["分流规则 / 规则集 / 配置源码（统一管理）", "Rules / rule-sets / raw config (unified)"] },
  "/settings": { title: ["代理设置", "Proxy Settings"], sub: ["端口 / 基础 / 性能 / DNS / TUN / 嗅探 / GEO 统一配置", "Ports / general / performance / DNS / TUN / sniffer / GEO"] },
  "/dns": { title: ["DNS 配置", "DNS"], sub: ["fake-ip、加密上游与防泄漏", "fake-ip, encrypted upstream & anti-leak"] },
  "/tun": { title: ["透明代理", "Transparent Proxy"], sub: ["TUN 内核、路由与局域网排除", "TUN stack, routing & LAN exclusions"] },
  "/devices": { title: ["设备策略", "Device Policy"], sub: ["按源 IP 把设备定向到策略组 / 直连 / 拦截", "Route devices by source IP to group / direct / reject"] },
  "/kernels": { title: ["核心管理", "Kernels"], sub: ["当前内核、可用内核与版本（多内核可插拔）", "Current & available kernels, versions (pluggable)"] },
  "/system": { title: ["设置", "Settings"], sub: ["主题 / 系统更新 / 系统优化 / 系统控制 / 诊断", "Theme / update / tuning / control / diagnostics"] },
  "/logs": { title: ["日志", "Logs"], sub: ["Mihomo 内核日志 + 后端 daemon 日志（实时）", "Mihomo kernel logs + backend daemon logs (live)"] },
};

function Shell({
  theme,
  toggleTheme,
  mode,
  setMode,
}: {
  theme: "dark" | "light";
  toggleTheme: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const { pathname } = useLocation();
  const { lang } = useI18n();
  const i = lang === "en" ? 1 : 0;
  const m = META[pathname];
  const meta = m ? { title: m.title[i], sub: m.sub[i] } : { title: "M-BOX", sub: "" };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-col">
        <TopBar
          title={meta.title}
          sub={meta.sub}
          theme={theme}
          onToggleTheme={toggleTheme}
          mode={mode}
          onMode={setMode}
        />
        <div className="content-scroll">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxies" element={<Proxies />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/settings" element={<ProxySettings />} />
              <Route path="/dns" element={<Dns />} />
              <Route path="/tun" element={<Tun />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/config" element={<Navigate to="/rules" replace />} />
              <Route path="/kernels" element={<Kernels />} />
              <Route path="/system" element={<Settings />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("mbox-theme") as "dark" | "light") || "dark"
  );
  const [mode, setMode] = useState<Mode>("rule");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mbox-theme", theme);
  }, [theme]);

  return (
    <I18nProvider>
      <div className="aurora" />
      <HashRouter>
        <SystemProvider>
          <SubAlertsProvider>
            <Shell
              theme={theme}
              toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              mode={mode}
              setMode={setMode}
            />
          </SubAlertsProvider>
        </SystemProvider>
      </HashRouter>
    </I18nProvider>
  );
}
