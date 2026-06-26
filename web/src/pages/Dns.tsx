import { useEffect, useRef, useState } from "react";
import { Waypoints, Shield, Globe2, Server, Ban, Plus, X, Split, ShieldAlert, Database, Trash2, Sparkles, FlaskConical, Network, Pin, ScrollText } from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, PromptDialog, Modal, FormField, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { dnsConfig } from "../mock/data";
import { useI18n } from "../lib/i18n";
import type { DnsConfig, DnsPolicyEntry, DnsHostEntry } from "../types";

type DnsListField = "nameservers" | "defaultNameservers" | "fakeIpFilter";

const ADD_META: Record<DnsListField, { title: string; label: string; placeholder: string; hint: string }> = {
  nameservers: { title: "新增国外上游", label: "DNS 上游地址", placeholder: "https://1.1.1.1/dns-query", hint: "建议填加密 DoH/DoT/DoQ，如 https:// tls:// quic://" },
  defaultNameservers: { title: "新增国内 / 引导上游", label: "DNS 上游地址", placeholder: "223.5.5.5", hint: "用于解析上游域名的引导 DNS，通常填国内明文 DNS" },
  fakeIpFilter: { title: "新增 fake-ip 过滤", label: "域名 / 通配符", placeholder: "*.lan", hint: "命中的域名走真实解析，不分配 fake-ip" },
};
const ADD_META_EN: Record<DnsListField, { title: string; label: string; hint: string }> = {
  nameservers: { title: "Add foreign upstream", label: "DNS upstream", hint: "Prefer encrypted DoH/DoT/DoQ, e.g. https:// tls:// quic://" },
  defaultNameservers: { title: "Add domestic / bootstrap upstream", label: "DNS upstream", hint: "Bootstrap DNS to resolve upstream domains; usually a plain domestic DNS" },
  fakeIpFilter: { title: "Add fake-ip filter", label: "Domain / wildcard", hint: "Matched domains use real resolution, not fake-ip" },
};

type FilterListField = "geosite" | "ipcidr" | "domain";

