import { useEffect, useMemo, useState } from "react";
import { Search, X, Pause, Play } from "lucide-react";
import { GlassCard, CardHead, Pill, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { bytes, speed, relTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { Connection } from "../types";

type ConnView = "detail" | "process" | "host";
type ConnAgg = { key: string; connCount: number; dl: number; ul: number; total: number };

// aggregate 把连接按「进程」或「目标域名」聚合，按实时总速率降序。
function aggregate(conns: Connection[], by: "process" | "host"): ConnAgg[] {
  const m = new Map<string, ConnAgg>();
  for (const c of conns) {
    const key = (by === "process" ? c.process : c.host) || "—";
    let a = m.get(key);
    if (!a) {
      a = { key, connCount: 0, dl: 0, ul: 0, total: 0 };
      m.set(key, a);
    }
    a.connCount++;
    a.dl += c.dlSpeed;
    a.ul += c.ulSpeed;
    a.total += c.download + c.upload;
  }
  return [...m.values()].sort((x, y) => y.dl + y.ul - (x.dl + x.ul));
}

export function Connections() {
  const { t } = useI18n();
  const [conns, setConns] = useState<Connection[]>([]);
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<ConnView>("detail");

  useEffect(() => {
    let alive = true;
    const load = () => api.getConnections().then((c) => alive && setConns(c));
    load();
    if (paused) return () => { alive = false; }; // 暂停时只做一次刷新，不再轮询
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paused]);

  const filtered = useMemo(
    () => conns.filter((c) => !q || c.host.includes(q) || c.destIP.includes(q) || c.rule.includes(q)),
    [conns, q]
  );
  const agg = useMemo(
    () => (view === "detail" ? [] : aggregate(filtered, view)),
    [filtered, view]
  );

  function kill(id: string) {
    setConns((c) => c.filter((x) => x.id !== id)); // 乐观移除
    api.closeConnection(id);
  }

  return (
    <div className="page">
      <GlassCard>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div className="row gap-4 wrap">
            <SummaryChip label={t("活动连接", "Active Conns")} value={String(filtered.length)} />
          </div>
          <div className="row gap-2">
            <div className="row" style={{ background: "var(--fill-2)", border: "1px solid var(--hairline)", borderRadius: "var(--r-sm)", padding: "0 12px", height: 38 }}>
              <Search size={16} color="var(--t3)" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("搜索域名 / IP / 规则", "Search host / IP / rule")}
                style={{ background: "transparent", border: "none", outline: "none", color: "var(--t1)", fontSize: 13, width: 200, marginLeft: 8, fontFamily: "inherit" }}
              />
              {q && <X size={15} color="var(--t3)" style={{ cursor: "pointer" }} onClick={() => setQ("")} />}
            </div>
            <button className="icon-btn" onClick={() => setPaused((p) => !p)} aria-label={t("暂停刷新", "Pause refresh")} title={paused ? t("继续", "Resume") : t("暂停", "Pause")}>
              {paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
          </div>
        </div>
      </GlassCard>

      <GlassCard style={{ padding: "var(--sp-4) var(--sp-5)" }}>
        <CardHead
          title={t("实时连接", "Live Connections")}
          right={
            <div className="row gap-4" style={{ alignItems: "center" }}>
              <Segmented
                value={view}
                onChange={(v) => setView(v as ConnView)}
                options={[
                  { value: "detail", label: t("明细", "Detail") },
                  { value: "process", label: t("按进程", "By process") },
                  { value: "host", label: t("按域名", "By host") },
                ]}
              />
              <span className="row" style={{ gap: 6, fontSize: 12, color: "var(--t2)" }}>
                {!paused && <span className="live-dot" />}
                {paused ? t("已暂停", "Paused") : t("每 2 秒刷新", "Refreshing every 2s")}
              </span>
            </div>
          }
        />
        {view !== "detail" ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{view === "process" ? t("进程", "Process") : t("目标域名", "Host")}</th>
                  <th style={{ textAlign: "right" }}>{t("连接数", "Conns")}</th>
                  <th style={{ textAlign: "right" }}>↓ {t("速率", "Rate")}</th>
                  <th style={{ textAlign: "right" }}>↑ {t("速率", "Rate")}</th>
                  <th style={{ textAlign: "right" }}>{t("总流量", "Total")}</th>
                </tr>
              </thead>
              <tbody>
                {agg.map((a) => {
                  const ds = speed(a.dl);
                  const us = speed(a.ul);
                  return (
                    <tr key={a.key}>
                      <td style={{ fontWeight: 600 }}>{a.key}</td>
                      <td style={{ textAlign: "right" }} className="mono">{a.connCount}</td>
                      <td style={{ textAlign: "right" }} className="mono">{ds.val} {ds.unit}</td>
                      <td style={{ textAlign: "right" }} className="mono muted">{us.val} {us.unit}</td>
                      <td style={{ textAlign: "right" }} className="mono">{bytes(a.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {agg.length === 0 && (
              <div className="empty"><Search size={28} /><p>{t("没有匹配的连接", "No matching connections")}</p></div>
            )}
          </div>
        ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("目标主机", "Host")}</th>
                <th>{t("规则", "Rule")}</th>
                <th>{t("代理链路", "Chain")}</th>
                <th>{t("进程", "Process")}</th>
                <th style={{ textAlign: "right" }}>↓ {t("速率", "Rate")}</th>
                <th style={{ textAlign: "right" }}>↑ {t("速率", "Rate")}</th>
                <th style={{ textAlign: "right" }}>{t("总流量", "Total")}</th>
                <th style={{ textAlign: "right" }}>{t("时长", "Duration")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const ds = speed(c.dlSpeed);
                const us = speed(c.ulSpeed);
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="col">
                        <span style={{ fontWeight: 600 }}>{c.host}</span>
                        <span className="muted-2 mono" style={{ fontSize: 11 }}>{c.destIP}</span>
                      </div>
                    </td>
                    <td><span className="mono muted" style={{ fontSize: 11.5 }}>{c.rule}</span></td>
                    <td>
                      {/* mihomo chains[0] 为实际出口节点(最后一跳)，chains[末] 为入口策略组 */}
                      <span className="col" style={{ gap: 2 }}>
                        <Pill tone={c.chain[0] === "DIRECT" ? "green" : c.chain[0] === "REJECT" ? "red" : "blue"}>
                          {c.chain[0] ?? "—"}
                        </Pill>
                        {c.chain.length > 1 && (
                          <span className="muted-2" style={{ fontSize: 10.5 }} title={[...c.chain].reverse().join(" › ")}>
                            {c.chain[c.chain.length - 1]} › {c.chain[0]}
                          </span>
                        )}
                      </span>
                    </td>
                    <td><span className="muted" style={{ fontSize: 12 }}>{c.process}</span></td>
                    <td style={{ textAlign: "right" }} className="mono">{ds.val} {ds.unit}</td>
                    <td style={{ textAlign: "right" }} className="mono muted">{us.val} {us.unit}</td>
                    <td style={{ textAlign: "right" }} className="mono">{bytes(c.download + c.upload)}</td>
                    <td style={{ textAlign: "right" }} className="mono muted-2">{relTime(c.start)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => kill(c.id)} aria-label={t("断开", "Close")} title={t("断开连接", "Close connection")}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty">
              <Search size={28} />
              <p>{t("没有匹配的连接", "No matching connections")}</p>
            </div>
          )}
        </div>
        )}
      </GlassCard>
    </div>
  );
}

function SummaryChip({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 10, padding: "8px 14px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
      {icon}
      <div className="col">
        <span style={{ fontSize: 11, color: "var(--t3)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{value}</span>
      </div>
    </div>
  );
}
