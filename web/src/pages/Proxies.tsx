import { useEffect, useMemo, useState } from "react";
import { Globe, Gauge, Layers, Zap, Check, RotateCw, Plus, Loader2, CheckCircle2, AlertCircle, ArrowDownNarrowWide, Sparkles } from "lucide-react";
import { GlassCard, Pill, Segmented, Modal } from "../components/ui";
import { ManualProxyForm } from "../components/ManualProxyForm";
import { api } from "../lib/api";
import { latencyClass, cleanNodeName } from "../lib/format";
import type { ProxyGroup, ProxyNode } from "../types";

function Latency({ ms }: { ms: number }) {
  return (
    <span className={`latency ${latencyClass(ms)}`}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {ms < 0 ? "超时" : `${ms} ms`}
    </span>
  );
}

// RegionBadge 用纯文字徽标显示节点区域（如 US/JP/HK）。不用国旗 emoji——Windows
// 浏览器没有国旗字形，会退化成 "US"/"JP" 字母对，看起来像乱码。
function RegionBadge({ region }: { region: string }) {
  if (!region) return <span className="node-flag" aria-hidden>🌐</span>;
  return <span className="region-chip" title={region}>{region}</span>;
}

const groupTone = (t: string) =>
  t === "select" ? "blue" : t === "url-test" ? "green" : t === "fallback" ? "purple" : "orange";

