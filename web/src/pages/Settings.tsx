import { useEffect, useState, type ReactNode } from "react";
import { Palette, Cpu, Rocket, Power, RefreshCw, RotateCcw, CheckCircle2, Download } from "lucide-react";
import { GlassCard, CardHead, Switch, Segmented, Pill, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { Diagnostics } from "./Diagnostics";
import { useI18n } from "../lib/i18n";

type Opt = { bbr: boolean; bbrAvailable: boolean; autostart: boolean; ipForward: boolean };

export function Settings() {
  const { t } = useI18n();
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
        if (!v.latest) flash(t("检查失败：拿不到最新版本（请检查网络/代理）", "Check failed: cannot fetch latest version (check network/proxy)"), 4000);
        else if (v.hasUpdate) flash(`${t("发现新版本", "New version")} ${v.latest}`, 4000);
        else flash(`${t("已是最新版本", "Up to date")} ${v.current || v.latest}`, 3000);
      }
    } finally {
      setChecking(false);
    }
  }
  async function doUpdate() {
    if (updating) return;
    setUpdating(true);
    flash(t("正在下载并更新内核…可能需要约 1 分钟，期间代理短暂中断", "Downloading & updating kernel… may take ~1 min, proxy briefly interrupted"), 60000);
    try {
      const r = await api.coreUpdate();
      flash(`${t("内核已更新到", "Kernel updated to")} ${r.version || t("最新版", "latest")} ${t("并重启", "& restarted")}`, 4000);
      setTimeout(() => checkUpdate(true), 1500);
    } catch (e) {
      flash(e instanceof Error ? e.message : t("更新失败", "Update failed"), 5000);
    } finally {
      setUpdating(false);
    }
  }
  async function setOptField(patch: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    try {
      setOpt(await api.applySystemOptimize(patch));
      flash(t("已应用并生效", "Applied"));
    } catch (e) {
      flash(e instanceof Error ? e.message : t("操作失败", "Operation failed"));
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
      flash(action === "restart" ? t("服务重启中…几秒后刷新页面即可", "Service restarting… refresh the page in a few seconds") : t("服务已停止（需在主机端重新启动 mbox-daemon）", "Service stopped (restart mbox-daemon on the host)"), 6000);
    } catch (e) {
      flash(e instanceof Error ? e.message : t("操作失败", "Operation failed"));
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
          <CardHead icon={<Palette size={18} color="var(--purple)" />} title={t("主题风格", "Theme")} sub={t("界面亮 / 暗外观（本地保存）", "Light / dark appearance (saved locally)")} />
          <Segmented value={theme} onChange={applyTheme} options={[{ value: "dark", label: t("暗色", "Dark") }, { value: "light", label: t("亮色", "Light") }]} />
        </GlassCard>

        <GlassCard>
          <CardHead
            icon={<Cpu size={18} color="var(--blue)" />}
            title={t("内核更新", "Kernel Update")}
            sub={t("mihomo 内核版本检查与在线更新", "Check & update mihomo kernel online")}
            right={
              <div className="row gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => checkUpdate(true)} disabled={checking || updating}><RefreshCw size={14} className={checking ? "spin" : ""} /> {t("检查", "Check")}</button>
                <button className={`btn btn-sm ${ver.hasUpdate ? "btn-primary" : "btn-ghost"}`} onClick={doUpdate} disabled={updating || checking} title={t("下载最新 mihomo 内核并重启生效", "Download latest mihomo kernel and restart")}>
                  <Download size={14} className={updating ? "spin" : ""} /> {updating ? t("更新中…", "Updating…") : t("更新内核", "Update")}
                </button>
              </div>
            }
          />
          <div className="col">
            <Row label={t("当前内核版本", "Current version")}><span className="mono v">{ver.current || "—"}</span></Row>
            <Row label={t("最新版本", "Latest version")}><span className="mono v">{ver.latest || "—"}</span></Row>
            <Row label={t("状态", "Status")}>
              {ver.hasUpdate
                ? <Pill tone="orange" dot>{t("有新版本可用", "Update available")}</Pill>
                : <span className="row" style={{ gap: 6, color: "var(--green)", fontSize: 12.5 }}><CheckCircle2 size={14} /> {t("已是最新", "Up to date")}</span>}
            </Row>
            {ver.hasUpdate && <span className="muted-2" style={{ fontSize: 11.5 }}>{t("点击右上角「更新内核」即可下载最新版并自动重启生效（期间代理短暂中断）。", "Click \u201cUpdate\u201d above to download the latest and auto-restart (proxy briefly interrupted).")}</span>}
          </div>
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Rocket size={18} color="var(--green)" />} title={t("系统优化", "System Tuning")} sub={t("网络性能与开机自启（需 root，仅 Linux 生效）", "Network performance & autostart (root, Linux only)")} />
          {!opt ? (
            <span className="muted-2" style={{ fontSize: 13 }}>{t("加载中…", "Loading…")}</span>
          ) : (
            <div className="col">
              <Row label={t("BBR 拥塞控制", "BBR congestion control")} desc={opt.bbrAvailable ? t("Google BBR，高带宽高延迟下提升吞吐", "Google BBR, boosts throughput on high BDP links") : t("当前内核未提供 BBR（主机 modprobe tcp_bbr 后可用）", "Kernel lacks BBR (run modprobe tcp_bbr on host)")}>
                {busy === "bbr"
                  ? <RefreshCw size={15} className="spin" />
                  : opt.bbrAvailable
                    ? <Switch on={opt.bbr} onChange={(v) => setOptField({ bbr: v }, "bbr")} />
                    : <Pill tone="gray">{t("不可用", "N/A")}</Pill>}
              </Row>
              <Row label={t("开机自动启动", "Start on boot")} desc={t("systemd 开机拉起 mbox-daemon", "systemd starts mbox-daemon on boot")}>
                {busy === "autostart" ? <RefreshCw size={15} className="spin" /> : <Switch on={opt.autostart} onChange={(v) => setOptField({ autostart: v }, "autostart")} />}
              </Row>
              <Row label={t("IP 转发", "IP forwarding")} desc={t("旁路由转发必需（ip_forward）", "Required for side-router forwarding (ip_forward)")}>
                {busy === "ipForward" ? <RefreshCw size={15} className="spin" /> : <Switch on={opt.ipForward} onChange={(v) => setOptField({ ipForward: v }, "ipForward")} />}
              </Row>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Power size={18} color="var(--orange)" />} title={t("系统控制", "System Control")} sub={t("重启 / 停止 M-BOX 服务", "Restart / stop the M-BOX service")} />
          <div className="col gap-2">
            <div className="row" style={{ gap: 8, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)", border: "1px solid var(--orange)", color: "var(--orange)", fontSize: 12 }}>
              ⚠️ {t("重启会短暂中断代理；停止后面板将失联，需在主机端重新启动。", "Restart briefly interrupts the proxy; after stop the panel disconnects and must be restarted on the host.")}
            </div>
            <div className="row gap-2">
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setCtrl("restart")}><RotateCcw size={15} /> {t("重启服务", "Restart")}</button>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center", color: "var(--red)" }} onClick={() => setCtrl("stop")}><Power size={15} /> {t("停止服务", "Stop")}</button>
            </div>
          </div>
        </GlassCard>
      </div>

      <Diagnostics />

      {ctrl && (
        <ConfirmDialog
          title={ctrl === "restart" ? t("重启 M-BOX 服务？", "Restart M-BOX service?") : t("停止 M-BOX 服务？", "Stop M-BOX service?")}
          danger={ctrl === "stop"}
          confirmText={ctrl === "restart" ? t("重启", "Restart") : t("停止", "Stop")}
          message={ctrl === "restart"
            ? <>{t("将重启 mbox-daemon：代理会短暂中断，面板需几秒后刷新重连。确定继续？", "This restarts mbox-daemon: the proxy briefly drops and the panel reconnects after a few seconds. Continue?")}</>
            : <><b>{t("停止后面板将失联", "The panel will disconnect after stopping")}</b>{t("，且代理停止；需要 SSH 到主机执行 ", ", and the proxy stops; SSH to the host and run ")}<span className="mono">systemctl start mbox-daemon</span>{t(" 才能恢复。确定停止？", " to recover. Stop?")}</>}
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
