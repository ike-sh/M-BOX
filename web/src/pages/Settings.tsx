import { useEffect, useState, type ReactNode } from "react";
import { Palette, Cpu, Rocket, Power, RefreshCw, RotateCcw, CheckCircle2, Download } from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { Diagnostics } from "./Diagnostics";

type Opt = { bbr: boolean; bbrAvailable: boolean; autostart: boolean; ipForward: boolean };

export function Settings() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.getAttribute("data-theme") || "dark");
  const [ver, setVer] = useState<{ current: string; latest: string; hasUpdate: boolean }>({ current: "", latest: "", hasUpdate: false });
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [opt, setOpt] = useState<Opt | null>(null);
  const [busy, setBusy] = useState("");
  const [ctrl, setCtrl] = useState<"" | "restart" | "stop">("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    checkUpdate();
    api.getSystemOptimize().then(setOpt);
  }, []);

  function applyTheme(v: string) {
    setTheme(v);
    document.documentElement.setAttribute("data-theme", v);
    localStorage.setItem("mbox-theme", v);
  }
  async function checkUpdate(force = false) {
    setChecking(true);
    try {
      const v = await api.getCoreLatest(force);
      setVer(v);
      if (force) {
        if (!v.latest) flash("检查失败：拿不到最新版本（请检查网络/代理）", 4000);
        else if (v.hasUpdate) flash(`发现新版本 ${v.latest}`, 4000);
        else flash(`已是最新版本 ${v.current || v.latest}`, 3000);
      }
    } finally {
      setChecking(false);
    }
  }
  async function doUpdate() {
    if (updating) return;
    setUpdating(true);
    flash("正在下载并更新内核…可能需要约 1 分钟，期间代理短暂中断", 60000);
    try {
      const r = await api.coreUpdate();
      flash(`内核已更新到 ${r.version || "最新版"} 并重启`, 4000);
      setTimeout(() => checkUpdate(true), 1500);
    } catch (e) {
      flash(e instanceof Error ? e.message : "更新失败", 5000);
    } finally {
      setUpdating(false);
    }
  }
  async function setOptField(patch: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    try {
      setOpt(await api.applySystemOptimize(patch));
      flash("已应用并生效");
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
      api.getSystemOptimize().then(setOpt);
    } finally {
      setBusy("");
    }
  }
  async function doControl() {
    const action = ctrl;
    setCtrl("");
    if (!action) return;
    try {
      await api.systemControl(action);
      flash(action === "restart" ? "服务重启中…几秒后刷新页面即可" : "服务已停止（需在主机端重新启动 mbox-daemon）", 6000);
    } catch (e) {
      flash(e instanceof Error ? e.message : "操作失败");
    }
  }
  function flash(t: string, ms = 2000) {
    setToast(t);
    setTimeout(() => setToast(null), ms);
  }

  return (
    <div className="page">
      {toast && (
        <div className="glass" style={{ padding: "10px 16px", borderRadius: "var(--r-md)", fontSize: 13, border: "1px solid var(--green)", color: "var(--green)" }}>{toast}</div>
      )}

      <div className="grid cols-2">
        <GlassCard>
          <CardHead icon={<Palette size={18} color="var(--purple)" />} title="主题风格" sub="界面亮 / 暗外观（本地保存）" />
          <Segmented value={theme} onChange={applyTheme} options={[{ value: "dark", label: "暗色" }, { value: "light", label: "亮色" }]} />
        </GlassCard>

        <GlassCard>
          <CardHead
            icon={<Cpu size={18} color="var(--blue)" />}
            title="内核更新"
            sub="mihomo 内核版本检查与在线更新"
            right={
              <div className="row gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => checkUpdate(true)} disabled={checking || updating}><RefreshCw size={14} className={checking ? "spin" : ""} /> 检查</button>
                <button className={`btn btn-sm ${ver.hasUpdate ? "btn-primary" : "btn-ghost"}`} onClick={doUpdate} disabled={updating || checking} title="下载最新 mihomo 内核并重启生效">
                  <Download size={14} className={updating ? "spin" : ""} /> {updating ? "更新中…" : "更新内核"}
                </button>
              </div>
            }
          />
          <div className="col">
            <Row label="当前内核版本"><span className="mono v">{ver.current || "—"}</span></Row>
            <Row label="最新版本"><span className="mono v">{ver.latest || "—"}</span></Row>
            <Row label="状态">
              {ver.hasUpdate
                ? <Pill tone="orange" dot>有新版本可用</Pill>
                : <span className="row" style={{ gap: 6, color: "var(--green)", fontSize: 12.5 }}><CheckCircle2 size={14} /> 已是最新</span>}
            </Row>
            {ver.hasUpdate && <span className="muted-2" style={{ fontSize: 11.5 }}>点击右上角「更新内核」即可下载最新版并自动重启生效（期间代理短暂中断）。</span>}
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Rocket size={18} color="var(--green)" />} title="系统优化" sub="网络性能与开机自启（需 root，仅 Linux 生效）" />
          {!opt ? (
            <span className="muted-2" style={{ fontSize: 13 }}>加载中…</span>
          ) : (
            <div className="col">
              <Row label="BBR 拥塞控制" desc={opt.bbrAvailable ? "Google BBR，高带宽高延迟下提升吞吐" : "当前内核未提供 BBR（主机 modprobe tcp_bbr 后可用）"}>
                {busy === "bbr"
                  ? <RefreshCw size={15} className="spin" />
                  : opt.bbrAvailable
                    ? <Switch on={opt.bbr} onChange={(v) => setOptField({ bbr: v }, "bbr")} />
                    : <Pill tone="gray">不可用</Pill>}
              </Row>
              <Row label="开机自动启动" desc="systemd 开机拉起 mbox-daemon">
                {busy === "autostart" ? <RefreshCw size={15} className="spin" /> : <Switch on={opt.autostart} onChange={(v) => setOptField({ autostart: v }, "autostart")} />}
              </Row>
              <Row label="IP 转发" desc="旁路由转发必需（ip_forward）">
                {busy === "ipForward" ? <RefreshCw size={15} className="spin" /> : <Switch on={opt.ipForward} onChange={(v) => setOptField({ ipForward: v }, "ipForward")} />}
              </Row>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Power size={18} color="var(--orange)" />} title="系统控制" sub="重启 / 停止 M-BOX 服务" />
          <div className="col gap-2">
            <div className="row" style={{ gap: 8, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: "1px solid var(--orange)", color: "var(--orange)", fontSize: 12 }}>
              ⚠️ 重启会短暂中断代理；停止后面板将失联，需在主机端重新启动。
            </div>
            <div className="row gap-2">
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setCtrl("restart")}><RotateCcw size={15} /> 重启服务</button>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center", color: "var(--red)" }} onClick={() => setCtrl("stop")}><Power size={15} /> 停止服务</button>
            </div>
          </div>
        </GlassCard>
      </div>

      <Diagnostics />

      {ctrl && (
        <ConfirmDialog
          title={ctrl === "restart" ? "重启 M-BOX 服务？" : "停止 M-BOX 服务？"}
          danger={ctrl === "stop"}
          confirmText={ctrl === "restart" ? "重启" : "停止"}
          message={ctrl === "restart"
            ? <>将重启 mbox-daemon：代理会短暂中断，面板需几秒后刷新重连。确定继续？</>
            : <><b>停止后面板将失联</b>，且代理停止；需要 SSH 到主机执行 <span className="mono">systemctl start mbox-daemon</span> 才能恢复。确定停止？</>}
          onConfirm={doControl}
          onCancel={() => setCtrl("")}
        />
      )}
    </div>
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