export function Proxies() {
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const [rawGroups, setRawGroups] = useState<ProxyGroup[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [pickerName, setPickerName] = useState<string | null>(null); // 当前打开节点选择弹窗的策略组名
  const [sortByDelay, setSortByDelay] = useState(false);
  const [testing, setTesting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optMsg, setOptMsg] = useState<string | null>(null);
  const [testingNodes, setTestingNodes] = useState<Set<string>>(new Set()); // 单节点测速中的节点名
  const [importOpen, setImportOpen] = useState(false);
  const [addMode, setAddMode] = useState<"link" | "manual">("link");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: string[]; count: number; errors: string[] } | null>(null);

  function loadProxies() {
    api.getProxies().then(({ nodes, groups }) => {
      setNodes(nodes);
      setRawGroups(groups);
      setSelections(Object.fromEntries(groups.map((g) => [g.name, g.now])));
    });
  }
  useEffect(() => {
    loadProxies();
  }, []);

  // 自动测速：按「代理设置 → 网络设置」的测速间隔定时对全部节点测速（0=不自动）。
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    api.getGeneral().then((g) => {
      if (!alive || g.testInterval <= 0) return;
      timer = setInterval(async () => {
        const cur = await api.getProxies();
        const targets = cur.nodes.filter((n) => n.type !== "direct").map((n) => n.name);
        if (targets.length === 0) return;
        const map = await api.batchDelay(targets);
        setNodes((ns) => ns.map((n) => (n.name in map ? { ...n, delay: map[n.name] } : n)));
      }, g.testInterval * 1000);
    });
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  async function runImport() {
    const text = importText.trim();
    if (!text || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const r = await api.importProxies(text);
      setImportResult(r);
      if (r.count > 0) {
        setImportText("");
        setTimeout(loadProxies, 600); // 等内核重载后刷新节点列表
      }
    } finally {
      setImporting(false);
    }
  }

  const nodeMap = useMemo(() => {
    const m: Record<string, ProxyNode> = {};
    nodes.forEach((n) => (m[n.name] = n));
    return m;
  }, [nodes]);

  const online = nodes.filter((n) => n.delay > 0);
  const avg = online.length
    ? Math.round(online.reduce((s, n) => s + n.delay, 0) / online.length)
    : 0;

  async function pick(group: string, name: string) {
    const prev = selections[group];
    if (prev === name) return;
    setSelections((s) => ({ ...s, [group]: name })); // 乐观更新
    try {
      const r = (await api.selectProxy(group, name)) as { ok?: boolean };
      if (!r?.ok) throw new Error("select failed");
    } catch {
      setSelections((s) => ({ ...s, [group]: prev })); // 失败回滚
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      // 服务端批量并发测速（限并发），一次请求拿回全部结果。
      const targets = nodes.filter((n) => n.type !== "direct").map((n) => n.name);
      const map = await api.batchDelay(targets);
      setNodes((ns) => ns.map((n) => (n.name in map ? { ...n, delay: map[n.name] } : n)));
    } finally {
      setTesting(false);
    }
  }

  // 自动选优：对所有「手动选择(select)」策略组，按健康评分（多采样：延迟/抖动/丢包/倍率）
  // 为每个组选出其成员里得分最高的节点。url-test 等自动组由内核自己选，不在此处理。
  async function runOptimize() {
    if (optimizing) return;
    setOptimizing(true);
    setOptMsg(null);
    try {
      const selectGroups = rawGroups.filter((g) => g.type === "select");
      const memberSet = new Set<string>();
      for (const g of selectGroups) {
        for (const p of g.proxies) {
          const n = nodeMap[p];
          if (n && n.type !== "direct") memberSet.add(p);
        }
      }
      const names = [...memberSet];
      if (names.length === 0) {
        setOptMsg("没有可优化的手动策略组（select 组）");
        setTimeout(() => setOptMsg(null), 4000);
        return;
      }
      const results = await api.healthProxies(names);
      const scoreMap = new Map(results.map((r) => [r.name, r]));
      // 回填评分得到的延迟中位数到节点显示。
      setNodes((ns) => ns.map((n) => {
        const r = scoreMap.get(n.name);
        return r && r.median > 0 ? { ...n, delay: r.median } : n;
      }));
      let changed = 0;
      for (const g of selectGroups) {
        const best = g.proxies
          .filter((p) => (scoreMap.get(p)?.score ?? 0) > 0)
          .sort((a, b) => (scoreMap.get(b)!.score) - (scoreMap.get(a)!.score))[0];
        if (best && (selections[g.name] ?? g.now) !== best) {
          await api.selectProxy(g.name, best);
          changed++;
        }
      }
      loadProxies();
      setOptMsg(`已评估 ${names.length} 个节点，为 ${changed} 个策略组切换到最优节点`);
      setTimeout(() => setOptMsg(null), 5000);
    } catch (e) {
      setOptMsg(e instanceof Error ? e.message : "选优失败");
      setTimeout(() => setOptMsg(null), 5000);
    } finally {
      setOptimizing(false);
    }
  }

  // 单节点测速：点节点卡上的 ⚡ 仅测该节点，结果实时回填延迟。
  async function testOne(name: string) {
    if (testingNodes.has(name)) return;
    setTestingNodes((s) => new Set(s).add(name));
    try {
      const r = (await api.testProxy(name)) as { name: string; delay: number };
      setNodes((ns) => ns.map((n) => (n.name === name ? { ...n, delay: r.delay } : n)));
    } finally {
      setTestingNodes((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
    }
  }

  // 节点排序权重：在线按延迟升序，超时/失败其后，非节点项(DIRECT/策略组)最后。
  function delayRank(p: string): number {
    const n = nodeMap[p];
    if (!n) return 2e9;
    if (n.delay > 0) return n.delay;
    return 1e9;
  }

  function members(g: ProxyGroup): string[] {
    return g.proxies.filter((p) => p === "DIRECT" || p === "REJECT" || nodeMap[p] || rawGroups.some((x) => x.name === p));
  }

  // 节点选择弹窗：根据当前打开的组名解析出组与其成员（随刷新保持最新）。
  const picker = pickerName ? rawGroups.find((g) => g.name === pickerName) ?? null : null;
  const pickerSelectable = picker?.type === "select";
  const pickerMembers = picker ? members(picker) : [];
  const pickerNow = picker ? (selections[picker.name] ?? picker.now) : "";
  const pickerVisible = sortByDelay ? [...pickerMembers].sort((a, b) => delayRank(a) - delayRank(b)) : pickerMembers;

  return (
    <div className="page">
      {optMsg && (
        <div className="glass" style={{ padding: "10px 16px", borderRadius: "var(--r-md)", fontSize: 13, border: "1px solid var(--blue)", color: "var(--blue)" }}>{optMsg}</div>
      )}
      <div className="grid cols-4">
        <Mini icon={<Layers size={18} />} c="#0a84ff" label="策略组" value={String(rawGroups.length)} />
        <Mini icon={<Globe size={18} />} c="#30d158" label="节点总数" value={String(nodes.length)} />
        <Mini icon={<Gauge size={18} />} c="#ff9f0a" label="平均延迟" value={`${avg} ms`} />
        <div className="glass stat" style={{ justifyContent: "center", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setImportOpen((v) => !v)}>
            <Plus size={16} /> 添加节点
          </button>
          <button className="btn btn-ghost" onClick={runTest} disabled={testing || optimizing}>
            {testing ? <RotateCw size={16} className="spin" /> : <Zap size={16} />}
            {testing ? "测速中…" : "全部测速"}
          </button>
          <button className="btn btn-ghost" onClick={runOptimize} disabled={optimizing || testing} title="多次测速评分后，为每个手动策略组自动选出最优节点">
            {optimizing ? <RotateCw size={16} className="spin" /> : <Sparkles size={16} />}
            {optimizing ? "选优中…" : "自动选优"}
          </button>
          <button className="btn btn-ghost" onClick={() => setSortByDelay((s) => !s)} title="按延迟从低到高排序节点">
            <ArrowDownNarrowWide size={16} /> {sortByDelay ? "默认排序" : "按延迟排序"}
          </button>
        </div>
      </div>

      {importOpen && (
        <Modal
          title="添加节点"
          sub={addMode === "link" ? "粘贴分享链接批量导入" : "手动填写参数添加单个节点"}
          width={640}
          onClose={() => { setImportOpen(false); setImportResult(null); }}
          icon={<span className="stat-ico" style={{ width: 34, height: 34, background: "var(--accent-grad)" }}><Plus size={16} /></span>}
        >
          <div className="row" style={{ marginBottom: 14 }}>
            <Segmented
              value={addMode}
              onChange={(m) => { setAddMode(m); setImportResult(null); }}
              options={[
                { value: "link", label: "链接导入" },
                { value: "manual", label: "手动填写" },
              ]}
            />
          </div>

          {addMode === "manual" ? (
            <ManualProxyForm onAdded={() => setTimeout(loadProxies, 600)} />
          ) : (
          <>
          <span className="muted-2" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
            每行一条，支持 ss / ssr / vmess / vless / trojan / hysteria2 / hysteria / tuic / mieru / socks5 / http
          </span>
          <textarea
            className="input"
            style={{ height: 140, padding: 12, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7, resize: "vertical" }}
            placeholder={"vless://uuid@example.com:443?security=tls&type=ws&host=a.com&path=/ws#香港01\nss://YWVzLTI1Ni1nY206cGFzcw==@1.2.3.4:8388#日本节点\nvmess://eyJ2IjoiMiIsInBzIjoi..."}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="row between" style={{ marginTop: 12 }}>
            <span className="muted-2" style={{ fontSize: 12 }}>
              {importText.trim() ? `${importText.trim().split(/\r?\n/).filter((l) => l.trim()).length} 行待解析` : "也可直接粘贴 base64 订阅内容"}
            </span>
            <button className="btn btn-primary" onClick={runImport} disabled={importing || !importText.trim()} style={{ gap: 8 }}>
              {importing ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
              {importing ? "导入中…" : "解析并导入"}
            </button>
          </div>

          {importResult && (
            <div className="col gap-2" style={{ marginTop: 12, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
              <div className="row" style={{ gap: 8 }}>
                {importResult.count > 0
                  ? <CheckCircle2 size={16} color="var(--green)" />
                  : <AlertCircle size={16} color="var(--orange)" />}
                <span style={{ fontSize: 13, color: "var(--t1)" }}>
                  成功导入 <b>{importResult.count}</b> 个节点
                  {importResult.errors.length > 0 && <>，<span style={{ color: "var(--orange)" }}>{importResult.errors.length} 条失败</span></>}
                </span>
              </div>
              {importResult.added.length > 0 && (
                <div className="row wrap gap-2">
                  {importResult.added.map((n) => (
                    <span key={n} className="pill pill-green" style={{ height: 24 }}>{n}</span>
                  ))}
                </div>
              )}
              {importResult.errors.map((e, i) => (
                <span key={i} className="mono" style={{ fontSize: 11.5, color: "var(--orange)" }}>· {e}</span>
              ))}
            </div>
          )}
          </>
          )}
        </Modal>
      )}

      {rawGroups.length === 0 && (
        <GlassCard><span className="muted-2" style={{ fontSize: 13 }}>暂无策略组。请到「订阅管理」添加订阅，或在上方「添加节点」。</span></GlassCard>
      )}

      {/* 策略组：方块网格对齐；点方块弹窗选节点，点空白处关闭 */}
      <div className="grid group-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 12 }}>
        {rawGroups.map((g) => {
          const selectable = g.type === "select";
          const count = members(g).length;
          const nowName = selections[g.name] ?? g.now;
          const nowNode = nodeMap[nowName];
          return (
            <div
              key={g.name}
              className="group-tile"
              role="button"
              tabIndex={0}
              onClick={() => setPickerName(g.name)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPickerName(g.name); } }}
            >
              <div className="row between" style={{ gap: 8 }}>
                <span className="stat-ico" style={{ width: 28, height: 28, background: "var(--accent-grad)", flexShrink: 0 }}><Globe size={14} /></span>
                <Pill tone={groupTone(g.type) as any}>{g.type}</Pill>
              </div>
              <span className="group-tile-name" title={g.name}>{cleanNodeName(g.name)}</span>
              <div className="row between" style={{ gap: 6, minWidth: 0 }}>
                <span className="row" style={{ gap: 6, minWidth: 0 }}>
                  {nowNode ? <RegionBadge region={nowNode.region} /> : null}
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }} title={nowName}>
                    {nowName ? cleanNodeName(nowName) : "—"}
                  </span>
                </span>
                {nowNode && nowNode.delay > 0 && <Latency ms={nowNode.delay} />}
              </div>
              <span className="muted-2" style={{ fontSize: 11 }}>{count} 个出口 · {selectable ? "点击选择" : "自动选择"}</span>
            </div>
          );
        })}
      </div>

      {/* 节点选择弹窗：点空白处 / Esc 关闭 */}
      {picker && (
        <Modal
          title={picker.name}
          sub={pickerSelectable ? `${pickerMembers.length} 个出口 · 点击节点切换，点空白处关闭` : `${pickerMembers.length} 个出口 · url-test 由内核自动测速，仅供查看`}
          width={780}
          onClose={() => setPickerName(null)}
          icon={<span className="stat-ico" style={{ width: 34, height: 34, background: "var(--accent-grad)" }}><Globe size={16} /></span>}
        >
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10, maxHeight: "62vh", overflowY: "auto" }}>
            {pickerVisible.map((p) => {
              const n = nodeMap[p];
              const selected = pickerNow === p;
              return (
                <div
                  key={p}
                  className={`node-card ${selected ? "selected" : ""} ${pickerSelectable ? "" : "locked"}`}
                  onClick={pickerSelectable ? () => pick(picker.name, p) : undefined}
                  title={pickerSelectable ? `切换到 ${p}` : `${picker.type} 组由内核自动选择，不支持手动切换`}
                  style={pickerSelectable ? undefined : { cursor: "default" }}
                >
                  <div className="row between">
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      {n ? (
                        <RegionBadge region={n.region} />
                      ) : p === "DIRECT" ? (
                        <span className="node-flag" aria-hidden style={{ display: "inline-flex", justifyContent: "center", alignItems: "center" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
                        </span>
                      ) : (
                        <span className="node-flag" aria-hidden style={{ display: "inline-flex", color: "var(--t3)" }}><Layers size={14} /></span>
                      )}
                      <span style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p}>
                        {cleanNodeName(p)}
                      </span>
                    </span>
                    {selected && <Check size={16} color="var(--blue)" style={{ flexShrink: 0 }} />}
                  </div>
                  <div className="row between">
                    {n ? (
                      <>
                        <span className="muted-2 mono" style={{ fontSize: 11, textTransform: "uppercase" }}>
                          {n.type}{n.multiplier && n.multiplier !== 1 ? ` · ${n.multiplier}x` : ""}
                        </span>
                        {testing || testingNodes.has(p) ? (
                          <span className="latency muted-2"><RotateCw size={12} className="spin" /></span>
                        ) : (
                          <span className="row" style={{ gap: 4 }}>
                            <Latency ms={n.delay} />
                            <button
                              className="icon-btn"
                              style={{ width: 22, height: 22 }}
                              title="测速该节点"
                              onClick={(e) => { e.stopPropagation(); testOne(p); }}
                            >
                              <Zap size={12} />
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted-2" style={{ fontSize: 11.5 }}>{p === "DIRECT" ? "直接连接" : "策略组"}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Mini({ icon, c, label, value }: { icon: React.ReactNode; c: string; label: string; value: string }) {
  return (
    <div className="glass stat">
      <div className="stat-top">
        <div className="stat-ico" style={{ background: c }}>{icon}</div>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
