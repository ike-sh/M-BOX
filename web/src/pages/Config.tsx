import { useEffect, useRef, useState } from "react";
import { Archive, Download, Upload, RotateCcw, Trash2, FileCode2, Clock, Save, Sparkles } from "lucide-react";
import { GlassCard, CardHead, Pill, PromptDialog, ConfirmDialog } from "../components/ui";
import { api } from "../lib/api";

interface Backup {
  id: string;
  name: string;
  note: string;
  time: string;
  size: string;
  current: boolean;
}

export function Config() {
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
      setNotice({ kind: "ok", text: "配置已保存并热重载成功" });
      setTimeout(() => setNotice(null), 4000);
    }
  }

  async function backupNow(note: string) {
    await api.createBackup(note || "手动备份");
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
        setNotice({ kind: "ok", text: `已应用推荐策略（纳入 ${r.providers} 个订阅）并热重载` });
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
            title="当前配置"
            sub={dirty ? "已修改，未保存" : "/etc/mbox/config.yaml"}
            right={
              <div className="row gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setTplOpen(true)} title="生成地区分组 + 分类分流 + 内置 GEOSITE 规则"><Sparkles size={14} /> 一键推荐策略</button>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入</button>
                <button className="btn btn-ghost btn-sm" onClick={exportConfig}><Download size={14} /> 导出</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
                  <Save size={14} /> {saving ? "保存中…" : "保存并热重载"}
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
          <CardHead icon={<Archive size={18} color="var(--green)" />} title="备份概览" />
          <div className="col">
            <div className="kv"><span className="k">备份总数</span><span className="v">{backups.length}</span></div>
            <div className="kv"><span className="k">最近备份</span><span className="v">{recent}</span></div>
            <div className="kv"><span className="k">自动备份</span><span className="v"><Pill tone="green" dot>保存前自动</Pill></span></div>
            <div className="kv"><span className="k">保留策略</span><span className="v">最近 20 份</span></div>
            <button className="btn btn-ghost mt-4" style={{ width: "100%" }} onClick={() => setBackupOpen(true)}><Save size={15} /> 立即手动备份</button>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <CardHead icon={<Clock size={18} color="var(--purple)" />} title="备份历史" sub="可一键恢复或回滚到任意版本" />
        <table className="table">
          <thead>
            <tr>
              <th>备份</th>
              <th>说明</th>
              <th>时间</th>
              <th>大小</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{b.name}</span>
                    {b.current && <Pill tone="blue">最新</Pill>}
                  </span>
                </td>
                <td className="muted">{b.note}</td>
                <td className="mono muted-2">{b.time}</td>
                <td className="mono muted-2">{b.size}</td>
                <td style={{ textAlign: "right" }}>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRestoreTarget(b)}><RotateCcw size={13} /> 恢复</button>
                    <a className="icon-btn" style={{ width: 30, height: 30 }} title="下载" href={api.backupDownloadUrl(b.id)}><Download size={14} /></a>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} title="删除" onClick={() => setDelTarget(b)}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {backups.length === 0 && (
          <div className="empty"><Archive size={28} /><p>暂无备份，保存配置或点「立即手动备份」会自动生成</p></div>
        )}
      </GlassCard>

      {tplOpen && (
        <ConfirmDialog
          title="应用推荐策略模板"
          busy={tplBusy}
          confirmText={tplBusy ? "生成中…" : "应用"}
          message={
            <>
              将<b style={{ color: "var(--t1)" }}>重写</b> proxy-groups 与 rules：生成
              地区分组(港/美/日/新/台/韩)、自动选择、分类分流(AI/YouTube/流媒体/Telegram/Google…) +
              内置 GEOSITE 规则，并把当前已启用订阅自动纳入。其余配置(DNS/TUN/订阅)保持不变，
              <b style={{ color: "var(--t1)" }}>生成前会自动备份</b>。确定继续？
            </>
          }
          onConfirm={applyTemplate}
          onCancel={() => !tplBusy && setTplOpen(false)}
        />
      )}

      {backupOpen && (
        <PromptDialog
          title="立即手动备份"
          sub="为当前配置生成一份可回滚的快照"
          label="备份说明（可选）"
          placeholder="手动备份"
          defaultValue="手动备份"
          confirmText="备份"
          onConfirm={backupNow}
          onCancel={() => setBackupOpen(false)}
        />
      )}

      {restoreTarget && (
        <ConfirmDialog
          title="恢复备份"
          busy={busy}
          confirmText={busy ? "恢复中…" : "恢复"}
          message={<>确定恢复到「<b style={{ color: "var(--t1)" }}>{restoreTarget.time}</b>」这份备份？恢复前会自动备份当前配置。</>}
          onConfirm={restore}
          onCancel={() => !busy && setRestoreTarget(null)}
        />
      )}

      {delTarget && (
        <ConfirmDialog
          title="删除备份"
          danger
          busy={busy}
          confirmText={busy ? "删除中…" : "删除"}
          message={<>确定删除备份「<b style={{ color: "var(--t1)" }}>{delTarget.name}</b>」（{delTarget.time}）？此操作不可撤销。</>}
          onConfirm={del}
          onCancel={() => !busy && setDelTarget(null)}
        />
      )}
    </>
  );
}
