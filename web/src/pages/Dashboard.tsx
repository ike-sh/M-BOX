import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  HardDrive,
  Layers,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  Wifi,
  Zap,
} from "lucide-react";
import { GlassCard, CardHead } from "../components/ui";
import { TrafficChart } from "../components/TrafficChart";
import { api } from "../lib/api";
import { speed, bytes, pct, cleanNodeName } from "../lib/format";
import { system as mockSystem } from "../mock/data";
import type { Connection, SystemInfo, TrafficPoint, TrafficStats } from "../types";

const outPalette = ["#0a84ff", "#bf5af2", "#40c8e0", "#ff9f0a", "#5e5ce6"];
function outboundColor(name: string, i: number): string {
  if (name === "DIRECT") return "#30d158";
  if (name === "REJECT" || name === "REJECT-DROP") return "#ff453a";
  return outPalette[i % outPalette.length];
}

const MODE_LABEL: Record<string, string> = { rule: "RULE", global: "GLOBAL", direct: "DIRECT" };
const MODE_SUB: Record<string, string> = { rule: "规则匹配模式", global: "全局代理模式", direct: "全局直连模式" };

export function Dashboard() {
  const [hist, setHist] = useState<TrafficPoint[]>([]);
  const [live, setLive] = useState({ up: 0, down: 0 });
  const [system, setSystem] = useState<SystemInfo>(mockSystem);
  const [conns, setConns] = useState<Connection[]>([]);
  const [stats, setStats] = useState<TrafficStats>({ hourly: [], daily: [] });
  const [mode, setMode] = useState("rule");
  const [net, setNet] = useState({ localIP: "", egressIP: "", lanIP: "" });
  const [localLoading, setLocalLoading] = useState(false);
  const [egressLoading, setEgressLoading] = useState(false);
  const [dnsStats, setDnsStats] = useState({ resolvedTotal: 0, fakeipActive: 0, domainActive: 0, directActive: 0, totalActive: 0 });

  useEffect(() => {
    let alive = true;
    api.getTrafficHistory().then((h) => alive && setHist(h));
    api.getMode().then((m) => alive && setMode((m.mode || "rule").toLowerCase()));
    return () => { alive = false; };
  }, []);

  // 本地 IP / 代理 IP 各自独立探测与刷新：点哪个只刷哪个、只转哪个按钮，互不拖累。
  const loadLocal = useCallback(() => {
    setLocalLoading(true);
    api.getNetInfo("local").then((n) => setNet((p) => ({ ...p, ...n }))).finally(() => setLocalLoading(false));
  }, []);
  const loadEgress = useCallback(() => {
    setEgressLoading(true);
    api.getNetInfo("egress").then((n) => setNet((p) => ({ ...p, ...n }))).finally(() => setEgressLoading(false));
  }, []);
  useEffect(() => { loadLocal(); loadEgress(); }, [loadLocal, loadEgress]);

  useEffect(() => {
    let alive = true;
    const load = () => api.getDnsStats().then((d) => alive && setDnsStats(d));
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => api.getTrafficStats().then((s) => alive && setStats(s));
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const off = api.subscribeTraffic((p) => {
      setLive(p);
      setHist((h) => {
        // ts 单调递增：避免客户端(本地 Date.now)与服务端历史点 ts 的时钟差导致时间轴回退。
        const prevTs = h.length ? h[h.length - 1].ts : 0;
        const ts = Math.max(Date.now(), prevTs + 1000);
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, "0");
        const point: TrafficPoint = {
          t: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
          ts,
          up: Math.round(p.up / 1024),
          down: Math.round(p.down / 1024),
        };
        return h.length === 0 ? [point] : [...h.slice(1), point];
      });
    });
    return off;
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.getSystem().then((s) => alive && setSystem(s));
      api.getConnections().then((c) => alive && setConns(c));
    };
    load();
    const id = setInterval(() => api.getConnections().then((c) => alive && setConns(c)), 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const dl = speed(live.down);
  const ul = speed(live.up);

  // 累计流量（今日）
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = stats.daily.find((b) => b.key === todayKey);
  const todayTotal = (today?.up ?? 0) + (today?.down ?? 0);

  // 出站分布（按活动连接出口聚合，供「分流统计」）
  const outboundDist = (() => {
    const tally = new Map<string, { count: number; bytes: number }>();
    for (const c of conns) {
      const exit = c.chain[0] || "—";
      const t = tally.get(exit) ?? { count: 0, bytes: 0 };
      t.count++;
      t.bytes += c.download;
      tally.set(exit, t);
    }
    return [...tally.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6).map(([name, v]) => ({ name, count: v.count, bytes: v.bytes }));
  })();
  const totalOut = outboundDist.reduce((s, o) => s + o.count, 0) || 1;

  // 流量分类：直连 vs 代理（按活动连接字节）
  let directBytes = 0, proxyBytes = 0, directConns = 0, proxyConns = 0;
  for (const c of conns) {
    const b = c.download + c.upload;
    if ((c.chain[0] || "") === "DIRECT") { directBytes += b; directConns++; }
    else { proxyBytes += b; proxyConns++; }
  }
  const splitSum = directBytes + proxyBytes;
  const directPct = splitSum ? Math.round((directBytes / splitSum) * 100) : 0;
  const proxyPct = splitSum ? 100 - directPct : 0;

  // 流量排行：按本次连接累计下载排序
  const topConns = [...conns].sort((a, b) => b.download - a.download).slice(0, 8);

  return (
    <div className="page">
      {/* 顶部 4 指标卡 */}
      <div className="grid cols-4">
        <BigStat
          icon={<BarChart3 size={20} />}
          color="linear-gradient(135deg,#0a84ff,#5e5ce6)"
          value={bytes(todayTotal)}
          label="今日总流量"
          sub={<>↑{bytes(today?.up ?? 0)}　↓{bytes(today?.down ?? 0)}</>}
        />
        <BigStat
          icon={<Network size={20} />}
          color="linear-gradient(135deg,#bf5af2,#ff375f)"
          value={String(conns.length)}
          label="活跃连接"
          bar={{ percent: Math.min(100, conns.length), color: "linear-gradient(90deg,#bf5af2,#ff375f)" }}
        />
        <BigStat
          icon={<MemoryStick size={20} />}
          color="linear-gradient(135deg,#30d158,#40c8e0)"
          value={String(Math.round(system.mem.used))}
          unit="MB"
          label="内存占用"
          bar={{ percent: pct(system.mem.used, system.mem.total), color: "linear-gradient(90deg,#30d158,#40c8e0)" }}
        />
        <BigStat
          icon={<Layers size={20} />}
          color="linear-gradient(135deg,#30d158,#16a34a)"
          value={MODE_LABEL[mode] ?? mode.toUpperCase()}
          label={MODE_SUB[mode] ?? "代理模式"}
        />
      </div>

      {/* 第二行(2x)：实时流量|系统信息 ／ 网络出口|分流统计（同网格→左右各列等高对齐） */}
      <div className="grid cols-3">
        <GlassCard className="span-2">
          <CardHead
            icon={<Zap size={18} color="var(--blue)" />}
            title="实时流量"
            sub="过去 40 秒 · 每秒采样"
            right={
              <div className="row gap-4">
                <span className="row" style={{ gap: 6, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#0a84ff" }} /> 下载
                  <b className="mono">{dl.val} {dl.unit}</b>
                </span>
                <span className="row" style={{ gap: 6, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "#bf5af2" }} /> 上传
                  <b className="mono">{ul.val} {ul.unit}</b>
                </span>
              </div>
            }
          />
          <TrafficChart data={hist} />
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Server size={18} color="var(--blue)" />} title="系统信息" />
          <div className="col" style={{ gap: 15 }}>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <div className="stat-ico" style={{ width: 38, height: 38, background: "linear-gradient(135deg,#5e5ce6,#bf5af2)", flexShrink: 0 }}>
                <Server size={18} />
              </div>
              <div className="col" style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{system.os || "—"}</span>
                <span className="muted-2" style={{ fontSize: 11.5 }}>{system.kernel}</span>
              </div>
            </div>
            <SysRow icon={<Cpu size={16} />} color="#0a84ff" label="CPU" value={`${system.cpu}%`} percent={system.cpu} />
            <SysRow icon={<MemoryStick size={16} />} color="#30d158" label="内存" value={`${system.mem.used} / ${system.mem.total} MB`} percent={pct(system.mem.used, system.mem.total)} />
            <SysRow icon={<HardDrive size={16} />} color="#ff9f0a" label="磁盘" value={`${system.disk.used} / ${system.disk.total} GB`} percent={pct(system.disk.used, system.disk.total)} />
            <SysKV icon={<Gauge size={16} />} color="linear-gradient(135deg,#bf5af2,#ff375f)" label="负载均值" value={system.loadavg.join("  ")} />
            <SysKV icon={<Clock size={16} />} color="linear-gradient(135deg,#40c8e0,#0a84ff)" label="运行时间" value={system.uptime} />
          </div>
        </GlassCard>

        <GlassCard className="span-2" style={{ display: "flex", flexDirection: "column" }}>
          <CardHead icon={<Wifi size={18} color="var(--blue)" />} title="网络出口" sub="本地直连 / 代理出口" />
          <div className="col" style={{ gap: 10, flex: 1, justifyContent: "center" }}>
            <IpRow icon={<Wifi size={16} />} color="#0a84ff" label="本地 IP" value={net.localIP || net.lanIP} loading={localLoading} onRefresh={loadLocal} />
            <IpRow icon={<Globe size={16} />} color="#bf5af2" label="代理 IP" value={net.egressIP} loading={egressLoading} onRefresh={loadEgress} />
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Activity size={18} color="var(--purple)" />} title="分流统计" sub="按当前活动连接的出口" />
          {outboundDist.length === 0 ? (
            <div className="empty"><BarChart3 size={26} /><p>暂无统计数据</p></div>
          ) : (
            <div className="col" style={{ gap: 16 }}>
              <div className="stack-bar">
                {outboundDist.map((o, i) => (
                  <span key={o.name} style={{ width: `${pct(o.count, totalOut)}%`, background: outboundColor(o.name, i) }} title={`${o.name}: ${o.count} 条`} />
                ))}
              </div>
              <div className="col" style={{ gap: 14 }}>
                {outboundDist.map((o, i) => (
                  <div className="col" style={{ gap: 7 }} key={o.name}>
                    <div className="row between">
                      <span className="row" style={{ gap: 8, minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: outboundColor(o.name, i), flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }} title={o.name}>{cleanNodeName(o.name)}</span>
                      </span>
                      <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{bytes(o.bytes)}</span>
                        <span className="mono muted-2" style={{ fontSize: 11 }}>{o.count} 条 · {pct(o.count, totalOut)}%</span>
                      </span>
                    </div>
                    <div className="bar"><span style={{ width: `${pct(o.count, totalOut)}%`, background: outboundColor(o.name, i) }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {/* 第三行：流量分类 | DNS解析 */}
      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<Activity size={18} color="var(--green)" />} title="流量分类" sub="直连 / 代理（活动连接）" />
          <div className="grid cols-2" style={{ gap: 12 }}>
            <SplitCard tone="#30d158" label="直连" percent={directPct} bytesVal={bytes(directBytes)} conns={directConns} />
            <SplitCard tone="#0a84ff" label="代理" percent={proxyPct} bytesVal={bytes(proxyBytes)} conns={proxyConns} />
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Globe size={18} color="var(--purple)" />} title="DNS 解析" sub="按活动连接派生" />
          <div className="grid cols-2" style={{ gap: 10 }}>
            <DnsStat tone="#bf5af2" label="累计解析域名" value={dnsStats.resolvedTotal} />
            <DnsStat tone="#0a84ff" label="活跃域名" value={dnsStats.domainActive} />
            <DnsStat tone="#30d158" label="fake-ip 解析" value={dnsStats.fakeipActive} />
            <DnsStat tone="#ff9f0a" label="直连 IP" value={dnsStats.directActive} />
          </div>
        </GlassCard>
      </div>

      {/* 流量排行：整行平铺拉满 */}
      <GlassCard>
        <CardHead
          icon={<BarChart3 size={18} color="var(--blue)" />}
          title="流量排行"
          sub="当前活动连接按累计下载排序"
          right={<a className="card-sub" href="#/connections" style={{ color: "var(--blue)", textDecoration: "none" }}>查看连接 <ArrowRight size={12} style={{ verticalAlign: "-1px" }} /></a>}
        />
        {topConns.length === 0 ? (
          <div className="empty"><Globe size={26} /><p>暂无流量数据</p></div>
        ) : (
          <table className="table">
            <tbody>
              {topConns.map((c) => {
                const sp = speed(c.dlSpeed);
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="col">
                        <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 480 }}>{c.host}</span>
                        <span className="muted-2 mono" style={{ fontSize: 11 }}>{cleanNodeName(c.chain[0] || "—")} · {c.type}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }} className="mono">{bytes(c.download)}</td>
                    <td className="mono muted-2" style={{ textAlign: "right", fontSize: 12 }}>{sp.val} {sp.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}

function BigStat({ icon, color, value, unit, label, bar, sub }: {
  icon: ReactNode; color: string; value: string; unit?: string; label: string;
  bar?: { percent: number; color: string }; sub?: ReactNode;
}) {
  return (
    <div className="glass" style={{ padding: 18, borderRadius: "var(--r-lg)" }}>
      <div className="row" style={{ gap: 14, alignItems: "center" }}>
        <div className="stat-ico" style={{ width: 46, height: 46, background: color, flexShrink: 0 }}>{icon}</div>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <div className="stat-value" style={{ fontSize: 25, lineHeight: 1.1 }}>
            {value}{unit && <span className="unit">{unit}</span>}
          </div>
          <span className="stat-label">{label}</span>
        </div>
      </div>
      {bar && <div className="bar" style={{ marginTop: 14 }}><span style={{ width: `${bar.percent}%`, background: bar.color }} /></div>}
      {sub && <div className="muted-2 mono" style={{ fontSize: 12, marginTop: 12 }}>{sub}</div>}
    </div>
  );
}

function SysRow({ icon, color, label, value, percent }: { icon: ReactNode; color: string; label: string; value: string; percent?: number }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: "center" }}>
      <div className="stat-ico" style={{ width: 36, height: 36, background: color, flexShrink: 0 }}>{icon}</div>
      <div className="col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <div className="row between">
          <span style={{ fontSize: 13, color: "var(--t2)" }}>{label}</span>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{value}</span>
        </div>
        {percent !== undefined && <div className="bar"><span style={{ width: `${percent}%`, background: color }} /></div>}
      </div>
    </div>
  );
}

function SysKV({ icon, color, label, value }: { icon: ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: "center" }}>
      <div className="stat-ico" style={{ width: 36, height: 36, background: color, flexShrink: 0 }}>{icon}</div>
      <div className="row between" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: "var(--t2)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{value}</span>
      </div>
    </div>
  );
}

function IpRow({ icon, color, label, value, loading, onRefresh }: { icon: ReactNode; color: string; label: string; value: string; loading: boolean; onRefresh: () => void }) {
  const [show, setShow] = useState(false);
  const masked = value ? value.replace(/[0-9a-fA-F]/g, "•") : "";
  return (
    <div className="row between" style={{ background: "var(--fill-2)", border: "1px solid var(--hairline)", borderRadius: "var(--r-sm)", padding: "10px 14px" }}>
      <span className="row" style={{ gap: 10, minWidth: 0 }}>
        <span style={{ color, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 13, color: "var(--t2)", flexShrink: 0 }}>{label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, letterSpacing: show ? "normal" : "0.5px", overflow: "hidden", textOverflow: "ellipsis" }}>
          {value ? (show ? value : masked) : "--"}
        </span>
      </span>
      <span className="row" style={{ gap: 4, flexShrink: 0 }}>
        <button className="icon-btn" style={{ width: 28, height: 28 }} title={show ? "隐藏" : "显示"} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button className="icon-btn" style={{ width: 28, height: 28 }} title="刷新" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </span>
    </div>
  );
}

function DnsStat({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <div className="col" style={{ gap: 4, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
      <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: tone }}>{value.toLocaleString()}</span>
      <span className="muted-2" style={{ fontSize: 11.5 }}>{label}</span>
    </div>
  );
}

function SplitCard({ tone, label, percent, bytesVal, conns }: { tone: string; label: string; percent: number; bytesVal: string; conns: number }) {
  return (
    <div className="col" style={{ gap: 8, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
      <div className="row between">
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: tone }}>{percent}%</span>
      </div>
      <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{bytesVal}</span>
      <div className="bar"><span style={{ width: `${percent}%`, background: tone }} /></div>
      <span className="muted-2" style={{ fontSize: 11 }}>{conns} 条连接</span>
    </div>
  );
}
