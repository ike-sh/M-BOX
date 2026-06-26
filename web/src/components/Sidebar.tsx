import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Globe,
  Activity,
  Rss,
  ListFilter,
  SlidersHorizontal,
  ScrollText,
  Cpu,
  Settings,
  Router,
  Send,
} from "lucide-react";
import { useSystem } from "../lib/system";
import { useSubAlerts } from "../lib/subAlerts";

const TELEGRAM_URL = "https://t.me/m_boxpro";

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Globe;
  badge?: string;
}

const sections: { label: string; items: NavEntry[] }[] = [
  {
    label: "概览",
    items: [{ to: "/", label: "仪表盘", icon: LayoutDashboard }],
  },
  {
    label: "代理",
    items: [
      { to: "/proxies", label: "节点管理", icon: Globe },
      { to: "/connections", label: "连接监控", icon: Activity },
      { to: "/subscriptions", label: "订阅管理", icon: Rss },
      { to: "/rules", label: "规则与配置", icon: ListFilter },
      { to: "/kernels", label: "核心管理", icon: Cpu },
    ],
  },
  {
    label: "网络",
    items: [
      { to: "/settings", label: "代理设置", icon: SlidersHorizontal },
      { to: "/devices", label: "设备策略", icon: Router },
    ],
  },
  {
    label: "系统",
    items: [
      { to: "/logs", label: "日志", icon: ScrollText },
      { to: "/system", label: "设置", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const { system } = useSystem();
  const { warnings } = useSubAlerts();
  const subWarnCount = warnings.length;
  // 侧边栏底部展示 M-BOX 自身版本（内核运行状态已在顶栏展示，这里不再重复）。
  const mboxVersion = system.mboxVersion ?? "";

  return (
    <aside className="sidebar glass">
      <div className="brand">
        <div className="brand-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 18V7l7 5 7-5v11"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="col">
          <span className="brand-name">M-BOX</span>
          <span className="brand-sub">透明代理网关</span>
        </div>
      </div>

      <nav className="nav">
        {sections.map((sec) => (
          <div key={sec.label}>
            <div className="nav-label">{sec.label}</div>
            {sec.items.map((it) => {
              const warn = it.to === "/subscriptions" && subWarnCount > 0;
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === "/"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <it.icon size={18} strokeWidth={2} />
                  <span>{it.label}</span>
                  {warn ? (
                    <span className="nav-badge warn" title={`${subWarnCount} 条订阅需处理（快过期 / 流量将用尽）`}>
                      {subWarnCount}
                    </span>
                  ) : (
                    it.badge && <span className="nav-badge">{it.badge}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="core-state">
          <span className="dot" style={{ background: "var(--blue)", boxShadow: "0 0 8px var(--blue)" }} />
          <div className="col f1">
            <span className="label">M-BOX</span>
            <span className="ver">{mboxVersion ? `v${mboxVersion}` : "透明代理网关"}</span>
          </div>
          <a
            className="tg-icon"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            title="加入 M-BOX Telegram 群组（@m_boxpro）"
          >
            <Send size={17} strokeWidth={2} />
          </a>
        </div>
      </div>
    </aside>
  );
}
