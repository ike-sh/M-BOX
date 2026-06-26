import { useEffect, useRef, useState } from "react";
import { Archive, Download, Upload, RotateCcw, Trash2, FileCode2, Clock, Save, Sparkles } from "lucide-react";
import { GlassCard, CardHead, Pill, PromptDialog, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface Backup {
  id: string;
  name: string;
  note: string;
  time: string;
  size: string;
  current: boolean;
}

export function Config() {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [delTarget, setDelTarget] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function loadConfig() {
    api.getConfigRaw().then((r) => {
      setContent(r.content);
      setDirty(false);
    });
  }
  function loadBackups() {
    api.getBackups().then(setBackups);
  }
  useEffect(() => {
    loadConfig();
    loadBackups();
  }, []);

  async function save() {
    setSaving(true);
    setNotice(null);
    const r = await api.saveConfigRaw(content);
    setDirty(false);
    setSaving(false);
    loadBackups();
    if (r.warning) {
      setNotice({ kind: "warn", text: r.warning });
    } else {
      setNotice({ kind: "ok", text: t("配置已保存并热重载成功", "Config saved & hot-reloaded") });
      setTimeout(() => setNotice(null), 4000);
    }
  }

  async function backupNow(note: string) {
    await api.createBackup(note || t("手动备份", "Manual backup"));
    setBackupOpen(false);
    loadBackups();
  }

  async function restore() {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      await api.restoreBackup(restoreTarget.id);
      setRestoreTarget(null);
      loadConfig();
      loadBackups();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!delTarget) return;
    setBusy(true);
    try {
      await api.deleteBackup(delTarget.id);
      setDelTarget(null);
      loadBackups();
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate() {
    setTplBusy(true);
    setNotice(null);
    try {
      const r = await api.applyTemplate();
      setTplOpen(false);
      loadConfig();
      loadBackups();
      if (r.warning) {
        setNotice({ kind: "warn", text: r.warning });
      } else {
        setNotice({ kind: "ok", text: t(`已应用推荐策略（纳入 ${r.providers} 个订阅）并热重载`, `Recommended policy applied (${r.providers} subscription(s) included) & hot-reloaded`) });
        setTimeout(() => setNotice(null), 4000);
      }
    } finally {
      setTplBusy(false);
    }
  }

  function exportConfig() {
    const blob = new Blob([content], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "config.yaml";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result));
      setDirty(true);
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  const recent = backups[0]?.time ?? "—";

  return (
    <>
      <input ref={fileRef} type="file" accept=".yaml,.yml,.txt" hidden onChange={onImportFile} />
      {notice && (
        <div
          className="glass"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--r-md)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: `1px solid ${notice.kind === "warn" ? "var(--orange)" : "var(--green)"}`,
            color: notice.kind === "warn" ? "var(--orange)" : "var(--green)",
          }}
        >
          {notice.text}
        </div>
      )}
      <div className="grid cols-3">
        <GlassCard className="span-2">
          <CardHead
            icon={<FileCode2 size={18} color="var(--blue)" />}
            title={t("当前配置", "Current Config")}
            sub={dirty ? t("已修改，未保存", "Modified, unsaved") : "/etc/mbox/config.yaml"}
            right={
              <div className="row gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setTplOpen(true)} title={t("生成地区分组 + 分类分流 + 内置 GEOSITE 规则", "Generate region groups + category routing + built-in GEOSITE rules")}><Sparkles size={14} /> {t("一键推荐策略", "Recommended policy")}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> {t("导入", "Import")}</button>
                <button className="btn btn-ghost btn-sm" onClick={exportConfig}><Download size={14} /> {t("导出", "Export")}</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
                  <Save size={14} /> {saving ? t("保存中…", "Saving…") : t("保存并热重载", "Save & reload")}
                </button>
              </div>
            }
          />
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 360,
              resize: "vertical",
              padding: 16,
              borderRadius: "var(--r-md)",
              background: "rgba(0,0,0,0.28)",
              border: "1px solid var(--hairline)",
              color: "var(--t1)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.7,
              outline: "none",
            }}
          />
        </GlassCard>

        <GlassCard>
          <CardHead icon={<Archive size={18} color="var(--green)" />} title={t("备份概览", "Backup Overview")} />
          <div className="col">
            <div className="kv"><span className="k">{t("备份总数", "Total backups")}</span><span className="v">{backups.length}</span></div>
            <div className="kv"><span className="k">{t("最近备份", "Latest backup")}</span><span className="v">{recent}</span></div>
            <div className="kv"><span className="k">{t("自动备份", "Auto-backup")}</span><span className="v"><Pill tone="green" dot>{t("保存前自动", "Before each save")}</Pill></span></div>
            <div className="kv"><span className="k">{t("保留策略", "Retention")}</span><span className="v">{t("最近 20 份", "Last 20")}</span></div>
            <button className="btn btn-ghost mt-4" style={{ width: "100%" }} onClick={() => setBackupOpen(true)}><Save size={15} /> {t("立即手动备份", "Manual backup now")}</button>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <CardHead icon={<Clock size={18} color="var(--purple)" />} title={t("备份历史", "Backup History")} sub={t("可一键恢复或回滚到任意版本", "Restore or roll back to any version with one click")} />
        <table className="table">
          <thead>
            <tr>
              <th>{t("备份", "Backup")}</th>
              <th>{t("说明", "Note")}</th>
              <th>{t("时间", "Time")}</th>
              <th>{t("大小", "Size")}</th>
              <th style={{ textAlign: "right" }}>{t("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{b.name}</span>
                    {b.current && <Pill tone="blue">{t("最新", "Latest")}</Pill>}
                  </span>
                </td>
                <td className="muted">{b.note}</td>
                <td className="mono muted-2">{b.time}</td>
                <td className="mono muted-2">{b.size}</td>
                <td style={{ textAlign: "right" }}>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRestoreTarget(b)}><RotateCcw size={13} /> {t("恢复", "Restore")}</button>
                    <a className="icon-btn" style={{ width: 30, height: 30 }} title={t("下载", "Download")} href={api.backupDownloadUrl(b.id)}><Download size={14} /></a>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} title={t("删除", "Delete")} onClick={() => setDelTarget(b)}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {backups.length === 0 && (
          <div className="empty"><Archive size={28} /><p>{t("暂无备份，保存配置或点「立即手动备份」会自动生成", "No backups yet. Saving the config or clicking \u201cManual backup now\u201d creates one.")}</p></div>
        )}
      </GlassCard>

      {tplOpen && (
        <ConfirmDialog
          title={t("应用推荐策略模板", "Apply Recommended Policy")}
          busy={tplBusy}
          confirmText={tplBusy ? t("生成中…", "Generating…") : t("应用", "Apply")}
          message={
            <>
              {t("将", "This will ")}<b style={{ color: "var(--t1)" }}>{t("重写", "rewrite")}</b>{t(" proxy-groups 与 rules：生成地区分组(港/美/日/新/台/韩)、自动选择、分类分流(AI/YouTube/流媒体/Telegram/Google…) + 内置 GEOSITE 规则，并把当前已启用订阅自动纳入。其余配置(DNS/TUN/订阅)保持不变，", " proxy-groups and rules: region groups (HK/US/JP/SG/TW/KR), auto-select, category routing (AI/YouTube/streaming/Telegram/Google…) + built-in GEOSITE rules, including currently enabled subscriptions. Other config (DNS/TUN/subs) is untouched, ")}
              <b style={{ color: "var(--t1)" }}>{t("生成前会自动备份", "auto-backed up beforehand")}</b>{t("。确定继续？", ". Continue?")}
            </>
          }
          onConfirm={applyTemplate}
          onCancel={() => !tplBusy && setTplOpen(false)}
        />
      )}

      {backupOpen && (
        <PromptDialog
          title={t("立即手动备份", "Manual Backup")}
          sub={t("为当前配置生成一份可回滚的快照", "Create a rollback snapshot of the current config")}
          label={t("备份说明（可选）", "Note (optional)")}
          placeholder={t("手动备份", "Manual backup")}
          defaultValue={t("手动备份", "Manual backup")}
          confirmText={t("备份", "Backup")}
          onConfirm={backupNow}
          onCancel={() => setBackupOpen(false)}
        />
      )}

      {restoreTarget && (
        <ConfirmDialog
          title={t("恢复备份", "Restore Backup")}
          busy={busy}
          confirmText={busy ? t("恢复中…", "Restoring…") : t("恢复", "Restore")}
          message={<>{t("确定恢复到「", "Restore the backup from \u201c")}<b style={{ color: "var(--t1)" }}>{restoreTarget.time}</b>{t("」这份备份？恢复前会自动备份当前配置。", "\u201d? The current config is auto-backed up first.")}</>}
          onConfirm={restore}
          onCancel={() => !busy && setRestoreTarget(null)}
        />
      )}

      {delTarget && (
        <ConfirmDialog
          title={t("删除备份", "Delete Backup")}
          danger
          busy={busy}
          confirmText={busy ? t("删除中…", "Deleting…") : t("删除", "Delete")}
          message={<>{t("确定删除备份「", "Delete backup \u201c")}<b style={{ color: "var(--t1)" }}>{delTarget.name}</b>{t("」（", "\u201d (")}{delTarget.time}{t("）？此操作不可撤销。", ")? This cannot be undone.")}</>}
          onConfirm={del}
          onCancel={() => !busy && setDelTarget(null)}
        />
      )}
    </>
  );
}
