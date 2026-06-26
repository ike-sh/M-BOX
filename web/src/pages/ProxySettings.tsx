import { useEffect, useState, type ReactNode } from "react";
import {
  Network, KeyRound, SlidersHorizontal, Zap, Wifi, Waypoints, Shield, Radar, Database, Cpu, Plus, X, RotateCcw,
} from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, ConfirmDialog } from "../components/ui";
import { Dns } from "./Dns";
import { Tun } from "./Tun";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { IPv6Status, GeneralConfig } from "../types";

type SectionId =
  | "ports" | "auth" | "basic" | "perf" | "network" | "dns" | "tun" | "sniffer" | "geo";

const SECTIONS: { id: SectionId; label: string; en: string; icon: typeof Cpu }[] = [
  { id: "ports", label: "端口设置", en: "Ports", icon: Network },
  { id: "auth", label: "代理认证", en: "Auth", icon: KeyRound },
  { id: "basic", label: "基础设置", en: "General", icon: SlidersHorizontal },
  { id: "perf", label: "性能优化", en: "Performance", icon: Zap },
  { id: "network", label: "网络设置", en: "Network", icon: Wifi },
  { id: "dns", label: "DNS 设置", en: "DNS", icon: Waypoints },
  { id: "tun", label: "TUN 设置", en: "TUN", icon: Shield },
  { id: "sniffer", label: "流量嗅探", en: "Sniffer", icon: Radar },
  { id: "geo", label: "GEO 数据", en: "GEO Data", icon: Database },
];

