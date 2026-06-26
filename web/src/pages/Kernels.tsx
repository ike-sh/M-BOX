import { useEffect, useState } from "react";
import { Cpu, Check, Play, Square, RotateCw, RefreshCw, ArrowRightLeft } from "lucide-react";
import { GlassCard, CardHead, Pill } from "../components/ui";
import { api } from "../lib/api";
import { useSystem } from "../lib/system";
import { useI18n } from "../lib/i18n";
import type { KernelsResp, KernelInfo } from "../types";

// 各内核的简介与配色（仅展示用）。
const KERNEL_META: Record<string, { desc: string; descEn: string; grad: string }> = {
  mihomo: { desc: "高性能 Clash 核心", descEn: "High-performance Clash core", grad: "linear-gradient(135deg,#0a84ff,#5e5ce6)" },
  "sing-box": { desc: "新一代代理核心", descEn: "Next-gen proxy core", grad: "linear-gradient(135deg,#bf5af2,#ff375f)" },
};

// normVer 规范化版本（去前导 v）；installed≠latest 即视为可升级。
function normVer(s: string): string {
  return s.trim().replace(/^[vV]/, "");
}
function hasUpdate(k: KernelInfo): boolean {
  return !!k.installed && !!k.latest && normVer(k.installed) !== normVer(k.latest);
}

export function Kernels() {
  const { t } = useI18n();
  const { refresh: refreshSystem } = useSystem();
  const [data, setData] = useState<KernelsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const r = await api.getKernels();
    setData(r);
  }
  useEffect(() => {
    load();
  }, []);

  const kernels = data?.kernels ?? [];
  const current = kernels.find((k) => k.current) ?? null;
  const running = !!current?.running;

  async function coreAct(action: "start" | "stop" | "restart") {
    if (busy) return;
    setBusy(true);
    try {
      await api.coreAction(action);
    } finally {
      setTimeout(async () => {
        await load();
        refreshSystem();
        setBusy(false);
      }, 800);
    }
  }

  async function doRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page">
      {/* 当前核心 */}
      <GlassCard>
        <CardHead icon={<Cpu size={18} color="var(--blue)" />} title={t("当前核心", "Current Kernel")} sub={t("正在使用的代理内核与运行状态", "Active proxy kernel & status")} />
        <div className="row between" style={{ gap: 12, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="stat-ico" style={{ width: 44, height: 44, borderRadius: 13, background: KERNEL_META[current?.kind ?? "mihomo"]?.grad ?? "var(--accent-grad)", flexShrink: 0 }}>
              <Cpu size={20} />
            </span>
            <div className="col" style={{ minWidth: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{current?.displayName ?? "mihomo"}</span>
              <span className="muted mono" style={{ fontSize: 12.5 }}>
                {current?.installed ? `v${current.installed}` : t("版本未知", "Unknown version")}
              </span>
            </div>
          </div>
          {running ? <Pill tone="green" dot>{t("运行中", "Running")}</Pill> : <Pill tone="red" dot>{t("已停止", "Stopped")}</Pill>}
        </div>
        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost f1" onClick={() => coreAct("start")} disabled={busy || running}><Play size={15} /> {t("启动", "Start")}</button>
          <button className="btn btn-ghost f1" onClick={() => coreAct("stop")} disabled={busy || !running}><Square size={15} /> {t("停止", "Stop")}</button>
          <button className="btn btn-primary f1" onClick={() => coreAct("restart")} disabled={busy}><RotateCw size={15} className={busy ? "spin" : ""} /> {t("重启", "Restart")}</button>
        </div>
      </GlassCard>

      {/* 可用核心 */}
      <GlassCard>
        <CardHead
          icon={<Cpu size={18} color="var(--purple)" />}
          title={t("可用核心", "Available Kernels")}
          sub={t("多内核可插拔抽象，便于后续替换", "Pluggable multi-kernel abstraction")}
          right={
            <div className="row gap-2" style={{ alignItems: "center" }}>
              {data && <Pill tone="blue">{data.os} {data.arch}</Pill>}
              <button className="btn btn-ghost btn-sm" onClick={doRefresh} disabled={refreshing} title={t("重新检测已安装/最新版本", "Re-check installed / latest version")}>
                <RefreshCw size={13} className={refreshing ? "spin" : ""} /> {t("刷新", "Refresh")}
              </button>
            </div>
          }
        />
        <div className="grid cols-2" style={{ gap: 12 }}>
          {kernels.map((k) => (
            <KernelCard key={k.kind} k={k} />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function KernelCard({ k }: { k: KernelInfo }) {
  const { t, lang } = useI18n();
  const meta = KERNEL_META[k.kind] ?? { desc: "代理内核", descEn: "Proxy core", grad: "var(--accent-grad)" };
  const upd = hasUpdate(k);
  return (
    <div
      className="col"
      style={{
        gap: 12,
        padding: 16,
        borderRadius: "var(--r-md)",
        background: "var(--fill-2)",
        border: `1px solid ${k.current ? "var(--blue)" : "var(--hairline)"}`,
      }}
    >
      <div className="row between" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <span className="stat-ico" style={{ width: 38, height: 38, borderRadius: 11, background: meta.grad, flexShrink: 0 }}>
            <Cpu size={17} />
          </span>
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{k.displayName}</span>
            <span className="muted-2" style={{ fontSize: 11.5 }}>{lang === "en" ? meta.descEn : meta.desc}</span>
          </div>
        </div>
        {k.current && <Check size={18} color="var(--blue)" style={{ flexShrink: 0 }} />}
      </div>

      <div className="col gap-2">
        <div className="row between">
          <span className="muted-2" style={{ fontSize: 12 }}>{t("已安装", "Installed")}</span>
          <span className="mono" style={{ fontSize: 12.5, color: k.installed ? "var(--blue)" : "var(--t3)" }}>
            {k.installed ? `v${k.installed}` : t("未安装", "Not installed")}
          </span>
        </div>
        <div className="row between">
          <span className="muted-2" style={{ fontSize: 12 }}>{t("最新版本", "Latest")}</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="mono" style={{ fontSize: 12.5, color: k.latest ? "var(--green)" : "var(--t3)" }}>
              {k.latest ? `v${normVer(k.latest)}` : t("未知", "Unknown")}
            </span>
            {upd && <Pill tone="orange" dot>{t("可升级", "Update")}</Pill>}
          </span>
        </div>
      </div>

      <div className="row gap-2">
        {k.current ? (
          <span className="pill pill-blue" style={{ height: 30 }}>{t("当前使用中", "In use")}</span>
        ) : (
          <button
            className="btn btn-ghost f1"
            disabled
            title={t("多内核切换框架已就绪，sing-box 接入待后续版本", "Multi-kernel framework ready; sing-box support coming later")}
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            <ArrowRightLeft size={14} /> {t("切换到此核心（暂未支持）", "Switch to this kernel (not yet supported)")}
          </button>
        )}
      </div>
    </div>
  );
}
