import { useEffect, useState } from "react";
import { Cpu, Check, Play, Square, RotateCw, RefreshCw, ArrowRightLeft } from "lucide-react";
import { GlassCard, CardHead, Pill } from "../components/ui";
import { api } from "../lib/api";
import { useSystem } from "../lib/system";
import type { KernelsResp, KernelInfo } from "../types";

// 各内核的简介与配色（仅展示用）。
const KERNEL_META: Record<string, { desc: string; grad: string }> = {
  mihomo: { desc: "高性能 Clash 核心", grad: "linear-gradient(135deg,#0a84ff,#5e5ce6)" },
  "sing-box": { desc: "新一代代理核心", grad: "linear-gradient(135deg,#bf5af2,#ff375f)" },
};

// normVer 规范化版本（去前导 v）；installed≠latest 即视为可升级。
function normVer(s: string): string {
  return s.trim().replace(/^[vV]/, "");
}
function hasUpdate(k: KernelInfo): boolean {
  return !!k.installed && !!k.latest && normVer(k.installed) !== normVer(k.latest);
}

export function Kernels() {
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
        <CardHead icon={<Cpu size={18} color="var(--blue)" />} title="当前核心" sub="正在使用的代理内核与运行状态" />
        <div className="row between" style={{ gap: 12, padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
          <div className="row" style={{ gap: 14, minWidth: 0 }}>
            <span className="stat-ico" style={{ width: 44, height: 44, borderRadius: 13, background: KERNEL_META[current?.kind ?? "mihomo"]?.grad ?? "var(--accent-grad)", flexShrink: 0 }}>
              <Cpu size={20} />
            </span>
            <div className="col" style={{ minWidth: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{current?.displayName ?? "mihomo"}</span>
              <span className="muted mono" style={{ fontSize: 12.5 }}>
                {current?.installed ? `v${current.installed}` : "版本未知"}
              </span>
            </div>
          </div>
          {running ? <Pill tone="green" dot>运行中</Pill> : <Pill tone="red" dot>已停止</Pill>}
        </div>
        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost f1" onClick={() => coreAct("start")} disabled={busy || running}><Play size={15} /> 启动</button>
          <button className="btn btn-ghost f1" onClick={() => coreAct("stop")} disabled={busy || !running}><Square size={15} /> 停止</button>
          <button className="btn btn-primary f1" onClick={() => coreAct("restart")} disabled={busy}><RotateCw size={15} className={busy ? "spin" : ""} /> 重启</button>
        </div>
      </GlassCard>

      {/* 可用核心 */}
      <GlassCard>
        <CardHead
          icon={<Cpu size={18} color="var(--purple)" />}
          title="可用核心"
          sub="多内核可插拔抽象，便于后续替换"
          right={
            <div className="row gap-2" style={{ alignItems: "center" }}>
              {data && <Pill tone="blue">{data.os} {data.arch}</Pill>}
              <button className="btn btn-ghost btn-sm" onClick={doRefresh} disabled={refreshing} title="重新检测已安装/最新版本">
                <RefreshCw size={13} className={refreshing ? "spin" : ""} /> 刷新
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
  const meta = KERNEL_META[k.kind] ?? { desc: "代理内核", grad: "var(--accent-grad)" };
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
            <span className="muted-2" style={{ fontSize: 11.5 }}>{meta.desc}</span>
          </div>
        </div>
        {k.current && <Check size={18} color="var(--blue)" style={{ flexShrink: 0 }} />}
      </div>

      <div className="col gap-2">
        <div className="row between">
          <span className="muted-2" style={{ fontSize: 12 }}>已安装</span>
          <span className="mono" style={{ fontSize: 12.5, color: k.installed ? "var(--blue)" : "var(--t3)" }}>
            {k.installed ? `v${k.installed}` : "未安装"}
          </span>
        </div>
        <div className="row between">
          <span className="muted-2" style={{ fontSize: 12 }}>最新版本</span>
          <span className="row" style={{ gap: 6 }}>
            <span className="mono" style={{ fontSize: 12.5, color: k.latest ? "var(--green)" : "var(--t3)" }}>
              {k.latest ? `v${normVer(k.latest)}` : "未知"}
            </span>
            {upd && <Pill tone="orange" dot>可升级</Pill>}
          </span>
        </div>
      </div>

      <div className="row gap-2">
        {k.current ? (
          <span className="pill pill-blue" style={{ height: 30 }}>当前使用中</span>
        ) : (
          <button
            className="btn btn-ghost f1"
            disabled
            title="多内核切换框架已就绪，sing-box 接入待后续版本"
            style={{ opacity: 0.6, cursor: "not-allowed" }}
          >
            <ArrowRightLeft size={14} /> 切换到此核心（暂未支持）
          </button>
        )}
      </div>
    </div>
  );
}
