import { useState } from "react";
import { Stethoscope, CheckCircle2, AlertTriangle, XCircle, RotateCw, Play, Circle } from "lucide-react";
import { GlassCard, CardHead } from "../components/ui";
import { api } from "../lib/api";
import { diagnostics as base } from "../mock/data";
import { useI18n } from "../lib/i18n";
import type { DiagItem } from "../types";

const ICON: Record<DiagItem["status"], React.ReactNode> = {
  idle: <Circle size={20} color="var(--t4)" />,
  running: <RotateCw size={20} color="var(--blue)" className="spin" />,
  pass: <CheckCircle2 size={20} color="var(--green)" />,
  warn: <AlertTriangle size={20} color="var(--orange)" />,
  fail: <XCircle size={20} color="var(--red)" />,
};

export function Diagnostics() {
  const { t } = useI18n();
  const [items, setItems] = useState<DiagItem[]>(() => base.map((d) => ({ ...d, status: "idle", detail: undefined })));
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    // 先把所有项置为「检测中」，给出体检进行中的观感。
    setItems((prev) => prev.map((x) => ({ ...x, status: "running", detail: undefined })));
    try {
      const results = await api.getDiagnostics();
      setItems(results);
    } catch {
      // 体检请求失败时不要回退成「全部通过」的演示数据（会误导），统一标记为失败。
      setItems((prev) =>
        prev.map((x) => ({ ...x, status: "fail", detail: t("体检请求失败：内核未运行或服务不可达", "Diagnostics failed: kernel not running or service unreachable") }))
      );
    }
    setRunning(false);
  }

  const done = items.filter((i) => i.status === "pass" || i.status === "warn" || i.status === "fail");
  const passed = items.filter((i) => i.status === "pass").length;
  const warned = items.filter((i) => i.status === "warn").length;
  const failed = items.filter((i) => i.status === "fail").length;

  return (
    <div className="page">
      <GlassCard>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16 }}>
            <span className="stat-ico" style={{ width: 52, height: 52, borderRadius: 16, background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}>
              <Stethoscope size={24} />
            </span>
            <div className="col">
              <span style={{ fontSize: 17, fontWeight: 700 }}>{t("系统体检", "Diagnostics")}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {done.length === 0
                  ? t("一键检查内核、TUN、转发、DNS、泄漏、连通性与 Geo 数据", "One-click check: kernel, TUN, forwarding, DNS, leaks, connectivity & Geo data")
                  : <>{t("通过", "Pass")} <b className="up">{passed}</b> · {t("警告", "Warn")} <b style={{ color: "var(--orange)" }}>{warned}</b> · {t("失败", "Fail")} <b className="down">{failed}</b></>}
              </span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running ? <RotateCw size={16} className="spin" /> : <Play size={16} />}
            {running ? t("检测中…", "Running…") : t("开始体检", "Run Diagnostics")}
          </button>
        </div>
      </GlassCard>

      <GlassCard>
        <CardHead title={t("检测项", "Checks")} sub={`${t("共", "")} ${items.length} ${t("项", "items")}`.trim()} />
        <div className="col gap-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="row"
              style={{
                gap: 14,
                padding: 14,
                borderRadius: "var(--r-md)",
                background: "var(--fill-2)",
                border: "1px solid var(--hairline)",
                transition: "background 0.2s",
              }}
            >
              <span style={{ flexShrink: 0 }}>{ICON[it.status]}</span>
              <div className="col f1">
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{it.label}</span>
                <span className="muted-2" style={{ fontSize: 11.5 }}>{it.desc}</span>
              </div>
              {it.detail && (
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: it.status === "warn" ? "var(--orange)" : it.status === "fail" ? "var(--red)" : "var(--t2)",
                    textAlign: "right",
                    maxWidth: 280,
                  }}
                >
                  {it.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
