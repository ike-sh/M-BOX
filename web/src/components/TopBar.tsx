import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Sun, Moon, Bell, FlaskConical, Power, RotateCw } from "lucide-react";
import { Segmented } from "./ui";
import { api, isMockMode } from "../lib/api";
import { useSystem } from "../lib/system";
import { useSubAlerts } from "../lib/subAlerts";

export type Mode = "rule" | "global" | "direct";

/** 全局内核启停控件：任意页面都可见/可操作。状态读自共享的 SystemProvider。 */
function CorePower() {
  const { system, refresh } = useSystem();
  const [busy, setBusy] = useState(false);

  const status = system.core?.status ?? "unknown";
  const version = system.core?.version ?? "";
  const running = status === "running";

  async function act(action: "start" | "stop" | "restart") {
    setBusy(true);
    try {
      await api.coreAction(action);
    } finally {
      setTimeout(() => {
        refresh();
        setBusy(false);
      }, 700);
    }
  }

  const dotColor = running ? "var(--green)" : status === "unknown" ? "var(--t4)" : "var(--red)";
  const label = running ? "运行中" : status === "unknown" ? "未知" : "已停止";

  return (
    <div
      className="core-power row"
      style={{
        gap: 8,
        alignItems: "center",
        padding: "4px 6px 4px 12px",
        borderRadius: 999,
        border: "1px solid var(--hairline)",
        background: "var(--glass-bg, rgba(255,255,255,0.04))",
      }}
      title={version ? `mihomo ${version}` : "mihomo 内核"}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: running ? "0 0 8px var(--green)" : "none", flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "var(--t2)", whiteSpace: "nowrap" }}>内核 · {label}</span>
      <button
        className="icon-btn"
        aria-label={running ? "停止内核" : "启动内核"}
        title={running ? "停止内核" : "启动内核"}
        disabled={busy}
        onClick={() => act(running ? "stop" : "start")}
        style={{ width: 30, height: 30, color: running ? "var(--red)" : "var(--green)" }}
      >
        <Power size={16} />
      </button>
      <button
        className="icon-btn"
        aria-label="重启内核"
        title="重启内核"
        disabled={busy}
        onClick={() => act("restart")}
        style={{ width: 30, height: 30 }}
      >
        <RotateCw size={15} className={busy ? "spin" : ""} />
      </button>
    </div>
  );
}

export function TopBar({
  title,
  sub,
  theme,
  onToggleTheme,
  mode,
  onMode,
}: {
  title: string;
  sub: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
}) {
  const { warnings } = useSubAlerts();
  // 探测一次后端：若不可达则展示「演示数据」角标；同时加载当前运行模式。
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getMode().then((r) => {
      if (!alive) return;
      setDemo(isMockMode());
      if (r?.mode === "rule" || r?.mode === "global" || r?.mode === "direct") onMode(r.mode);
    });
    return () => {
      alive = false;
    };
    // 仅初始化时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeMode(m: Mode) {
    onMode(m); // 乐观
    api.setMode(m);
  }

  return (
    <header className="topbar glass">
      <div className="col">
        <h1>{title}</h1>
        <span className="sub">{sub}</span>
      </div>

      <div className="topbar-actions">
        {demo && (
          <span className="demo-badge" title="未连接到 daemon，当前展示演示数据">
            <FlaskConical size={13} />
            演示数据
          </span>
        )}
        <CorePower />
        <Segmented<Mode>
          value={mode}
          onChange={changeMode}
          options={[
            { value: "rule", label: "规则" },
            { value: "global", label: "全局" },
            { value: "direct", label: "直连" },
          ]}
        />
        <NavLink
          to="/subscriptions"
          className="icon-btn"
          style={{ position: "relative" }}
          aria-label="订阅提醒"
          title={
            warnings.length
              ? `订阅提醒：${warnings.map((w) => `${w.name} ${w.detail}`).join("；")}`
              : "暂无订阅提醒"
          }
        >
          <Bell size={18} />
          {warnings.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 15,
                height: 15,
                padding: "0 4px",
                borderRadius: 999,
                background: "var(--red)",
                color: "#fff",
                fontSize: 10,
                lineHeight: "15px",
                fontWeight: 700,
                textAlign: "center",
                boxShadow: "0 0 6px rgba(255,69,58,0.6)",
              }}
            >
              {warnings.length}
            </span>
          )}
        </NavLink>
        <button className="icon-btn" aria-label="切换主题" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
