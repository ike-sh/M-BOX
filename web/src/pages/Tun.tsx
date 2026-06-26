import { useEffect, useState } from "react";
import { Shield, Network, Route, Cable, Plus, X, Zap, Power, CheckCircle2, AlertCircle, MinusCircle, Loader2, Globe2, Trash2 } from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, PromptDialog, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { tunConfig } from "../mock/data";
import { useI18n } from "../lib/i18n";
import type { TunConfig, GatewayStatus, GatewayStep, IPv6Status } from "../types";

export function Tun() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<TunConfig>(tunConfig);
  const [gw, setGw] = useState<GatewayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<GatewayStep[] | null>(null);
  const [ipv6, setIpv6] = useState<IPv6Status | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);

  function reloadGw() {
    api.getTransparentStatus().then(setGw);
  }
  useEffect(() => {
    api.getTun().then(setCfg);
    api.getIPv6().then(setIpv6);
    reloadGw();
  }, []);

  function toggleIPv6(enable: boolean) {
    setIpv6((s) => (s ? { ...s, enabled: enable, top: enable, dns: enable, consistent: true } : s));
    api.applyIPv6(enable).then(setIpv6);
  }

  // 改一个字段：乐观更新本地，并把变更 apply 到后端（写 config + 重载 mihomo）。
  function patch(p: Partial<TunConfig>) {
    setCfg((c) => ({ ...c, ...p }));
    api.applyTun(p as Record<string, unknown>);
  }

  function setExclude(list: string[]) {
    setCfg((c) => ({ ...c, excludeCidr: list }));
    api.applyTun({ excludeCidr: list });
  }

  // 一键开启/关闭整套透明代理网关（写配置 + IP 转发 + 启动内核 + 重载 + 开机自启）。
  async function toggleGateway(enable: boolean) {
    if (busy) return;
    setBusy(true);
    setSteps(null);
    try {
      const res = enable ? await api.enableTransparent() : await api.disableTransparent();
      setSteps(res.steps);
      setCfg((c) => ({ ...c, enable }));
    } finally {
      setBusy(false);
      reloadGw();
    }
  }

  // 完全卸载/还原网关：关 TUN + 关 IP 转发(移除持久化) + 取消自启 + 清设备规则。
  async function doUninstall() {
    if (busy) return;
    setBusy(true);
    setSteps(null);
    try {
      const res = await api.uninstallTransparent();
      setSteps(res.steps);
      setCfg((c) => ({ ...c, enable: false }));
    } finally {
      setBusy(false);
      setUninstallOpen(false);
      reloadGw();
    }
  }

  const on = cfg.enable;

  return (
    <div className="page">
      <GlassCard>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16 }}>
            <span className="stat-ico" style={{ width: 52, height: 52, borderRadius: 16, background: on ? "linear-gradient(135deg,#30d158,#40c8e0)" : "var(--fill-1)" }}>
              <Shield size={24} />
            </span>
            <div className="col">
              <span style={{ fontSize: 17, fontWeight: 700 }}>{t("透明代理网关", "Transparent Gateway")}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {on ? <>{t("网卡", "Interface")} <span className="mono">{cfg.device}</span> {t("运行中 · 转发流量经 nftables 重定向", "running · forwarded traffic redirected via nftables")}</> : t("已停用，流量不经过 M-BOX", "Disabled, traffic bypasses M-BOX")}
              </span>
            </div>
          </div>
          <div className="row gap-4">
            {on && <Pill tone="green" dot>{t("运行中", "Running")}</Pill>}
            <button
              className={on ? "btn btn-ghost" : "btn btn-primary"}
              onClick={() => toggleGateway(!on)}
              disabled={busy}
              style={{ gap: 8, minWidth: 188, justifyContent: "center" }}
            >
              {busy ? <Loader2 size={16} className="spin" /> : on ? <Power size={16} /> : <Zap size={16} />}
              {busy ? t("处理中…", "Working…") : on ? t("关闭透明代理", "Disable transparent proxy") : t("一键开启透明代理网关", "Enable transparent gateway")}
            </button>
          </div>
        </div>

        {/* 网关关键开关状态一览 */}
        <div className="row wrap gap-2" style={{ marginTop: 14 }}>
          <StatusChip label={t("TUN 透明代理", "TUN proxy")} ok={gw ? gw.tunEnable : on} />
          <StatusChip label={t("IP 转发", "IP forwarding")} ok={!!gw?.ipForward} />
          <StatusChip label={t("mihomo 内核", "mihomo kernel")} ok={!!gw?.coreRunning} />
          <StatusChip label={t("开机自启", "Autostart")} ok={!!gw?.autostart} />
        </div>

        {/* 完全卸载/还原网关（危险操作，二次确认） */}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setUninstallOpen(true)}
            disabled={busy}
            style={{ gap: 6, color: "var(--red)" }}
            title={t("把系统还原到启用网关之前", "Restore the system to before the gateway was enabled")}
          >
            <Trash2 size={13} /> {t("完全卸载网关", "Uninstall gateway")}
          </button>
        </div>

        {/* 一键操作的逐步结果 */}
        {steps && (
          <div className="col gap-2" style={{ marginTop: 14, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("执行结果", "Result")}</span>
            {steps.map((st, i) => (
              <div key={i} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                {st.skipped ? <MinusCircle size={15} color="var(--t4)" style={{ marginTop: 2, flexShrink: 0 }} />
                  : st.ok ? <CheckCircle2 size={15} color="var(--green)" style={{ marginTop: 2, flexShrink: 0 }} />
                  : <AlertCircle size={15} color="var(--red)" style={{ marginTop: 2, flexShrink: 0 }} />}
                <div className="col">
                  <span style={{ fontSize: 13, color: "var(--t1)" }}>{st.name}</span>
                  <span className="muted-2" style={{ fontSize: 11.5 }}>{st.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<Network size={18} color="var(--blue)" />} title={t("内核与栈", "Kernel & Stack")} />
          <div className="col">
            <Row label={t("网卡名称", "Interface")}><span className="mono v">{cfg.device}</span></Row>
            <Row label={t("协议栈", "Stack")} desc={t("system 最快 / gvisor 最兼容 / mixed 折中", "system fastest / gvisor most compatible / mixed balanced")}>
              <Segmented
                value={cfg.stack}
                onChange={(v) => patch({ stack: v })}
                options={[
                  { value: "system", label: "system" },
                  { value: "gvisor", label: "gvisor" },
                  { value: "mixed", label: "mixed" },
                ]}
              />
            </Row>
            <Row label="auto-route" desc={t("自动接管系统路由", "Auto take over system routing")}>
              <Switch on={cfg.autoRoute} onChange={(v) => patch({ autoRoute: v })} />
            </Row>
            <Row label="auto-redirect" desc={t("nftables 重定向，性能优于 tproxy", "nftables redirect, faster than tproxy")}>
              <Switch on={cfg.autoRedirect} onChange={(v) => patch({ autoRedirect: v })} />
            </Row>
            <Row label="strict-route" desc={t("严格路由防泄漏", "Strict route, anti-leak")}>
              <Switch on={cfg.strictRoute} onChange={(v) => patch({ strictRoute: v })} />
            </Row>
            <Row label="GSO" desc={t("通用分段卸载(Linux)，高带宽下提升吞吐、降 CPU", "Generic Segmentation Offload (Linux): higher throughput, lower CPU")}>
              <Switch on={cfg.gso} onChange={(v) => patch({ gso: v })} />
            </Row>
            <Row label={t("端点独立 NAT", "Endpoint-Independent NAT")} desc={t("改善游戏/P2P 的 UDP NAT；不需要时建议关闭（略降性能）", "Better UDP NAT for gaming/P2P; keep off if unneeded (slight perf cost)")}>
              <Switch on={cfg.endpointIndependentNat} onChange={(v) => patch({ endpointIndependentNat: v })} />
            </Row>
          </div>
        </GlassCard>

        <div className="col gap-4">
          <GlassCard>
            <CardHead icon={<Route size={18} color="var(--purple)" />} title={t("DNS 劫持", "DNS Hijack")} sub={t("重定向到内置 DNS", "Redirect to built-in DNS")} />
            <div className="col gap-2">
              {cfg.dnsHijack.map((h) => (
                <div key={h} className="row" style={{ padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--purple)" }} />
                  <span className="mono" style={{ fontSize: 12 }}>{h}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <CardHead
              icon={<Cable size={18} color="var(--green)" />}
              title={t("排除网段（直连）", "Excluded CIDRs (direct)")}
              sub={t("局域网不走代理", "LAN bypasses the proxy")}
              right={<button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}><Plus size={13} /> {t("添加", "Add")}</button>}
            />
            <div className="row wrap gap-2">
              {cfg.excludeCidr.map((c) => (
                <span key={c} className="pill pill-green mono" style={{ height: 26, gap: 6 }}>
                  {c}
                  <X size={12} style={{ cursor: "pointer" }} onClick={() => setExclude(cfg.excludeCidr.filter((x) => x !== c))} />
                </span>
              ))}
              {cfg.excludeCidr.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>{t("（空）", "(empty)")}</span>}
            </div>
          </GlassCard>

          <GlassCard>
            <CardHead
              icon={<Globe2 size={18} color="var(--blue)" />}
              title={t("IPv6 支持", "IPv6 Support")}
              sub={t("一处协调，杜绝半开泄漏", "Coordinated in one place, no half-open leaks")}
              right={ipv6 ? <Switch on={ipv6.enabled} onChange={toggleIPv6} /> : null}
            />
            <div className="col gap-2">
              <span className="muted-2" style={{ fontSize: 12 }}>
                {t("同时控制顶层 ", "Controls both top-level ")}<span className="mono">ipv6</span> {t("与", "and")} <span className="mono">dns.ipv6</span>{t("：要么全程走代理，要么干净关闭，避免 IPv6 流量绕过代理泄漏真实地址。", ": either fully proxied or cleanly off, so IPv6 traffic never bypasses the proxy and leaks your real address.")}
              </span>
              {ipv6 && !ipv6.consistent && (
                <span className="pill pill-orange" style={{ height: 26 }}>
                  <AlertCircle size={12} /> {t("检测到半开状态（顶层与 DNS 不一致），建议切换一次以修正", "Half-open detected (top-level ≠ DNS); toggle once to fix")}
                </span>
              )}
              {ipv6 && (
                <div className="row gap-2">
                  <Pill tone={ipv6.top ? "blue" : "gray"}>{t("顶层 ipv6", "top ipv6")} {ipv6.top ? t("开", "on") : t("关", "off")}</Pill>
                  <Pill tone={ipv6.dns ? "blue" : "gray"}>dns.ipv6 {ipv6.dns ? t("开", "on") : t("关", "off")}</Pill>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {addOpen && (
        <PromptDialog
          title={t("新增直连网段", "Add Direct CIDR")}
          label={t("CIDR 网段", "CIDR")}
          placeholder="192.168.1.0/24"
          hint={t("该网段流量不走代理，直接连接（局域网建议直连）", "Traffic in this range bypasses the proxy (LAN should be direct)")}
          confirmText={t("添加", "Add")}
          mono
          validate={(v) => {
            if (!v) return t("请输入网段", "Please enter a CIDR");
            if (cfg.excludeCidr.includes(v)) return t("该网段已存在", "This CIDR already exists");
            if (!/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(v)) return t("格式应为 CIDR，如 192.168.1.0/24", "Must be CIDR, e.g. 192.168.1.0/24");
            return null;
          }}
          onConfirm={(v) => {
            setExclude([...cfg.excludeCidr, v]);
            setAddOpen(false);
          }}
          onCancel={() => setAddOpen(false)}
        />
      )}

      {uninstallOpen && (
        <ConfirmDialog
          title={t("完全卸载网关", "Uninstall Gateway")}
          message={
            <>
              {t("将执行：关闭 TUN、关闭并移除 IP 转发持久化、取消开机自启、清除按设备分流规则，把系统还原到启用网关之前。", "This will: disable TUN, remove persisted IP forwarding, disable autostart, clear per-device rules, and restore the system to before the gateway was enabled.")}
              <b>{t("设备列表元数据会保留", "Device list metadata is kept")}</b>{t("，日后可重新启用。确定继续？", "; you can re-enable later. Continue?")}
            </>
          }
          confirmText={t("卸载并还原", "Uninstall & restore")}
          danger
          busy={busy}
          onConfirm={doUninstall}
          onCancel={() => setUninstallOpen(false)}
        />
      )}
    </div>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="pill"
      style={{
        height: 28,
        gap: 6,
        background: ok ? "rgba(48,209,88,0.14)" : "var(--fill-2)",
        color: ok ? "var(--green)" : "var(--t3)",
        border: `1px solid ${ok ? "rgba(48,209,88,0.3)" : "var(--hairline)"}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "var(--green)" : "var(--t4)" }} />
      {label}
    </span>
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