export function ProxySettings() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState<SectionId>("basic");
  const [gen, setGen] = useState<GeneralConfig | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api.getGeneral().then(setGen);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === "ok" ? 1500 : 4000);
    return () => clearTimeout(id);
  }, [toast]);

  function patchGen(p: Partial<GeneralConfig>) {
    setGen((c) => (c ? { ...c, ...p } : c));
    api
      .applyGeneral(p as Record<string, unknown>)
      .then(() => setToast({ kind: "ok", text: t("已保存并热重载", "Saved & hot-reloaded") }))
      .catch((e) => {
        setToast({ kind: "err", text: `${t("保存失败，已回滚：", "Save failed, rolled back: ")}${e instanceof Error ? e.message : t("请重试", "please retry")}` });
        api.getGeneral().then(setGen);
      });
  }

  const needGen = active !== "dns" && active !== "tun";

  return (
    <div className="page">
      {toast && (
        <div className="glass" style={{ padding: "10px 16px", borderRadius: "var(--r-md)", fontSize: 13, border: `1px solid ${toast.kind === "err" ? "var(--red)" : "var(--green)"}`, color: toast.kind === "err" ? "var(--red)" : "var(--green)" }}>
          {toast.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, alignItems: "start" }}>
        <GlassCard style={{ padding: 8, position: "sticky", top: 8 }}>
          <div className="col" style={{ gap: 2 }}>
            {SECTIONS.map((s) => (
              <button key={s.id} className={`nav-item ${active === s.id ? "active" : ""}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => setActive(s.id)}>
                <s.icon size={16} strokeWidth={2} />
                <span>{lang === "en" ? s.en : s.label}</span>
              </button>
            ))}
            <div style={{ borderTop: "1px solid var(--hairline)", margin: "6px 4px 4px", paddingTop: 6 }}>
              <button className="nav-item" style={{ width: "100%", justifyContent: "flex-start", color: "var(--red)" }} onClick={() => setResetOpen(true)}>
                <RotateCcw size={16} strokeWidth={2} />
                <span>{t("恢复默认", "Reset")}</span>
              </button>
            </div>
          </div>
        </GlassCard>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          {active === "dns" && <Dns />}
          {active === "tun" && <Tun />}
          {needGen && !gen && <GlassCard><span className="muted-2" style={{ fontSize: 13 }}>{t("加载中…", "Loading…")}</span></GlassCard>}
          {needGen && gen && active === "basic" && <BasicSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "ports" && <PortsSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "perf" && <PerfSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "network" && <NetworkSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "sniffer" && <SnifferSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "auth" && <AuthSettings gen={gen} patch={patchGen} />}
          {needGen && gen && active === "geo" && <GeoSettings gen={gen} patch={patchGen} />}
        </div>
      </div>

      {resetOpen && (
        <ConfirmDialog
          title={t("恢复默认配置？", "Reset to default config?")}
          message={<>{t("将把 config.yaml 重置为内置默认配置（会", "Resets config.yaml to the built-in default (")}<b>{t("自动备份", "auto-backs up")}</b>{t("当前配置、保留控制器密钥）。", " the current config, keeps the controller secret). ")}<b>{t("你的订阅注入、自定义节点、DNS / 分流 / 各项设置改动都会被清空", "Your subscription injection, custom nodes, DNS / rules / all setting changes will be cleared")}</b>{t("，确定继续？", ". Continue?")}</>}
          confirmText={t("重置为默认", "Reset to default")}
          danger
          busy={resetting}
          onConfirm={async () => {
            setResetting(true);
            try {
              await api.resetDefault();
              setToast({ kind: "ok", text: t("已恢复默认并热重载", "Reset to default & hot-reloaded") });
              api.getGeneral().then(setGen);
            } catch (e) {
              setToast({ kind: "err", text: `${t("重置失败：", "Reset failed: ")}${e instanceof Error ? e.message : t("请重试", "please retry")}` });
            } finally {
              setResetting(false);
              setResetOpen(false);
            }
          }}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </div>
  );
}

type SectionProps = { gen: GeneralConfig; patch: (p: Partial<GeneralConfig>) => void };

function PortsSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <CardHead icon={<Network size={18} color="var(--blue)" />} title={t("端口设置", "Ports")} sub={t("本地代理与透明代理监听端口（开关启用，0 = 禁用，仅绑本机）", "Local proxy listen ports (toggle to enable, 0 = disabled, bound to localhost)")} />
      <div className="col">
        <PortRow label={t("混合代理端口", "Mixed port")} desc={t("HTTP/SOCKS5 复用端口", "Shared HTTP/SOCKS5 port")} value={gen.mixedPort} def={7890} onChange={(v) => patch({ mixedPort: v })} />
        <PortRow label={t("SOCKS5 端口", "SOCKS5 port")} desc={t("独立 SOCKS5 代理端口", "Standalone SOCKS5 port")} value={gen.socksPort} def={7891} onChange={(v) => patch({ socksPort: v })} />
        <PortRow label={t("HTTP 端口", "HTTP port")} desc={t("独立 HTTP 代理端口", "Standalone HTTP port")} value={gen.httpPort} def={7892} onChange={(v) => patch({ httpPort: v })} />
      </div>
    </GlassCard>
  );
}

// PortRow：前置开关控制端口启用/禁用（关=0），开启时右侧输入端口号；关闭时输入禁用并灰显默认值。
function PortRow({ label, desc, value, def, onChange }: { label: string; desc: string; value: number; def: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  const enabled = value > 0;
  const [v, setV] = useState(String(enabled ? value : def));
  useEffect(() => { setV(String(enabled ? value : def)); }, [enabled, value, def]);
  function commit() {
    if (!enabled) return;
    const n = parseInt(v, 10);
    const next = isNaN(n) || n <= 0 || n > 65535 ? def : n;
    if (next !== value) onChange(next);
    setV(String(next));
  }
  return (
    <div className="kv" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, minWidth: 0, alignItems: "center" }}>
        <Switch on={enabled} onChange={(on) => onChange(on ? (value > 0 ? value : def) : 0)} />
        <div className="col" style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: enabled ? "var(--t1)" : "var(--t3)" }}>{label}</span>
          <span className="muted-2" style={{ fontSize: 11.5 }}>{desc}{t("（0=禁用）", " (0=off)")}</span>
        </div>
      </div>
      <input
        className="input mono"
        style={{ width: 110, textAlign: "right", fontSize: 12.5, opacity: enabled ? 1 : 0.45 }}
        value={enabled ? v : String(def)}
        disabled={!enabled}
        onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

function BasicSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState("rule");
  const [ipv6, setIpv6] = useState<IPv6Status | null>(null);
  useEffect(() => {
    api.getMode().then((m) => setMode((m.mode || "rule").toLowerCase()));
    api.getIPv6().then(setIpv6);
  }, []);
  return (
    <GlassCard>
      <CardHead icon={<SlidersHorizontal size={18} color="var(--blue)" />} title={t("基础设置", "General")} sub={t("运行模式、局域网、日志、IPv6 等基础参数", "Run mode, LAN, logging, IPv6 and other basics")} />
      <div className="col">
        <Row label={t("允许局域网连接", "Allow LAN")} desc={t("允许其他设备通过本机端口代理上网", "Let other devices use the local proxy ports")}>
          <Switch on={gen.allowLan} onChange={(v) => patch({ allowLan: v })} />
        </Row>
        <Row label={t("运行模式", "Run mode")} desc={t("rule 按规则 / global 全局 / direct 直连", "rule / global / direct")}>
          <Segmented value={mode} onChange={(v) => { setMode(v); api.setMode(v); }} options={[{ value: "rule", label: t("规则", "Rule") }, { value: "global", label: t("全局", "Global") }, { value: "direct", label: t("直连", "Direct") }]} />
        </Row>
        <Row label={t("日志级别", "Log level")} desc={t("排查问题时可调 debug", "Use debug when troubleshooting")}>
          <Segmented value={gen.logLevel} onChange={(v) => patch({ logLevel: v })} options={[{ value: "silent", label: t("静默", "Silent") }, { value: "warning", label: t("警告", "Warn") }, { value: "info", label: t("信息", "Info") }, { value: "debug", label: t("调试", "Debug") }]} />
        </Row>
        <Row label={t("启用 IPv6", "Enable IPv6")} desc={t("一处协调顶层 ipv6 与 dns.ipv6，避免半开泄漏", "Coordinates top-level ipv6 and dns.ipv6 to avoid half-open leaks")}>
          {ipv6 ? <Switch on={ipv6.enabled} onChange={(v) => { setIpv6((s) => (s ? { ...s, enabled: v, top: v, dns: v, consistent: true } : s)); api.applyIPv6(v).then(setIpv6); }} /> : <span className="muted-2" style={{ fontSize: 12 }}>{t("加载中…", "Loading…")}</span>}
        </Row>
      </div>
    </GlassCard>
  );
}

function PerfSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <CardHead icon={<Zap size={18} color="var(--purple)" />} title={t("性能优化", "Performance")} sub={t("延迟测算、并发、进程匹配、TLS 指纹等高级项", "Latency, concurrency, process matching, TLS fingerprint, etc.")} />
      <div className="col">
        <Row label={t("统一延迟计算", "Unified delay")} desc={t("更准确的延迟测试结果", "More accurate latency results")}>
          <Switch on={gen.unifiedDelay} onChange={(v) => patch({ unifiedDelay: v })} />
        </Row>
        <Row label={t("TCP 并发连接", "TCP concurrent")} desc={t("使用所有解析 IP 同时连接，取最快", "Dial all resolved IPs concurrently, take the fastest")}>
          <Switch on={gen.tcpConcurrent} onChange={(v) => patch({ tcpConcurrent: v })} />
        </Row>
        <Row label={t("进程匹配模式", "Process matching")} desc={t("网关模式建议关闭", "Keep off in gateway mode")}>
          <Segmented value={gen.findProcessMode || "off"} onChange={(v) => patch({ findProcessMode: v })} options={[{ value: "off", label: t("关闭", "Off") }, { value: "strict", label: t("严格", "Strict") }, { value: "always", label: t("总是", "Always") }]} />
        </Row>
        <Row label={t("TLS 客户端指纹", "TLS fingerprint")} desc={t("伪装 TLS 指纹", "Spoof the TLS fingerprint")}>
          <Segmented value={gen.globalClientFingerprint || ""} onChange={(v) => patch({ globalClientFingerprint: v })} options={[{ value: "", label: t("关闭", "Off") }, { value: "chrome", label: "Chrome" }, { value: "firefox", label: "Firefox" }, { value: "safari", label: "Safari" }, { value: "random", label: t("随机", "Random") }]} />
        </Row>
      </div>
    </GlassCard>
  );
}

function NetworkSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  return (
    <GlassCard>
      <CardHead icon={<Wifi size={18} color="var(--green)" />} title={t("网络设置", "Network")} sub={t("出站网卡、路由标记、Keep-Alive 等网络相关参数", "Outbound interface, fwmark, Keep-Alive and related params")} />
      <div className="col">
        <TextRow label={t("出站网卡", "Outbound interface")} desc={t("指定出站网络接口名称（留空自动检测）", "Outbound interface name (blank = auto-detect)")} value={gen.interfaceName} placeholder="eth0" onCommit={(v) => patch({ interfaceName: v })} />
        <NumRow label={t("路由标记 (fwmark)", "Routing mark (fwmark)")} desc={t("Linux 路由标记，0 = 不设置", "Linux routing mark, 0 = unset")} value={gen.routingMark} onCommit={(v) => patch({ routingMark: v })} />
        <NumRow label={t("Keep-Alive 间隔(秒)", "Keep-Alive interval (s)")} desc={t("TCP 保活探测间隔", "TCP keep-alive probe interval")} value={gen.keepAliveInterval} onCommit={(v) => patch({ keepAliveInterval: v })} />
        <NumRow label={t("Keep-Alive 空闲(秒)", "Keep-Alive idle (s)")} desc={t("TCP 空闲多久后开始保活", "Idle time before keep-alive starts")} value={gen.keepAliveIdle} onCommit={(v) => patch({ keepAliveIdle: v })} />
        <Row label={t("禁用 Keep-Alive", "Disable Keep-Alive")} desc={t("某些环境断连频繁时可尝试开启", "Try enabling if connections drop often")}>
          <Switch on={gen.disableKeepAlive} onChange={(v) => patch({ disableKeepAlive: v })} />
        </Row>
        <div style={{ margin: "10px 0 2px", fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("延迟测试设置（用于「节点管理」的节点测速）", "Latency test settings (used by node speed test in Proxies)")}</div>
        <TestUrlRow value={gen.testUrl} onCommit={(v) => patch({ testUrl: v })} />
        <NumRow label={t("测速超时(ms)", "Test timeout (ms)")} desc={t("单节点延迟测试超时时间", "Per-node latency test timeout")} value={gen.testTimeout} onCommit={(v) => patch({ testTimeout: v })} />
        <NumRow label={t("测速间隔(秒)", "Test interval (s)")} desc={t("自动测速的时间间隔（0 = 不自动）", "Auto test interval (0 = off)")} value={gen.testInterval} onCommit={(v) => patch({ testInterval: v })} />
      </div>
    </GlassCard>
  );
}

const TEST_URL_PRESETS = [
  { label: "Google (gstatic)", url: "http://www.gstatic.com/generate_204" },
  { label: "Google", url: "http://www.google.com/generate_204" },
  { label: "Cloudflare", url: "http://cp.cloudflare.com/generate_204" },
  { label: "Apple", url: "http://captive.apple.com/generate_204" },
  { label: "Microsoft", url: "http://www.msftconnecttest.com/connecttest.txt" },
];

// TestUrlRow：测速 URL 下拉预设 + 自定义输入。
function TestUrlRow({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(!TEST_URL_PRESETS.some((p) => p.url === value));
  const [cv, setCv] = useState(value);
  useEffect(() => {
    setCustom(!TEST_URL_PRESETS.some((p) => p.url === value));
    setCv(value);
  }, [value]);
  return (
    <Row label={t("测速 URL", "Test URL")} desc={t("用于测试节点延迟的 URL 地址", "URL used to test node latency")}>
      <div className="row gap-2" style={{ alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
        {custom && (
          <input
            className="input mono"
            style={{ width: 220, fontSize: 12 }}
            value={cv}
            placeholder="http://..."
            onChange={(e) => setCv(e.target.value)}
            onBlur={() => { if (cv.trim() && cv.trim() !== value) onCommit(cv.trim()); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        )}
        <select
          className="input"
          style={{ width: 150, fontSize: 12.5 }}
          value={custom ? "__custom__" : value}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__custom__") setCustom(true);
            else { setCustom(false); onCommit(val); }
          }}
        >
          {TEST_URL_PRESETS.map((p) => (<option key={p.url} value={p.url}>{p.label}</option>))}
          <option value="__custom__">{t("-- 自定义 --", "-- Custom --")}</option>
        </select>
      </div>
    </Row>
  );
}

function SnifferSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  const sn = gen.sniffer;
  const setSn = (p: Partial<GeneralConfig["sniffer"]>) => patch({ sniffer: { ...sn, ...p } });
  return (
    <GlassCard>
      <CardHead icon={<Radar size={18} color="var(--blue)" />} title={t("流量嗅探", "Traffic Sniffer")} sub={t("从 HTTP/TLS/QUIC 握手提取真实域名，提升按域名分流准确性", "Extract real domains from HTTP/TLS/QUIC handshakes for accurate domain routing")} />
      <div className="col">
        <Row label={t("启用嗅探", "Enable sniffer")}><Switch on={sn.enable} onChange={(v) => setSn({ enable: v })} /></Row>
        <Row label={t("覆盖目标地址", "Override destination")} desc={t("用嗅探域名重置请求目标（更激进，默认关更稳）", "Rewrite the destination with the sniffed domain (aggressive; off is safer)")}><Switch on={sn.overrideDestination} onChange={(v) => setSn({ overrideDestination: v })} /></Row>
        <Row label={t("嗅探 HTTP", "Sniff HTTP")}><Switch on={sn.http} onChange={(v) => setSn({ http: v })} /></Row>
        <Row label={t("嗅探 TLS", "Sniff TLS")}><Switch on={sn.tls} onChange={(v) => setSn({ tls: v })} /></Row>
        <Row label={t("嗅探 QUIC", "Sniff QUIC")}><Switch on={sn.quic} onChange={(v) => setSn({ quic: v })} /></Row>
      </div>
    </GlassCard>
  );
}

function AuthSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  function add() {
    const u = user.trim();
    const p = pass.trim();
    if (!u || !p) return;
    const entry = `${u}:${p}`;
    if (gen.authentication.includes(entry)) return;
    patch({ authentication: [...gen.authentication, entry] });
    setUser("");
    setPass("");
  }
  function remove(entry: string) {
    patch({ authentication: gen.authentication.filter((x) => x !== entry) });
  }
  return (
    <GlassCard>
      <CardHead icon={<KeyRound size={18} color="var(--orange)" />} title={t("代理认证", "Proxy Auth")} sub={t("为本地代理端口设置用户名/密码（透明代理走 TUN 不受影响）", "Set username/password for local proxy ports (TUN transparent proxy unaffected)")} />
      <div className="col gap-2">
        <div className="row gap-2" style={{ alignItems: "stretch" }}>
          <input className="input" style={{ flex: 1, fontSize: 12.5 }} placeholder={t("用户名", "Username")} value={user} onChange={(e) => setUser(e.target.value)} />
          <input className="input" style={{ flex: 1, fontSize: 12.5 }} placeholder={t("密码", "Password")} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="btn btn-primary" onClick={add} disabled={!user.trim() || !pass.trim()}><Plus size={15} /> {t("添加用户", "Add user")}</button>
        </div>
        {gen.authentication.length === 0 ? (
          <span className="muted-2" style={{ fontSize: 12 }}>{t("（未设置认证，本地代理端口免密；公网暴露时务必设置）", "(No auth set; local proxy ports are open. Always set auth if exposed to the internet.)")}</span>
        ) : (
          gen.authentication.map((a) => {
            const u = a.split(":")[0];
            return (
              <div key={a} className="row between" style={{ padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", gap: 8 }}>
                <span className="mono" style={{ fontSize: 12.5 }}>{u} : ••••••</span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} title={t("删除", "Delete")} onClick={() => remove(a)}><X size={13} /></button>
              </div>
            );
          })
        )}
      </div>
    </GlassCard>
  );
}

function GeoSettings({ gen, patch }: SectionProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  async function update() {
    if (busy) return;
    setBusy(true); setToast(null);
    try { await api.updateGeo(); setToast(t("GEO 数据已更新并热加载", "GEO data updated & hot-loaded")); }
    catch { setToast(t("更新失败：内核未运行或下载超时", "Update failed: kernel not running or download timed out")); }
    finally { setBusy(false); setTimeout(() => setToast(null), 3000); }
  }
  return (
    <GlassCard>
      <CardHead icon={<Database size={18} color="var(--teal)" />} title={t("GEO 数据", "GEO Data")} sub={t("GeoIP / GeoSite 数据库：地理位置判断与域名分类", "GeoIP / GeoSite databases: geolocation & domain categories")} />
      <div className="col">
        <Row label={t("使用 DAT 格式", "Use DAT format")} desc={t("DAT 格式查询更快", "DAT format is faster to query")}>
          <Switch on={gen.geodataMode} onChange={(v) => patch({ geodataMode: v })} />
        </Row>
        <Row label={t("加载器", "Loader")} desc={t("standard 兼容 / memconservative 省内存", "standard = compatible / memconservative = low memory")}>
          <Segmented value={gen.geodataLoader || "memconservative"} onChange={(v) => patch({ geodataLoader: v })} options={[{ value: "standard", label: t("标准", "Standard") }, { value: "memconservative", label: t("省内存", "Low-mem") }]} />
        </Row>
        <Row label={t("自动更新", "Auto-update")} desc={t("后台定时更新 GEO 数据库", "Periodically update GEO databases in the background")}>
          <Switch on={gen.geoAutoUpdate} onChange={(v) => patch({ geoAutoUpdate: v })} />
        </Row>
        <NumRow label={t("更新间隔(小时)", "Update interval (h)")} desc={t("自动更新的时间间隔", "Auto-update interval")} value={gen.geoUpdateInterval} onCommit={(v) => patch({ geoUpdateInterval: v })} />
        <TextRow label={t("下载 UA", "Download UA")} desc={t("下载外部资源时使用的 User-Agent", "User-Agent for downloading external resources")} value={gen.globalUa} placeholder="clash.meta" onCommit={(v) => patch({ globalUa: v })} />
        <div className="row gap-2" style={{ alignItems: "center", marginTop: 6 }}>
          <button className="btn btn-primary" onClick={update} disabled={busy}><Database size={15} /> {busy ? t("更新中…", "Updating…") : t("立即更新 GEO 数据", "Update GEO data now")}</button>
          {toast && <Pill tone="green" dot>{toast}</Pill>}
        </div>
      </div>
    </GlassCard>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
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

// NumRow / TextRow：本地编辑，失焦或回车时提交（避免每次按键都热重载）。
function NumRow({ label, desc, value, onCommit }: { label: string; desc?: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  function commit() {
    const n = parseInt(v, 10);
    const next = isNaN(n) || n < 0 ? 0 : n;
    if (next !== value) onCommit(next);
    setV(String(next));
  }
  return (
    <Row label={label} desc={desc}>
      <input className="input mono" style={{ width: 120, textAlign: "right", fontSize: 12.5 }} value={v}
        onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </Row>
  );
}

function TextRow({ label, desc, value, placeholder, onCommit }: { label: string; desc?: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  function commit() { if (v.trim() !== value) onCommit(v.trim()); }
  return (
    <Row label={label} desc={desc}>
      <input className="input mono" style={{ width: 200, fontSize: 12.5 }} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </Row>
  );
}