export function Dns() {
  const { t, lang } = useI18n();
  const [cfg, setCfg] = useState<DnsConfig>(dnsConfig);
  const [addCtx, setAddCtx] = useState<{ field: DnsListField; current: string[] } | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState({ domain: "", servers: "" });
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  // 通用「向列表追加一项」的弹窗上下文（fallback 上游 / 防污染过滤三类列表）。
  const [listAdd, setListAdd] = useState<
    { title: string; label: string; placeholder: string; hint?: string; current: string[]; apply: (next: string[]) => void } | null
  >(null);
  const [hostOpen, setHostOpen] = useState(false);
  const [hostForm, setHostForm] = useState({ domain: "", values: "" });
  const [hostErr, setHostErr] = useState<string | null>(null);
  const [preset, setPreset] = useState(false);
  // 切到 fake-ip 白名单（语义反转）前的二次确认。
  const [whitelistConfirm, setWhitelistConfirm] = useState(false);
  // DNS 解析自测。
  const [testName, setTestName] = useState("www.google.com");
  const [testType, setTestType] = useState("A");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  // 写操作反馈：成功/失败 toast（自动消失）。
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // DNS 查询日志（实时，按需开启）。
  const [dnsLogOn, setDnsLogOn] = useState(false);
  const [dnsLogs, setDnsLogs] = useState<string[]>([]);

  useEffect(() => {
    api.getDns().then(setCfg);
  }, []);

  // 订阅内核 debug 日志并过滤出 DNS 相关行；关闭/卸载时清理 WS。
  useEffect(() => {
    if (!dnsLogOn) return;
    setDnsLogs([]);
    const off = api.subscribeLogs((m) => {
      const p = m.payload || "";
      if (!/dns/i.test(p)) return;
      setDnsLogs((prev) => {
        const next = [...prev, p];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    }, "debug");
    return off;
  }, [dnsLogOn]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === "ok" ? 1800 : 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // DNS 写操作防抖：连续开关在 400ms 内合并成一次写盘 + 热重载，避免短时多次 mihomo reload。
  const pendingRef = useRef<Record<string, unknown>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flushDns() {
    flushTimer.current = null;
    const merged = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(merged).length === 0) return;
    api
      .applyDns(merged)
      .then(() => setToast({ kind: "ok", text: t("已保存并热重载", "Saved & hot-reloaded") }))
      .catch((e) => {
        setToast({ kind: "err", text: `${t("保存失败，已回滚：", "Save failed, rolled back: ")}${e instanceof Error ? e.message : t("请重试", "please retry")}` });
        api.getDns().then(setCfg); // 回滚到后端真实状态
      });
  }

  // applyDnsSafe 合并补丁后延迟写回后端（DNS 改动即热重载）。失败时回滚为后端真实配置并提示，
  // 避免「界面显示已改、内核仍是旧配置」的误导。
  function applyDnsSafe(p: Record<string, unknown>) {
    pendingRef.current = { ...pendingRef.current, ...p };
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushDns, 400);
  }

  // 卸载前把未提交的改动立即落盘，避免丢失最后一次操作。
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        const merged = pendingRef.current;
        if (Object.keys(merged).length > 0) api.applyDns(merged).catch(() => {});
      }
    };
  }, []);

  function patch(p: Partial<DnsConfig>) {
    setCfg((c) => ({ ...c, ...p }));
    applyDnsSafe(p as Record<string, unknown>);
  }

  function editList(field: DnsListField, items: string[]) {
    setCfg((c) => ({ ...c, [field]: items }));
    applyDnsSafe({ [field]: items });
  }
  function removeFrom(field: DnsListField, current: string[], v: string) {
    editList(field, current.filter((x) => x !== v));
  }

  // 本地乐观更新 + 写回后端（DNS 改动即热重载）。
  function applyPatch(local: Partial<DnsConfig>, patch: Record<string, unknown>) {
    setCfg((c) => ({ ...c, ...local }));
    applyDnsSafe(patch);
  }

  // 域名分流：nameserver-policy 与去广告条目需一起回写（后端合并），故总是带上 adBlock。
  function savePolicies(entries: DnsPolicyEntry[], adBlock = cfg.adBlock) {
    applyPatch({ nameserverPolicy: entries, adBlock }, { nameserverPolicy: entries, adBlock });
  }
  function addPolicy() {
    const domain = policyForm.domain.trim();
    const servers = policyForm.servers.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!domain) { setPolicyErr(t("请填写匹配域名/规则", "Please enter a domain/rule to match")); return; }
    if (servers.length === 0) { setPolicyErr(t("请至少填写一个上游 DNS", "Please enter at least one upstream DNS")); return; }
    if (cfg.nameserverPolicy.some((p) => p.domain === domain)) { setPolicyErr(t("该匹配项已存在", "This match already exists")); return; }
    savePolicies([...cfg.nameserverPolicy, { domain, servers }]);
    setPolicyOpen(false);
  }
  function removePolicy(domain: string) {
    savePolicies(cfg.nameserverPolicy.filter((p) => p.domain !== domain));
  }

  function setFallback(list: string[]) {
    applyPatch({ fallback: list }, { fallback: list });
  }
  function setFilter(patch: Partial<DnsConfig["fallbackFilter"]>) {
    const next = { ...cfg.fallbackFilter, ...patch };
    applyPatch({ fallbackFilter: next }, { fallbackFilter: next });
  }
  function removeFilterItem(field: FilterListField, v: string) {
    setFilter({ [field]: cfg.fallbackFilter[field].filter((x) => x !== v) } as Partial<DnsConfig["fallbackFilter"]>);
  }

  // 高级解析：代理节点专用 / 直连专用上游列表。
  type StrListField = "proxyServerNameserver" | "directNameserver";
  function setStrList(field: StrListField, list: string[]) {
    applyPatch({ [field]: list } as Partial<DnsConfig>, { [field]: list });
  }

  // 自定义 hosts。
  function saveHosts(hosts: DnsHostEntry[]) {
    applyPatch({ hosts }, { hosts });
  }
  function addHost() {
    const domain = hostForm.domain.trim();
    const values = hostForm.values.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!domain) { setHostErr(t("请填写域名", "Please enter a domain")); return; }
    if (values.length === 0) { setHostErr(t("请至少填写一个 IP / CNAME", "Please enter at least one IP / CNAME")); return; }
    if (cfg.hosts.some((h) => h.domain === domain)) { setHostErr(t("该域名已存在", "This domain already exists")); return; }
    saveHosts([...cfg.hosts, { domain, values }]);
    setHostOpen(false);
  }
  function removeHost(domain: string) {
    saveHosts(cfg.hosts.filter((h) => h.domain !== domain));
  }

  // 一键推荐预设：国内直连 + 国外防污染 + 去广告 + 代理节点专用解析 + respect-rules。
  function applyRecommended() {
    setPreset(false);
    const next: Partial<DnsConfig> = {
      enable: true,
      enhancedMode: "fake-ip",
      ipv6: false,
      defaultNameservers: ["223.5.5.5", "119.29.29.29"],
      nameservers: ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"],
      proxyServerNameserver: ["https://223.5.5.5/dns-query"],
      nameserverPolicy: [
        { domain: "geosite:cn", servers: ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"] },
        { domain: "geosite:geolocation-!cn", servers: ["https://1.1.1.1/dns-query", "https://dns.google/dns-query"] },
      ],
      // 防污染以 nameserver-policy 域名分流为主（国外走加密 DoH），不叠加冗余 fallback。
      fallback: [],
      fallbackFilter: { geoip: false, geoipCode: "CN", geosite: [], ipcidr: [], domain: [] },
      fakeIpFilter: ["*.lan", "*.local", "+.market.xiaomi.com", "+.qq.com", "time.*.com", "+.pool.ntp.org"],
      fakeIpFilterMode: "blacklist",
      cacheAlgorithm: "arc",
      respectRules: false,
      adBlock: true,
    };
    setCfg((c) => ({ ...c, ...next }));
    applyDnsSafe(next as Record<string, unknown>);
  }

  // 解析自测。
  async function runTest() {
    const name = testName.trim();
    if (!name) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.queryDns(name, testType);
      const answers = r.Answer ?? [];
      if (answers.length === 0) {
        setTestResult({ ok: false, lines: [t(`无应答（status=${r.Status ?? "?"}），可能被拦截或域名不存在`, `No answer (status=${r.Status ?? "?"}); may be blocked or the domain doesn't exist`)] });
      } else {
        setTestResult({ ok: true, lines: answers.map((a) => `${a.data}   (TTL ${a.TTL}s)`) });
      }
    } catch (e) {
      setTestResult({ ok: false, lines: [t("解析失败：内核未运行或 DNS 未启用", "Resolve failed: kernel not running or DNS disabled")] });
    } finally {
      setTesting(false);
    }
  }

  // 统计加密上游（DoH/DoT/DoQ）数量，用于「防泄漏状态」真实回显。
  const encryptedUpstreams = (cfg.nameservers ?? []).filter((n) =>
    /^(https|tls|quic):\/\//i.test(n) || n.startsWith("https://") || n.startsWith("tls://") || n.startsWith("quic://")
  ).length;

  return (
    <div className="page">
      {toast && (
        <div
          className="glass"
          style={{
            padding: "10px 16px",
            borderRadius: "var(--r-md)",
            fontSize: 13,
            border: `1px solid ${toast.kind === "err" ? "var(--red)" : "var(--green)"}`,
            color: toast.kind === "err" ? "var(--red)" : "var(--green)",
          }}
        >
          {toast.text}
        </div>
      )}
      <div className="row between" style={{ marginBottom: 2 }}>
        <div className="col" style={{ gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)" }}>{t("DNS 解析", "DNS Resolution")}</span>
          <span className="muted-2" style={{ fontSize: 12 }}>{t("域名分流 · 防污染 · 去广告 · 缓存（吸收 MosDNS 思路，基于 mihomo 原生引擎）", "Domain routing · anti-pollution · ad-block · cache (MosDNS-inspired, on mihomo's native engine)")}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setPreset(true)}><Sparkles size={15} /> {t("一键推荐预设", "Recommended preset")}</button>
      </div>

      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<Waypoints size={18} color="var(--blue)" />} title={t("DNS 服务", "DNS Service")} sub={t("拦截 53 端口，统一加密解析", "Hijack port 53, unified encrypted resolution")} />
          <div className="col">
            <Row label={t("启用 DNS", "Enable DNS")} desc={t("劫持局域网 DNS 查询", "Hijack LAN DNS queries")}>
              <Switch on={cfg.enable} onChange={(v) => patch({ enable: v })} />
            </Row>
            <Row label={t("解析模式", "Mode")} desc={t("fake-ip 可根治污染与泄漏", "fake-ip eliminates pollution & leaks")}>
              <Segmented
                value={cfg.enhancedMode}
                onChange={(v) => patch({ enhancedMode: v })}
                options={[
                  { value: "fake-ip", label: "fake-ip" },
                  { value: "redir-host", label: "redir-host" },
                ]}
              />
            </Row>
            <Row label={t("fake-ip 网段", "fake-ip range")}>
              <span className="mono v">{cfg.fakeIpRange}</span>
            </Row>
            <Row label={t("监听地址", "Listen")}>
              <span className="mono v">{cfg.listen}</span>
            </Row>
            <Row label={t("IPv6 解析", "IPv6 resolution")} desc={t("MVP 建议关闭，避免半开泄漏", "Keep off to avoid half-open leaks")}>
              <Switch on={cfg.ipv6} onChange={(v) => patch({ ipv6: v })} />
            </Row>
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Shield size={18} color="var(--green)" />} title={t("防泄漏状态", "Leak Protection")} sub={t("出口 DNS 健康检查", "Egress DNS health check")} />
          <div className="col">
            <Row label={t("解析模式", "Mode")}>
              {cfg.enhancedMode === "fake-ip"
                ? <Pill tone="green" dot>{t("fake-ip（防污染）", "fake-ip (anti-pollution)")}</Pill>
                : <Pill tone="orange" dot>{cfg.enhancedMode}</Pill>}
            </Row>
            <Row label={t("加密上游 (DoH/DoT)", "Encrypted upstream (DoH/DoT)")}>
              {encryptedUpstreams > 0
                ? <Pill tone="green" dot>{encryptedUpstreams} {t("个可用", "available")}</Pill>
                : <Pill tone="orange" dot>{t("未配置加密上游", "None configured")}</Pill>}
            </Row>
            <Row label={t("IPv6 解析", "IPv6 resolution")}>
              {cfg.ipv6 ? <Pill tone="orange" dot>{t("已开启（注意半开泄漏）", "On (watch half-open leaks)")}</Pill> : <Pill tone="green" dot>{t("已关闭", "Off")}</Pill>}
            </Row>
            <Row label={t("环路保护", "Loop protection")}><Pill tone="green" dot>proxy-server-nameserver</Pill></Row>
            <div style={{ marginTop: 8, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6 }}>
              {t("代理节点域名通过 ", "Proxy node domains are resolved separately via ")}<span className="mono" style={{ color: "var(--t1)" }}>proxy-server-nameserver</span>{t(" 单独解析，避免 DNS 环路。", " to avoid DNS loops.")}
            </div>
          </div>
        </GlassCard>
      </div>

      <div className="grid cols-3">
        <ChipCard icon={<Globe2 size={16} color="var(--blue)" />} title={t("国外上游（加密）", "Foreign upstream (encrypted)")} items={cfg.nameservers} tone="blue"
          onAdd={() => setAddCtx({ field: "nameservers", current: cfg.nameservers })} onRemove={(v) => removeFrom("nameservers", cfg.nameservers, v)} />
        <ChipCard icon={<Server size={16} color="var(--green)" />} title={t("国内 / 引导上游", "Domestic / bootstrap")} items={cfg.defaultNameservers} tone="green"
          onAdd={() => setAddCtx({ field: "defaultNameservers", current: cfg.defaultNameservers })} onRemove={(v) => removeFrom("defaultNameservers", cfg.defaultNameservers, v)} />
        <ChipCard icon={<Ban size={16} color="var(--orange)" />} title={t("fake-ip 过滤（直连解析）", "fake-ip filter (real resolve)")} items={cfg.fakeIpFilter} tone="orange"
          onAdd={() => setAddCtx({ field: "fakeIpFilter", current: cfg.fakeIpFilter })} onRemove={(v) => removeFrom("fakeIpFilter", cfg.fakeIpFilter, v)} />
      </div>

      {/* 域名分流（nameserver-policy）—— 借鉴 MosDNS 的 domain_set 转发 */}
      <GlassCard>
        <CardHead
          icon={<Split size={18} color="var(--purple)" />}
          title={t("域名分流（nameserver-policy）", "Domain routing (nameserver-policy)")}
          sub={t("指定域名/geosite/rule-set 走专属上游，优先级高于通用上游", "Route specific domains/geosite/rule-set to dedicated upstreams (higher priority)")}
          right={<button className="btn btn-ghost btn-sm" onClick={() => { setPolicyForm({ domain: "", servers: "" }); setPolicyErr(null); setPolicyOpen(true); }}><Plus size={13} /> {t("添加分流", "Add policy")}</button>}
        />
        <div className="col gap-2">
          {cfg.nameserverPolicy.map((p) => (
            <div key={p.domain} className="row between" style={{ padding: "10px 14px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", gap: 12 }}>
              <div className="col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.domain}</span>
                <span className="mono muted-2" style={{ fontSize: 11, wordBreak: "break-all" }}>{p.servers.join("  ·  ")}</span>
              </div>
              <button className="icon-btn" style={{ width: 28, height: 28, flexShrink: 0 }} title={t("删除分流", "Delete policy")} onClick={() => removePolicy(p.domain)}><Trash2 size={14} /></button>
            </div>
          ))}
          {cfg.nameserverPolicy.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（暂无分流，常用：geosite:cn → 国内 DNS）", "(No policy yet; common: geosite:cn → domestic DNS)")}</span>}
        </div>
      </GlassCard>

      {/* 防污染 fallback + fallback-filter —— 借鉴 MosDNS 的 fallback / IP 结果过滤 */}
      <GlassCard>
        <CardHead icon={<ShieldAlert size={18} color="var(--orange)" />} title={t("防污染回退（fallback）", "Anti-pollution fallback")} sub={t("污染结果自动改用加密 fallback 上游", "Polluted results fall back to encrypted upstreams")} />
        <div className="grid cols-2" style={{ gap: 18 }}>
          <div className="col gap-2">
            <div className="row between">
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("fallback 上游（加密）", "fallback upstream (encrypted)")}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setListAdd({ title: t("新增 fallback 上游", "Add fallback upstream"), label: t("加密 DNS 上游", "Encrypted DNS upstream"), placeholder: "tls://8.8.4.4", hint: t("建议 DoT/DoH/DoQ", "Prefer DoT/DoH/DoQ"), current: cfg.fallback, apply: setFallback })}><Plus size={13} /> {t("添加", "Add")}</button>
            </div>
            <div className="row wrap gap-2">
              {cfg.fallback.map((f) => (
                <span key={f} className="pill pill-blue mono" style={{ height: 26, gap: 6 }}>{f}<X size={12} style={{ cursor: "pointer" }} onClick={() => setFallback(cfg.fallback.filter((x) => x !== f))} /></span>
              ))}
              {cfg.fallback.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（空）", "(empty)")}</span>}
            </div>
          </div>
          <div className="col gap-2">
            <Row label={t("GeoIP 过滤", "GeoIP filter")} desc={t("解析到非 CN 的结果视为污染", "Treat non-CN results as polluted")}>
              <Switch on={cfg.fallbackFilter.geoip} onChange={(v) => setFilter({ geoip: v })} />
            </Row>
            <Row label={t("GeoIP 国家码", "GeoIP country code")}>
              <span className="mono v">{cfg.fallbackFilter.geoipCode || "CN"}</span>
            </Row>
          </div>
        </div>
        <div className="grid cols-3" style={{ gap: 12, marginTop: 4 }}>
          <FilterChips label={t("geosite（强制走 fallback）", "geosite (force fallback)")} tone="purple" items={cfg.fallbackFilter.geosite}
            onAdd={() => setListAdd({ title: t("新增 geosite", "Add geosite"), label: t("geosite 分类", "geosite category"), placeholder: "gfw", current: cfg.fallbackFilter.geosite, apply: (n) => setFilter({ geosite: n }) })}
            onRemove={(v) => removeFilterItem("geosite", v)} />
          <FilterChips label={t("ipcidr（命中视为污染）", "ipcidr (hit = polluted)")} tone="orange" items={cfg.fallbackFilter.ipcidr}
            onAdd={() => setListAdd({ title: t("新增 ipcidr", "Add ipcidr"), label: t("IP 网段", "IP CIDR"), placeholder: "240.0.0.0/4", current: cfg.fallbackFilter.ipcidr, apply: (n) => setFilter({ ipcidr: n }) })}
            onRemove={(v) => removeFilterItem("ipcidr", v)} />
          <FilterChips label={t("domain（强制走 fallback）", "domain (force fallback)")} tone="blue" items={cfg.fallbackFilter.domain}
            onAdd={() => setListAdd({ title: t("新增 domain", "Add domain"), label: t("域名表达式", "Domain expression"), placeholder: "+.google.com", current: cfg.fallbackFilter.domain, apply: (n) => setFilter({ domain: n }) })}
            onRemove={(v) => removeFilterItem("domain", v)} />
        </div>
      </GlassCard>

      {/* 去广告 + 缓存 + respect-rules */}
      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<Ban size={18} color="var(--red)" />} title={t("DNS 去广告", "DNS Ad-block")} sub={t("geosite 广告域名解析直接拦截（rcode）", "Block geosite ad domains at resolution (rcode)")} />
          <div className="col">
            <Row label={t("启用 DNS 去广告", "Enable DNS ad-block")} desc={t("拦截 geosite:category-ads-all", "Block geosite:category-ads-all")}>
              <Switch on={cfg.adBlock} onChange={(v) => { setCfg((c) => ({ ...c, adBlock: v })); savePolicies(cfg.nameserverPolicy, v); }} />
            </Row>
            <Row label="respect-rules" desc={t("DNS 查询遵循分流规则", "DNS queries follow routing rules")}>
              <Switch on={cfg.respectRules} onChange={(v) => applyPatch({ respectRules: v }, { respectRules: v })} />
            </Row>
            {cfg.respectRules && (
              <div style={{ padding: "8px 12px", borderRadius: "var(--r-xs)", background: "rgba(255,159,10,0.1)", color: "var(--orange)", fontSize: 11.5, lineHeight: 1.6 }}>
                ⚠️ {t("respect-rules 已开启：DNS 走分流规则，与 fake-ip / fallback 有交互。请确保有可用直连上游与代理出口，否则可能整体解析失败。", "respect-rules is on: DNS follows routing rules and interacts with fake-ip / fallback. Ensure a working direct upstream and proxy egress, or resolution may fail entirely.")}
              </div>
            )}
          </div>
        </GlassCard>
        <GlassCard>
          <CardHead icon={<Database size={18} color="var(--teal)" />} title={t("DNS 缓存", "DNS Cache")} sub={t("解析结果本地缓存，加速二次解析", "Cache results locally to speed up repeat lookups")} />
          <div className="col">
            <Row label={t("缓存算法", "Cache algorithm")} desc={t("arc 在突发访问下表现更好", "arc performs better under bursty access")}>
              <Segmented
                value={cfg.cacheAlgorithm}
                onChange={(v) => applyPatch({ cacheAlgorithm: v }, { cacheAlgorithm: v })}
                options={[
                  { value: "lru", label: "lru" },
                  { value: "arc", label: "arc" },
                ]}
              />
            </Row>
          </div>
        </GlassCard>
      </div>

      {/* 专用解析（防环路 / 直连优化）—— proxy-server-nameserver + direct-nameserver */}
      <GlassCard>
        <CardHead icon={<Network size={18} color="var(--blue)" />} title={t("专用解析（防环路 / 直连优化）", "Dedicated resolvers (anti-loop / direct)")} sub={t("代理节点域名、直连流量各用独立上游，避免 DNS 环路与污染", "Separate upstreams for proxy node domains and direct traffic to avoid DNS loops & pollution")} />
        <div className="grid cols-2" style={{ gap: 18 }}>
          <div className="col gap-2">
            <div className="row between">
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("代理节点专用上游", "Proxy-node upstream")}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setListAdd({ title: t("新增代理节点专用上游", "Add proxy-node upstream"), label: t("DNS 上游地址", "DNS upstream"), placeholder: "https://223.5.5.5/dns-query", hint: t("解析代理节点域名，必须用国内可直连上游，否则环路", "Resolves proxy node domains; must be a directly-reachable upstream or it loops"), current: cfg.proxyServerNameserver, apply: (n) => setStrList("proxyServerNameserver", n) })}><Plus size={13} /> {t("添加", "Add")}</button>
            </div>
            <div className="row wrap gap-2">
              {cfg.proxyServerNameserver.map((s) => (
                <span key={s} className="pill pill-blue mono" style={{ height: 26, gap: 6 }}>{s}<X size={12} style={{ cursor: "pointer" }} onClick={() => setStrList("proxyServerNameserver", cfg.proxyServerNameserver.filter((x) => x !== s))} /></span>
              ))}
              {cfg.proxyServerNameserver.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（空，建议填国内明文/DoH）", "(empty; use a domestic plain/DoH)")}</span>}
            </div>
          </div>
          <div className="col gap-2">
            <div className="row between">
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("直连专用上游", "Direct upstream")}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setListAdd({ title: t("新增直连专用上游", "Add direct upstream"), label: t("DNS 上游地址", "DNS upstream"), placeholder: "223.5.5.5", hint: t("直连流量的解析上游，通常填国内 DNS", "Upstream for direct traffic; usually a domestic DNS"), current: cfg.directNameserver, apply: (n) => setStrList("directNameserver", n) })}><Plus size={13} /> {t("添加", "Add")}</button>
            </div>
            <div className="row wrap gap-2">
              {cfg.directNameserver.map((s) => (
                <span key={s} className="pill pill-green mono" style={{ height: 26, gap: 6 }}>{s}<X size={12} style={{ cursor: "pointer" }} onClick={() => setStrList("directNameserver", cfg.directNameserver.filter((x) => x !== s))} /></span>
              ))}
              {cfg.directNameserver.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（空）", "(empty)")}</span>}
            </div>
            <Row label={t("direct 跟随分流策略", "direct follows routing")} desc="direct-nameserver-follow-policy">
              <Switch on={cfg.directNameserverFollowRule} onChange={(v) => applyPatch({ directNameserverFollowRule: v }, { directNameserverFollowRule: v })} />
            </Row>
          </div>
        </div>
      </GlassCard>

      {/* 自定义 Hosts —— 域名固定解析，优先级最高 */}
      <GlassCard>
        <CardHead
          icon={<Pin size={18} color="var(--teal)" />}
          title={t("自定义 Hosts", "Custom Hosts")}
          sub={t("把域名固定解析到指定 IP / CNAME，优先级高于一切上游", "Pin domains to fixed IP / CNAME, higher priority than any upstream")}
          right={<button className="btn btn-ghost btn-sm" onClick={() => { setHostForm({ domain: "", values: "" }); setHostErr(null); setHostOpen(true); }}><Plus size={13} /> {t("添加记录", "Add record")}</button>}
        />
        <div className="grid cols-2" style={{ gap: 18, marginBottom: 12 }}>
          <Row label={t("启用 hosts", "Enable hosts")} desc={t("使下方自定义记录生效", "Apply the custom records below")}>
            <Switch on={cfg.useHosts} onChange={(v) => applyPatch({ useHosts: v }, { useHosts: v })} />
          </Row>
          <Row label={t("使用系统 hosts", "Use system hosts")} desc={t("叠加读取系统 hosts 文件", "Also read the system hosts file")}>
            <Switch on={cfg.useSystemHosts} onChange={(v) => applyPatch({ useSystemHosts: v }, { useSystemHosts: v })} />
          </Row>
        </div>
        <div className="col gap-2">
          {cfg.hosts.map((h) => (
            <div key={h.domain} className="row between" style={{ padding: "10px 14px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", gap: 12 }}>
              <div className="col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{h.domain}</span>
                <span className="mono muted-2" style={{ fontSize: 11, wordBreak: "break-all" }}>{h.values.join("  ·  ")}</span>
              </div>
              <button className="icon-btn" style={{ width: 28, height: 28, flexShrink: 0 }} title={t("删除记录", "Delete record")} onClick={() => removeHost(h.domain)}><Trash2 size={14} /></button>
            </div>
          ))}
          {cfg.hosts.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（暂无自定义 hosts，例：dns.google → 8.8.8.8）", "(No custom hosts yet, e.g. dns.google → 8.8.8.8)")}</span>}
        </div>
      </GlassCard>

      {/* 高级选项 + 解析自测 */}
      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<ShieldAlert size={18} color="var(--orange)" />} title={t("解析高级选项", "Advanced options")} sub={t("fake-ip 过滤模式 / DoH HTTP-3", "fake-ip filter mode / DoH HTTP-3")} />
          <div className="col">
            <Row label={t("fake-ip 过滤模式", "fake-ip filter mode")} desc={t("黑名单：仅过滤列表内域名；白名单：仅列表内走真实解析", "Blacklist: only filter listed domains; Whitelist: only listed domains use real resolution")}>
              <Segmented
                value={cfg.fakeIpFilterMode}
                onChange={(v) => {
                  // 白名单语义与黑名单相反，切换前二次确认，避免误操作让代理分流整体失效。
                  if (v === "whitelist" && cfg.fakeIpFilterMode !== "whitelist") {
                    setWhitelistConfirm(true);
                  } else {
                    applyPatch({ fakeIpFilterMode: v as DnsConfig["fakeIpFilterMode"] }, { fakeIpFilterMode: v });
                  }
                }}
                options={[
                  { value: "blacklist", label: t("黑名单", "Blacklist") },
                  { value: "whitelist", label: t("白名单", "Whitelist") },
                ]}
              />
            </Row>
            <Row label="prefer-h3" desc={t("DoH 优先使用 HTTP/3，弱网下更快", "DoH prefers HTTP/3, faster on weak links")}>
              <Switch on={cfg.preferH3} onChange={(v) => applyPatch({ preferH3: v }, { preferH3: v })} />
            </Row>
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<FlaskConical size={18} color="var(--purple)" />} title={t("解析自测", "Resolve Test")} sub={t("实时调用内核解析，验证分流 / 防污染是否生效", "Live kernel resolution to verify routing / anti-pollution")} />
          <div className="col gap-2">
            <div className="row gap-2" style={{ alignItems: "stretch" }}>
              <input
                className="input"
                style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                placeholder="www.google.com"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runTest(); }}
              />
              <Segmented
                value={testType}
                onChange={setTestType}
                options={[
                  { value: "A", label: "A" },
                  { value: "AAAA", label: "AAAA" },
                ]}
              />
              <button className="btn btn-primary" disabled={testing} onClick={runTest} style={{ flexShrink: 0 }}>
                {testing ? t("解析中…", "Resolving…") : t("解析", "Resolve")}
              </button>
            </div>
            {testResult && (
              <div style={{ padding: 12, borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: `1px solid ${testResult.ok ? "var(--green)" : "var(--orange)"}`, fontSize: 12.5, color: "var(--t1)" }}>
                <div className="row" style={{ gap: 8, marginBottom: testResult.lines.length ? 8 : 0 }}>
                  <Pill tone={testResult.ok ? "green" : "orange"} dot>{testResult.ok ? t("解析成功", "Resolved") : t("无有效应答", "No valid answer")}</Pill>
                </div>
                <div className="col" style={{ gap: 4 }}>
                  {testResult.lines.map((l, i) => (
                    <span key={i} className="mono" style={{ fontSize: 12, color: testResult.ok ? "var(--t1)" : "var(--t2)" }}>{l}</span>
                  ))}
                </div>
              </div>
            )}
            {!testResult && <span className="muted-2" style={{ fontSize: 11.5 }}>{t("需内核运行且 DNS 已启用。可分别测国内/国外域名核对走对了上游。", "Requires the kernel running with DNS enabled. Test domestic/foreign domains to verify the right upstream.")}</span>}
          </div>
        </GlassCard>
      </div>

      {/* DNS 查询日志（实时）—— 订阅内核 debug 日志并过滤 DNS 行 */}
      <GlassCard>
        <CardHead
          icon={<ScrollText size={18} color="var(--purple)" />}
          title={t("DNS 查询日志（实时）", "DNS Query Log (live)")}
          sub={t("订阅内核 debug 日志并过滤 DNS 解析，便于排查分流/污染（调试日志量较大，建议按需开启）", "Subscribes to kernel debug logs filtered for DNS, to debug routing/pollution (high volume; enable on demand)")}
          right={<Switch on={dnsLogOn} onChange={setDnsLogOn} />}
        />
        {dnsLogOn ? (
          dnsLogs.length === 0 ? (
            <span className="muted-2" style={{ fontSize: 12 }}>{t("正在监听 DNS 日志…（需内核运行并有解析活动）", "Listening for DNS logs… (needs the kernel running with resolution activity)")}</span>
          ) : (
            <div
              className="col"
              style={{ gap: 2, maxHeight: 300, overflowY: "auto", padding: 12, borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}
            >
              {dnsLogs.map((l, i) => (
                <span key={i} className="mono" style={{ fontSize: 11.5, color: "var(--t2)", wordBreak: "break-all" }}>{l}</span>
              ))}
            </div>
          )
        ) : (
          <span className="muted-2" style={{ fontSize: 12 }}>{t("打开开关后实时显示 DNS 查询日志（基于 mihomo debug 日志过滤）。", "Turn on to see live DNS query logs (filtered from mihomo debug logs).")}</span>
        )}
      </GlassCard>

      {preset && (
        <Modal
          title={t("应用推荐 DNS 预设", "Apply Recommended DNS Preset")}
          sub={t("一键生成 MosDNS 式分流方案（基于 mihomo 原生能力）", "One-click MosDNS-style routing (on mihomo's native engine)")}
          width={520}
          onClose={() => setPreset(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}><Sparkles size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setPreset(false)}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={applyRecommended}><Sparkles size={15} /> {t("应用预设", "Apply preset")}</button>
            </>
          }
        >
          <div className="col gap-2" style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.7 }}>
            <span>{t("该预设将覆盖当前 DNS 配置，写入下列方案：", "This preset overwrites the current DNS config with:")}</span>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--t1)" }}>
              <li>{t("国内 ", "Domestic ")}<span className="mono">geosite:cn</span>{t(" → 阿里 / DoH.pub；国外 ", " → AliDNS / DoH.pub; foreign ")}<span className="mono">geolocation-!cn</span>{t(" → Cloudflare / Google DoH", " → Cloudflare / Google DoH")}</li>
              <li>{t("代理节点域名专用解析（国内 DoH，防环路）", "Dedicated resolution for proxy node domains (domestic DoH, anti-loop)")}</li>
              <li>{t("防污染：以 geosite 域名分流为主（国外走加密 DoH），不叠加冗余 fallback", "Anti-pollution mainly via geosite domain routing (foreign over encrypted DoH), no redundant fallback")}</li>
              <li>{t("DNS 去广告（拦截 category-ads-all）+ arc 缓存", "DNS ad-block (category-ads-all) + arc cache")}</li>
              <li>{t("fake-ip 模式 + 常用直连域名过滤（小米/QQ/NTP 等）", "fake-ip mode + common direct-domain filters (Xiaomi/QQ/NTP, etc.)")}</li>
            </ul>
            <div style={{ marginTop: 6, padding: "10px 12px", borderRadius: "var(--r-xs)", background: "rgba(255,159,10,0.1)", color: "var(--orange)", fontSize: 12 }}>
              ⚠️ {t("护栏：预设默认 ", "Guardrail: the preset defaults to ")}<span className="mono">respect-rules={t("关闭", "off")}</span>{t("。若开启 respect-rules，DNS 解析会走分流规则，此时务必保证有可用的直连上游与代理出口，否则可能整体 DNS 不通。", ". If you enable respect-rules, DNS follows routing rules; ensure a working direct upstream and proxy egress, or DNS may break entirely.")}
            </div>
          </div>
        </Modal>
      )}

      {whitelistConfirm && (
        <ConfirmDialog
          title={t("切换到 fake-ip 白名单模式？", "Switch to fake-ip whitelist mode?")}
          message={
            <>
              {t("白名单模式语义相反：", "Whitelist mode is inverted: ")}<b>{t("只有「fake-ip 过滤」列表内的域名才会分配 fake-ip，其余域名一律走真实解析", "only domains in the fake-ip filter list get fake-ip; all others use real resolution")}</b>。
              {t("当前列表通常装的是「要直连」的域名（如 *.lan、+.qq.com），切换后会导致绝大多数域名不进 fake-ip、", "The list usually holds direct domains (e.g. *.lan, +.qq.com); switching means most domains skip fake-ip and ")}
              <b>{t("代理分流可能整体失效", "proxy routing may break entirely")}</b>{t("。确认切换的话，请随后重新规划该列表（填你希望走代理的域名）。", ". If you switch, re-plan the list with domains you want proxied.")}
            </>
          }
          confirmText={t("仍要切换", "Switch anyway")}
          danger
          onConfirm={() => {
            applyPatch({ fakeIpFilterMode: "whitelist" }, { fakeIpFilterMode: "whitelist" });
            setWhitelistConfirm(false);
          }}
          onCancel={() => setWhitelistConfirm(false)}
        />
      )}

      {hostOpen && (
        <Modal
          title={t("添加 Hosts 记录", "Add Hosts Record")}
          sub={t("把域名固定解析到指定 IP / CNAME", "Pin a domain to a fixed IP / CNAME")}
          width={460}
          onClose={() => setHostOpen(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "linear-gradient(135deg,#30d158,#0a84ff)" }}><Pin size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setHostOpen(false)}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={addHost}><Plus size={15} /> {t("添加记录", "Add record")}</button>
            </>
          }
        >
          <FormField label={t("域名", "Domain")} hint={t("支持通配，如 *.example.com", "Wildcards supported, e.g. *.example.com")}>
            <input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} placeholder="dns.google" value={hostForm.domain} autoFocus onChange={(e) => { setHostForm((f) => ({ ...f, domain: e.target.value })); setHostErr(null); }} />
          </FormField>
          <FormField label={t("解析结果（可多个）", "Result(s)")} hint={t("IP 或 CNAME，逗号/空格分隔", "IP or CNAME, comma/space separated")}>
            <input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} placeholder="8.8.8.8, 8.8.4.4" value={hostForm.values} onChange={(e) => { setHostForm((f) => ({ ...f, values: e.target.value })); setHostErr(null); }} />
          </FormField>
          {hostErr && <div style={{ fontSize: 12.5, color: "var(--red)", background: "rgba(255,69,58,0.1)", padding: "8px 12px", borderRadius: "var(--r-xs)" }}>{hostErr}</div>}
        </Modal>
      )}

      {policyOpen && (
        <Modal
          title={t("添加域名分流", "Add Domain Policy")}
          sub={t("把匹配的域名查询交给指定上游解析", "Send matching domain queries to a chosen upstream")}
          width={460}
          onClose={() => setPolicyOpen(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "linear-gradient(135deg,#bf5af2,#5e5ce6)" }}><Split size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setPolicyOpen(false)}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={addPolicy}><Plus size={15} /> {t("添加分流", "Add policy")}</button>
            </>
          }
        >
          <FormField label={t("匹配域名 / 规则", "Match domain / rule")} hint={t("支持：geosite:cn、rule-set:xxx、+.example.com、域名", "Supports: geosite:cn, rule-set:xxx, +.example.com, domain")}>
            <input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} placeholder="geosite:cn" value={policyForm.domain} autoFocus onChange={(e) => { setPolicyForm((f) => ({ ...f, domain: e.target.value })); setPolicyErr(null); }} />
          </FormField>
          <FormField label={t("上游 DNS（可多个）", "Upstream DNS")} hint={t("逗号或空格分隔，建议加密 DoH/DoT", "Comma/space separated; prefer encrypted DoH/DoT")}>
            <input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} placeholder="https://223.5.5.5/dns-query, https://119.29.29.29/dns-query" value={policyForm.servers} onChange={(e) => { setPolicyForm((f) => ({ ...f, servers: e.target.value })); setPolicyErr(null); }} />
          </FormField>
          {policyErr && <div style={{ fontSize: 12.5, color: "var(--red)", background: "rgba(255,69,58,0.1)", padding: "8px 12px", borderRadius: "var(--r-xs)" }}>{policyErr}</div>}
        </Modal>
      )}

      {listAdd && (
        <PromptDialog
          title={listAdd.title}
          label={listAdd.label}
          placeholder={listAdd.placeholder}
          hint={listAdd.hint}
          confirmText={t("添加", "Add")}
          mono
          validate={(v) => {
            if (!v) return t("请输入内容", "Please enter a value");
            if (listAdd.current.includes(v)) return t("该条目已存在", "This entry already exists");
            return null;
          }}
          onConfirm={(v) => {
            listAdd.apply([...listAdd.current, v]);
            setListAdd(null);
          }}
          onCancel={() => setListAdd(null)}
        />
      )}

      {addCtx && (
        <PromptDialog
          title={lang === "en" ? ADD_META_EN[addCtx.field].title : ADD_META[addCtx.field].title}
          label={lang === "en" ? ADD_META_EN[addCtx.field].label : ADD_META[addCtx.field].label}
          placeholder={ADD_META[addCtx.field].placeholder}
          hint={lang === "en" ? ADD_META_EN[addCtx.field].hint : ADD_META[addCtx.field].hint}
          confirmText={t("添加", "Add")}
          mono
          validate={(v) => {
            if (!v) return t("请输入内容", "Please enter a value");
            if (addCtx.current.includes(v)) return t("该条目已存在", "This entry already exists");
            return null;
          }}
          onConfirm={(v) => {
            editList(addCtx.field, [...addCtx.current, v]);
            setAddCtx(null);
          }}
          onCancel={() => setAddCtx(null)}
        />
      )}
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <div className="col">
        <span className="k" style={{ color: "var(--t1)", fontWeight: 500 }}>{label}</span>
        {desc && <span className="muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</span>}
      </div>
      <div className="v">{children}</div>
    </div>
  );
}

