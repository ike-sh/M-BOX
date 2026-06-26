import { useEffect, useState } from "react";
import { Shield, Network, Route, Cable, Plus, X, Zap, Power, CheckCircle2, AlertCircle, MinusCircle, Loader2, Globe2, Trash2 } from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, PromptDialog, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { tunConfig } from "../mock/data";
import type { TunConfig, GatewayStatus, GatewayStep, IPv6Status } from "../types";

export function Tun() {
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
              <span style={{ fontSize: 17, fontWeight: 700 }}>透明代理网关</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {on ? <>网卡 <span className="mono">{cfg.device}</span> 运行中 · 转发流量经 nftables 重定向</> : "已停用，流量不经过 M-BOX"}
              </span>
            </div>
          </div>
          <div className="row gap-4">
            {on && <Pill tone="green" dot>运行中</Pill>}
            <button
              className={on ? "btn btn-ghost" : "btn btn-primary"}
              onClick={() => toggleGateway(!on)}
              disabled={busy}
              style={{ gap: 8, minWidth: 188, justifyContent: "center" }}
            >
              {busy ? <Loader2 size={16} className="spin" /> : on ? <Power size={16} /> : <Zap size={16} />}
              {busy ? "处理中…" : on ? "关闭透明代理" : "一键开启透明代理网关"}
            </button>
          </div>
        </div>

        {/* 网关关键开关状态一览 */}
        <div className="row wrap gap-2" style={{ marginTop: 14 }}>
          <StatusChip label="TUN 透明代理" ok={gw ? gw.tunEnable : on} />
          <StatusChip label="IP 转发" ok={!!gw?.ipForward} />
          <StatusChip label="mihomo 内核" ok={!!gw?.coreRunning} />
          <StatusChip label="开机自启" ok={!!gw?.autostart} />
        </div>

        {/* 完全卸载/还原网关（危险操作，二次确认） */}
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setUninstallOpen(true)}
            disabled={busy}
            style={{ gap: 6, color: "var(--red)" }}
            title="把系统还原到启用网关之前"
          >
            <Trash2 size={13} /> 完全卸载网关
          </button>
        </div>

        {/* 一键操作的逐步结果 */}
        {steps && (
          <div className="col gap-2" style={{ marginTop: 14, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>执行结果</span>
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
          <CardHead icon={<Network size={18} color="var(--blue)" />} title="内核与栈" />
          <div className="col">
            <Row label="网卡名称"><span className="mono v">{cfg.device}</span></Row>
            <Row label="协议栈" desc="system 最快 / gvisor 最兼容 / mixed 折中">
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
            <Row label="auto-route" desc="自动接管系统路由">
              <Switch on={cfg.autoRoute} onChange={(v) => patch({ autoRoute: v })} />
            </Row>
            <Row label="auto-redirect" desc="nftables 重定向，性能优于 tproxy">
              <Switch on={cfg.autoRedirect} onChange={(v) => patch({ autoRedirect: v })} />
            </Row>
            <Row label="strict-route" desc="严格路由防泄漏">
              <Switch on={cfg.strictRoute} onChange={(v) => patch({ strictRoute: v })} />
            </Row>
            <Row label="GSO" desc="通用分段卸载(Linux)，高带宽下提升吞吐、降 CPU">
              <Switch on={cfg.gso} onChange={(v) => patch({ gso: v })} />
            </Row>
            <Row label="端点独立 NAT" desc="改善游戏/P2P 的 UDP NAT；不需要时建议关闭（略降性能）">
              <Switch on={cfg.endpointIndependentNat} onChange={(v) => patch({ endpointIndependentNat: v })} />
            </Row>
          </div>
        </GlassCard>

        <div className="col gap-4">
          <GlassCard>
            <CardHead icon={<Route size={18} color="var(--purple)" />} title="DNS 劫持" sub="重定向到内置 DNS" />
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
              title="排除网段（直连）"
              sub="局域网不走代理"
              right={<button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}><Plus size={13} /> 添加</button>}
            />
            <div className="row wrap gap-2">
              {cfg.excludeCidr.map((c) => (
                <span key={c} className="pill pill-green mono" style={{ height: 26, gap: 6 }}>
                  {c}
                  <X size={12} style={{ cursor: "pointer" }} onClick={() => setExclude(cfg.excludeCidr.filter((x) => x !== c))} />
                </span>
              ))}
              {cfg.excludeCidr.length === 0 && <span className="muted-2" style={{ fontSize: 12 }}>（空）</span>}
            </div>
          </GlassCard>

          <GlassCard>
            <CardHead
              icon={<Globe2 size={18} color="var(--blue)" />}
              title="IPv6 支持"
              sub="一处协调，杜绝半开泄漏"
              right={ipv6 ? <Switch on={ipv6.enabled} onChange={toggleIPv6} /> : null}
            />
            <div className="col gap-2">
              <span className="muted-2" style={{ fontSize: 12 }}>
                同时控制顶层 <span className="mono">ipv6</span> 与 <span className="mono">dns.ipv6</span>：要么全程走代理，要么干净关闭，避免 IPv6 流量绕过代理泄漏真实地址。
              </span>
              {ipv6 && !ipv6.consistent && (
                <span className="pill pill-orange" style={{ height: 26 }}>
                  <AlertCircle size={12} /> 检测到半开状态（顶层与 DNS 不一致），建议切换一次以修正
                </span>
              )}
              {ipv6 && (
                <div className="row gap-2">
                  <Pill tone={ipv6.top ? "blue" : "gray"}>顶层 ipv6 {ipv6.top ? "开" : "关"}</Pill>
                  <Pill tone={ipv6.dns ? "blue" : "gray"}>dns.ipv6 {ipv6.dns ? "开" : "关"}</Pill>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {addOpen && (
        <PromptDialog
          title="新增直连网段"
          label="CIDR 网段"
          placeholder="192.168.1.0/24"
          hint="该网段流量不走代理，直接连接（局域网建议直连）"
          confirmText="添加"
          mono
          validate={(v) => {
            if (!v) return "请输入网段";
            if (cfg.excludeCidr.includes(v)) return "该网段已存在";
            if (!/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(v)) return "格式应为 CIDR，如 192.168.1.0/24";
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
          title="完全卸载网关"
          message={
            <>
              将执行：关闭 TUN、关闭并移除 IP 转发持久化、取消开机自启、清除按设备分流规则，
              把系统还原到启用网关之前。<b>设备列表元数据会保留</b>，日后可重新启用。确定继续？
            </>
          }
          confirmText="卸载并还原"
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
