import { useEffect, useState } from "react";
import { Rss, RefreshCw, Plus, Calendar, Server, Clock, Trash2, Pencil, AlertTriangle } from "lucide-react";
import { GlassCard, CardHead, Switch, Pill, Modal, FormField, Select, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { pct } from "../lib/format";
import { useSubAlerts } from "../lib/subAlerts";
import { useI18n } from "../lib/i18n";
import type { Subscription } from "../types";

const INTERVAL_OPTIONS = [
  { value: "6", label: "每 6 小时", en: "Every 6h" },
  { value: "12", label: "每 12 小时", en: "Every 12h" },
  { value: "24", label: "每 24 小时（推荐）", en: "Every 24h (recommended)" },
  { value: "48", label: "每 48 小时", en: "Every 48h" },
  { value: "72", label: "每 72 小时", en: "Every 72h" },
  { value: "168", label: "每 7 天", en: "Every 7 days" },
];

export function Subscriptions() {
  const { t, lang } = useI18n();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [form, setForm] = useState({ name: "", url: "", interval: "24" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [delTarget, setDelTarget] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { byId, refresh: refreshAlerts } = useSubAlerts();

  function reload() {
    api.getSubscriptions().then(setSubs);
    refreshAlerts();
  }
  useEffect(reload, []);

  async function update(s: Subscription) {
    setUpdating(s.id);
    await api.updateSubscription(s.name);
    reload();
    setUpdating(null);
  }
  async function toggle(s: Subscription) {
    if (toggling) return;
    const next = !s.enabled;
    setToggling(s.id);
    setNotice(null);
    setSubs((list) => list.map((x) => (x.id === s.id ? { ...x, enabled: next } : x))); // 乐观
    try {
      await api.setSubscriptionEnabled(s.name, next);
      refreshAlerts();
    } catch (e) {
      // 失败回滚并提示。
      setSubs((list) => list.map((x) => (x.id === s.id ? { ...x, enabled: !next } : x)));
      setNotice(`「${s.name}」${next ? t("启用", "enable") : t("停用", "disable")}${t("失败：", " failed: ")}${e instanceof Error ? e.message : t("请稍后重试", "please retry later")}`);
    } finally {
      setToggling(null);
    }
  }

  function openAdd() {
    setFormMode("add");
    setForm({ name: "", url: "", interval: "24" });
    setAddError(null);
    setFormOpen(true);
  }
  function openEdit(s: Subscription) {
    setFormMode("edit");
    // 编辑时不预填脱敏 URL（留空表示沿用原链接，仅改间隔）。
    setForm({ name: s.name, url: "", interval: String(s.interval || 24) });
    setAddError(null);
    setFormOpen(true);
  }
  async function submitForm() {
    const isEdit = formMode === "edit";
    const name = form.name.trim();
    const url = form.url.trim();
    if (!name) { setAddError(t("请填写订阅名称", "Please enter a subscription name")); return; }
    // 新增必须填链接；编辑可留空（沿用原链接）。
    if (!isEdit && !url) { setAddError(t("请填写订阅链接", "Please enter a subscription URL")); return; }
    if (url && !/^https?:\/\//i.test(url)) { setAddError(t("订阅链接需以 http:// 或 https:// 开头", "URL must start with http:// or https://")); return; }
    setSaving(true);
    setAddError(null);
    try {
      await api.addSubscription(name, url, Number(form.interval) || 24);
      setFormOpen(false);
      reload();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : (isEdit ? t("保存失败，请检查链接或网络", "Save failed, check the URL or network") : t("添加失败，请检查链接或网络", "Add failed, check the URL or network")));
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await api.deleteSubscription(delTarget.name);
      setDelTarget(null);
      reload();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      {notice && (
        <div
          className="glass"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--r-md)",
            fontSize: 13,
            border: "1px solid var(--orange)",
            color: "var(--orange)",
          }}
        >
          {notice}
        </div>
      )}
      <div className="grid cols-2">
        {subs.map((s) => {
          const used = pct(s.used, s.total);
          const tone = used > 85 ? "red" : used > 60 ? "orange" : "green";
          const warns = byId[s.id] ?? [];
          return (
            <GlassCard key={s.id} style={warns.length ? { borderColor: "var(--orange)", boxShadow: "0 0 0 1px var(--orange) inset" } : undefined}>
              <CardHead
                icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}><Rss size={17} /></span>}
                title={s.name}
                sub={s.url}
                right={
                  <div className="row gap-2">
                    <Switch on={s.enabled} onChange={() => toggle(s)} />
                    <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => openEdit(s)} aria-label={t("编辑订阅", "Edit subscription")} title={t("编辑订阅", "Edit subscription")}><Pencil size={15} /></button>
                    <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setDelTarget(s)} aria-label={t("删除订阅", "Delete subscription")} title={t("删除订阅", "Delete subscription")}><Trash2 size={16} /></button>
                  </div>
                }
              />

              <div className="col" style={{ gap: 8, marginBottom: 16 }}>
                <div className="row between">
                  <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{t("流量", "Traffic")}</span>
                  <span className="mono" style={{ fontSize: 12.5 }}>
                    <b>{s.used} GB</b> <span className="muted-2">/ {s.total} GB</span>
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${used}%`, background: tone === "red" ? "var(--red)" : tone === "orange" ? "linear-gradient(90deg,#ff9f0a,#ffd60a)" : "linear-gradient(90deg,#30d158,#40c8e0)" }} />
                </div>
              </div>

              {warns.length > 0 && (
                <div
                  className="row"
                  style={{ gap: 8, alignItems: "center", padding: "8px 10px", marginBottom: 12, borderRadius: "var(--r-sm)", background: "rgba(255,159,10,0.12)", border: "1px solid var(--orange)" }}
                >
                  <AlertTriangle size={14} color="var(--orange)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--orange)", fontWeight: 500 }}>
                    {warns.map((w) => w.detail).join(" · ")}
                  </span>
                </div>
              )}

              <div className="grid cols-3" style={{ gap: 10 }}>
                <Field icon={<Server size={14} />} label={t("节点", "Nodes")} value={`${s.nodeCount}`} />
                <Field icon={<Calendar size={14} />} label={t("到期", "Expires")} value={s.expire} />
                <Field icon={<Clock size={14} />} label={t("自动更新", "Auto-update")} value={`${s.interval}h`} />
              </div>

              <div className="row between" style={{ marginTop: 18 }}>
                <span className="row" style={{ gap: 8 }}>
                  <Pill tone="gray">{t("更新于", "Updated")} {s.updatedAt}</Pill>
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => update(s)} disabled={updating === s.id}>
                  <RefreshCw size={14} className={updating === s.id ? "spin" : ""} />
                  {updating === s.id ? t("更新中", "Updating") : t("立即更新", "Update now")}
                </button>
              </div>
            </GlassCard>
          );
        })}

        <button
          className="glass card"
          onClick={openAdd}
          style={{
            borderStyle: "dashed",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            minHeight: 240,
            cursor: "pointer",
            color: "var(--t2)",
            fontFamily: "inherit",
          }}
        >
          <span className="stat-ico" style={{ width: 48, height: 48, background: "var(--fill-1)", color: "var(--t1)" }}>
            <Plus size={24} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{t("添加订阅", "Add Subscription")}</span>
          <span style={{ fontSize: 12 }}>{t("支持 Clash / mihomo / Base64 / V2Ray 链接", "Clash / mihomo / Base64 / V2Ray links supported")}</span>
        </button>
      </div>

      {formOpen && (
        <Modal
          title={formMode === "edit" ? t("编辑订阅", "Edit Subscription") : t("添加订阅", "Add Subscription")}
          sub={t("支持 Clash / mihomo / Base64 / V2Ray 订阅链接", "Clash / mihomo / Base64 / V2Ray links supported")}
          width={460}
          onClose={() => !saving && setFormOpen(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}><Rss size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={submitForm} disabled={saving} style={{ gap: 8 }}>
                {saving ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
                {saving ? t("保存中…", "Saving…") : formMode === "edit" ? t("保存修改", "Save") : t("添加订阅", "Add")}
              </button>
            </>
          }
        >
          <FormField label={t("订阅名称", "Name")} hint={formMode === "edit" ? t("名称作为唯一标识，编辑时不可修改", "Name is the unique key and cannot be changed when editing") : undefined}>
            <input
              className="input"
              placeholder={t("例如：机场A", "e.g. Provider A")}
              value={form.name}
              autoFocus={formMode === "add"}
              disabled={formMode === "edit"}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && submitForm()}
            />
          </FormField>
          <FormField
            label={t("订阅链接", "URL")}
            hint={formMode === "edit" ? t("为安全已隐藏原链接；留空则沿用原链接，仅修改更新间隔", "Original URL hidden for safety; leave blank to keep it and only change the interval") : t("Clash/mihomo 订阅地址，或 Base64/V2Ray 订阅链接", "Clash/mihomo subscription URL, or Base64/V2Ray link")}
          >
            <input
              className="input"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
              placeholder={formMode === "edit" ? t("留空不改；如需更换请粘贴新链接", "Leave blank to keep; paste a new URL to replace") : "https://example.com/api/v1/subscribe?token=..."}
              value={form.url}
              autoFocus={formMode === "edit"}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && submitForm()}
            />
          </FormField>
          <FormField label={t("自动更新间隔", "Auto-update interval")}>
            <Select
              value={form.interval}
              options={INTERVAL_OPTIONS.map((o) => ({ value: o.value, label: lang === "en" ? o.en : o.label }))}
              onChange={(v) => setForm((f) => ({ ...f, interval: v }))}
            />
          </FormField>
          {addError && (
            <div style={{ fontSize: 12.5, color: "var(--red)", background: "rgba(255,69,58,0.1)", padding: "8px 12px", borderRadius: "var(--r-xs)" }}>
              {addError}
            </div>
          )}
        </Modal>
      )}

      {delTarget && (
        <ConfirmDialog
          title={t("删除订阅", "Delete Subscription")}
          danger
          busy={deleting}
          confirmText={deleting ? t("删除中…", "Deleting…") : t("删除", "Delete")}
          message={<>{t("确定删除订阅「", "Delete subscription \u201c")}<b style={{ color: "var(--t1)" }}>{delTarget.name}</b>{t("」？此操作不可撤销。", "\u201d? This cannot be undone.")}</>}
          onConfirm={confirmRemove}
          onCancel={() => !deleting && setDelTarget(null)}
        />
      )}
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="col" style={{ gap: 4, padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--fill-2)" }}>
      <span className="row muted-2" style={{ gap: 5, fontSize: 11 }}>{icon}{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