function FilterChips({ label, tone, items, onAdd, onRemove }: { label: string; tone: "purple" | "orange" | "blue"; items: string[]; onAdd: () => void; onRemove: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="col gap-2" style={{ padding: 12, borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
      <div className="row between">
        <span className="muted-2" style={{ fontSize: 11.5 }}>{label}</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} title={t("添加", "Add")} onClick={onAdd}><Plus size={13} /></button>
      </div>
      <div className="row wrap gap-2">
        {items.map((it) => (
          <span key={it} className={`pill pill-${tone} mono`} style={{ height: 24, gap: 5, fontSize: 11 }}>
            {it}
            <X size={11} style={{ cursor: "pointer" }} onClick={() => onRemove(it)} />
          </span>
        ))}
        {items.length === 0 && <span className="muted-2" style={{ fontSize: 11 }}>{t("（空）", "(empty)")}</span>}
      </div>
    </div>
  );
}

function ChipCard({ icon, title, items, tone, onAdd, onRemove }: { icon: React.ReactNode; title: string; items: string[]; tone: any; onAdd?: () => void; onRemove?: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <CardHead icon={icon} title={title} right={onAdd && <button className="btn btn-ghost btn-sm" onClick={onAdd}><Plus size={13} /> {t("添加", "Add")}</button>} />
      <div className="col gap-2">
        {items.map((it) => (
          <div key={it} className="row between" style={{ padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", gap: 8 }}>
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--${tone === "blue" ? "blue" : tone === "green" ? "green" : "orange"})`, flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 12 }}>{it}</span>
            </span>
            {onRemove && <button className="icon-btn" style={{ width: 24, height: 24 }} title={t("删除", "Delete")} onClick={() => onRemove(it)}><X size={12} /></button>}
          </div>
        ))}
        {items.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（空）", "(empty)")}</span>}
      </div>
    </GlassCard>
  );
}
