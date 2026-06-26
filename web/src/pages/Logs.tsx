import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search, Eraser, Copy, ChevronDown, ChevronUp, Info } from "lucide-react";
import { GlassCard, CardHead, Pill } from "../components/ui";
import { api } from "../lib/api";

interface LogLine {
  time: string;
  level: string;
  msg: string;
}

const LEVELS = [
  { k: "debug", label: "调试" },
  { k: "info", label: "信息" },
  { k: "warning", label: "警告" },
  { k: "error", label: "错误" },
];

function normLevel(l: string): string {
  l = (l || "info").toLowerCase();
  if (l.startsWith("warn")) return "warning";
  if (l.startsWith("err")) return "error";
  if (l.startsWith("debug")) return "debug";
  return "info";
}

export function Logs() {
  const [mihomo, setMihomo] = useState<LogLine[]>([]);
  const [backend, setBackend] = useState<LogLine[]>([]);
  const [levels, setLevels] = useState<Set<string>>(new Set(["debug", "info", "warning", "error"]));
  const [q, setQ] = useState("");
  const [mOpen, setMOpen] = useState(true);
  const [bOpen, setBOpen] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const off = api.subscribeLogs((m) => {
      const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      setMihomo((p) => [...p.slice(-499), { time: now, level: normLevel(m.type), msg: m.payload }]);
    });
    return off;
  }, []);
  useEffect(() => {
    const off = api.subscribeBackendLogs((l) => {
      setBackend((p) => [...p.slice(-499), { time: l.time, level: normLevel(l.level), msg: l.msg }]);
    });
    return off;
  }, []);

  function toggleLevel(k: string) {
    setLevels((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  const mFiltered = useMemo(
    () => mihomo.filter((l) => levels.has(l.level) && (!q || l.msg.toLowerCase().includes(q.toLowerCase()))),
    [mihomo, levels, q]
  );
  const bFiltered = useMemo(
    () => backend.filter((l) => levels.has(l.level) && (!q || l.msg.toLowerCase().includes(q.toLowerCase()))),
    [backend, levels, q]
  );

  function copyArea(lines: LogLine[], tag: string) {
    copyText(lines.map((l) => `${l.time} ${l.level} ${l.msg}`).join("\n"));
    setCopied(tag);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="page">
      <GlassCard style={{ padding: 12 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div className="row" style={{ background: "var(--fill-2)", border: "1px solid var(--hairline)", borderRadius: "var(--r-sm)", padding: "0 12px", height: 34, flex: 1, minWidth: 200, maxWidth: 420 }}>
            <Search size={15} color="var(--t3)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选日志内容…" style={{ background: "transparent", border: "none", outline: "none", color: "var(--t1)", fontSize: 13, flex: 1, marginLeft: 8, fontFamily: "inherit" }} />
          </div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            {LEVELS.map((lv) => (
              <button key={lv.k} className={`btn btn-sm ${levels.has(lv.k) ? "btn-primary" : "btn-ghost"}`} onClick={() => toggleLevel(lv.k)}>
                {lv.label}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => { setMihomo([]); setBackend([]); }}>
              <Eraser size={13} /> 清空
            </button>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <CardHead
          icon={<Info size={18} color="var(--blue)" />}
          title="Mihomo 日志"
          sub="内核运行日志（实时）"
          right={
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <Pill tone="blue">{mFiltered.length}</Pill>
              <span className="row" style={{ gap: 6, fontSize: 12, color: "var(--green)" }}><span className="live-dot" /> Streaming</span>
              <button className="btn btn-ghost btn-sm" onClick={() => copyArea(mFiltered, "m")} disabled={mFiltered.length === 0}><Copy size={13} /> {copied === "m" ? "已复制" : "复制"}</button>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setMOpen((v) => !v)}>{mOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
            </div>
          }
        />
        {mOpen && <LogView lines={mFiltered} empty="等待内核日志…（mihomo 运行后实时输出）" />}
      </GlassCard>

      <GlassCard>
        <CardHead
          icon={<ScrollText size={18} color="var(--purple)" />}
          title="后端日志"
          sub="M-BOX daemon 自身日志（启动 / 进程治理 / 订阅更新 / 重载 / 错误）"
          right={
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <Pill tone="purple">{bFiltered.length}</Pill>
              <span className="row" style={{ gap: 6, fontSize: 12, color: "var(--green)" }}><span className="live-dot" /> Streaming</span>
              <button className="btn btn-ghost btn-sm" onClick={() => copyArea(bFiltered, "b")} disabled={bFiltered.length === 0}><Copy size={13} /> {copied === "b" ? "已复制" : "复制"}</button>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setBOpen((v) => !v)}>{bOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
            </div>
          }
        />
        {bOpen && <LogView lines={bFiltered} empty="暂无后端日志" />}
      </GlassCard>
    </div>
  );
}

function LogView({ lines, empty }: { lines: LogLine[]; empty: string }) {
  const color = (lvl: string) =>
    lvl === "error" ? "var(--red)" : lvl === "warning" ? "var(--orange)" : lvl === "debug" ? "var(--t3)" : "var(--teal)";
  return (
    <div style={{ padding: 14, borderRadius: "var(--r-md)", background: "rgba(0,0,0,0.28)", border: "1px solid var(--hairline)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.9, maxHeight: 360, overflowY: "auto" }}>
      {lines.length === 0 && <div className="muted-2">{empty}</div>}
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <span style={{ color: "var(--t4)", flexShrink: 0 }}>{l.time}</span>
          <span style={{ color: color(l.level), width: 56, flexShrink: 0 }}>{l.level}</span>
          <span style={{ color: "var(--t2)", wordBreak: "break-all" }}>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}
