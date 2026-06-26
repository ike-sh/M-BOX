import { useEffect, useMemo, useState } from "react";
import { ListFilter, Search, Database, RefreshCw, FileText, Plus, Trash2, Pencil } from "lucide-react";
import { GlassCard, CardHead, Pill, Switch, Modal, FormField, Select, ConfirmDialog, InlineError } from "../components/ui";
import { api } from "../lib/api";
import { Config } from "./Config";
import { useI18n } from "../lib/i18n";
import type { RuleItem, RuleProvider } from "../types";

function ruleRaw(r: RuleItem): string {
  return r.payload ? `${r.type},${r.payload},${r.target}` : `${r.type},${r.target}`;
}

const RULE_TYPES = [
  "DOMAIN-SUFFIX", "DOMAIN", "DOMAIN-KEYWORD", "GEOSITE",
  "IP-CIDR", "IP-CIDR6", "GEOIP", "SRC-IP-CIDR",
  "DST-PORT", "SRC-PORT", "PROCESS-NAME", "MATCH",
].map((t) => ({ value: t, label: t }));

const BASE_TARGETS = ["PROXY", "DIRECT", "REJECT"];

// 常用分流分类：每一项直接对应 config.yaml 里的一条内置 GEOSITE/GEOIP 规则。
// 开关状态 = config 里是否存在该规则（payload 匹配）；拨动即增删该规则并热重载——
// 所以这是「配置文件的可视化开关」，不是另写一套，和「分流规则」Tab 是同一份 config。
type RuleCat = {
  label: string;
  en: string;
  type: "GEOSITE" | "GEOIP";
  payload: string; // 与 config 规则的 payload 一致（如 youtube / category-ads-all / cn）
  defaultTarget: string; // 该分类启用时默认走的出站组（按内置 default.yaml 组名；不存在会回退）
};

const RULE_CATS: RuleCat[] = [
  { label: "🛑 广告拦截", en: "🛑 Ad Block", type: "GEOSITE", payload: "category-ads-all", defaultTarget: "REJECT" },
  { label: "🏠 私有网络", en: "🏠 Private", type: "GEOSITE", payload: "private", defaultTarget: "🎯 全球直连" },
  { label: "💬 即时通讯", en: "💬 Messaging", type: "GEOSITE", payload: "category-communication", defaultTarget: "💬 即时通讯" },
  { label: "🌐 社交媒体", en: "🌐 Social", type: "GEOSITE", payload: "category-social-media-!cn", defaultTarget: "🌐 社交媒体" },
  { label: "🚀 GitHub", en: "🚀 GitHub", type: "GEOSITE", payload: "github", defaultTarget: "🚀 GitHub" },
  { label: "🤖 ChatGPT", en: "🤖 ChatGPT", type: "GEOSITE", payload: "openai", defaultTarget: "🤖 ChatGPT" },
  { label: "🤖 AI 服务", en: "🤖 AI Services", type: "GEOSITE", payload: "category-ai-!cn", defaultTarget: "🤖 AI服务" },
  { label: "🎶 TikTok", en: "🎶 TikTok", type: "GEOSITE", payload: "tiktok", defaultTarget: "🎶 TikTok" },
  { label: "📹 YouTube", en: "📹 YouTube", type: "GEOSITE", payload: "youtube", defaultTarget: "📹 YouTube" },
  { label: "🎥 Netflix", en: "🎥 Netflix", type: "GEOSITE", payload: "netflix", defaultTarget: "🎥 Netflix" },
  { label: "🎥 Disney+", en: "🎥 Disney+", type: "GEOSITE", payload: "disney", defaultTarget: "🎥 DisneyPlus" },
  { label: "🇬 谷歌服务", en: "🇬 Google", type: "GEOSITE", payload: "google", defaultTarget: "🇬 谷歌服务" },
  { label: "🍎 苹果服务", en: "🍎 Apple", type: "GEOSITE", payload: "apple", defaultTarget: "🍎 苹果服务" },
  { label: "Ⓜ️ 微软服务", en: "Ⓜ️ Microsoft", type: "GEOSITE", payload: "microsoft", defaultTarget: "Ⓜ️ 微软服务" },
  { label: "🎮 Steam", en: "🎮 Steam", type: "GEOSITE", payload: "steam", defaultTarget: "🎮 Steam" },
  { label: "🌍 国外网站", en: "🌍 Foreign sites", type: "GEOSITE", payload: "geolocation-!cn", defaultTarget: "🚀 手动选择" },
  { label: "🇨🇳 国内域名", en: "🇨🇳 China domains", type: "GEOSITE", payload: "cn", defaultTarget: "🎯 全球直连" },
  { label: "🇨🇳 国内 IP", en: "🇨🇳 China IP", type: "GEOIP", payload: "cn", defaultTarget: "🎯 全球直连" },
  { label: "✈️ Telegram IP", en: "✈️ Telegram IP", type: "GEOIP", payload: "telegram", defaultTarget: "💬 即时通讯" },
];

function catRuleOf(rules: RuleItem[], cat: RuleCat): RuleItem | undefined {
  return rules.find((r) => r.type === cat.type && r.payload === cat.payload);
}

const targetTone = (t: string): any => {
  if (t === "DIRECT") return "green";
  if (t === "REJECT") return "red";
  if (t === "PROXY" || t === "AUTO") return "blue";
  return "purple";
};

export function Rules() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"rules" | "ruleset" | "config">("rules");
  const [q, setQ] = useState("");
  const [rawRules, setRawRules] = useState<RuleItem[]>([]);
  const [ruleProviders, setRuleProviders] = useState<RuleProvider[]>([]);
  const [groups, setGroups] = useState<string[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ type: "DOMAIN-SUFFIX", payload: "", target: "PROXY" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<RuleItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<RuleItem | null>(null);
  const [editForm, setEditForm] = useState({ type: "DOMAIN-SUFFIX", payload: "", target: "PROXY" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [updatingOne, setUpdatingOne] = useState<string | null>(null);

  // 分类开关：进行中标记、GEO 更新状态、提示。
  const [togglingCat, setTogglingCat] = useState<string | null>(null);
  const [updatingGeo, setUpdatingGeo] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const [addRpOpen, setAddRpOpen] = useState(false);
  const [rpForm, setRpForm] = useState({ name: "", url: "", behavior: "domain", format: "mrs", target: "PROXY", interval: 24 });
  const [savingRp, setSavingRp] = useState(false);
  const [rpError, setRpError] = useState<string | null>(null);
  const [delRp, setDelRp] = useState<string | null>(null);
  const [deletingRp, setDeletingRp] = useState(false);

  function reload() {
    api.getRules().then(({ rules, providers }) => {
      setRawRules(rules);
      setRuleProviders(providers);
    });
  }
  useEffect(() => {
    reload();
    api.getProxies().then((p) => setGroups(p.groups.map((g) => g.name)));
  }, []);
  // 「分流规则」Tab 下每 5s 刷新一次，更新每条规则的实时命中数（当前活动连接派生）。
  useEffect(() => {
    if (tab !== "rules") return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [tab]);

  const targets = [...groups, ...BASE_TARGETS.filter((t) => !groups.includes(t))].map((t) => ({ value: t, label: t }));
  const isMatch = form.type === "MATCH";

  // 启用某分类时挑选出站组：默认组存在(或为内置 REJECT/DIRECT/PROXY)则用之，否则回退到
  // 第一个非直连组，避免规则指向不存在的策略组导致内核加载失败。
  function resolveTarget(def: string): string {
    if (["REJECT", "DIRECT", "PROXY"].includes(def) || groups.includes(def)) return def;
    return groups.find((g) => g !== "🎯 全球直连" && g !== "DIRECT") || def;
  }

  function openAdd() {
    setForm({ type: "DOMAIN-SUFFIX", payload: "", target: "PROXY" });
    setAddError(null);
    setAddOpen(true);
  }
  async function submitAdd() {
    const payload = isMatch ? "" : form.payload.trim();
    if (!isMatch && !payload) { setAddError(t("请填写匹配内容", "Please enter the match content")); return; }
    if (!form.target) { setAddError(t("请选择出站策略", "Please choose an outbound")); return; }
    setSaving(true);
    setAddError(null);
    try {
      await api.addRule({ type: form.type, payload, target: form.target });
      setAddOpen(false);
      reload();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t("添加失败", "Add failed"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDel() {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await api.deleteRule(ruleRaw(delTarget));
      setDelTarget(null);
      reload();
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(r: RuleItem) {
    setEditForm({ type: r.type, payload: r.payload || "", target: r.target });
    setEditError(null);
    setEditTarget(r);
  }
  async function submitEdit() {
    if (!editTarget) return;
    const isM = editForm.type === "MATCH";
    const payload = isM ? "" : editForm.payload.trim();
    if (!isM && !payload) { setEditError(t("请填写匹配内容", "Please enter the match content")); return; }
    if (!editForm.target) { setEditError(t("请选择出站策略", "Please choose an outbound")); return; }
    setSavingEdit(true);
    setEditError(null);
    try {
      await api.updateRule({ old: ruleRaw(editTarget), type: editForm.type, payload, target: editForm.target });
      setEditTarget(null);
      reload();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("更新失败", "Update failed"));
    } finally {
      setSavingEdit(false);
    }
  }

  // 拨动分类开关：开 = 往 config 加该 GEOSITE/GEOIP 规则；关 = 删除它。随后热重载。
  async function toggleCat(cat: RuleCat, on: boolean) {
    const id = cat.type + ":" + cat.payload;
    if (togglingCat) return;
    setTogglingCat(id);
    setGeoMsg(null);
    try {
      if (on) {
        await api.addRule({ type: cat.type, payload: cat.payload, target: resolveTarget(cat.defaultTarget) });
      } else {
        const r = catRuleOf(rawRules, cat);
        if (r) await api.deleteRule(ruleRaw(r));
      }
      setTimeout(reload, 500);
    } catch (e) {
      setGeoMsg(e instanceof Error ? e.message : t("操作失败", "Operation failed"));
      setTimeout(() => setGeoMsg(null), 5000);
    } finally {
      setTimeout(() => setTogglingCat(null), 500);
    }
  }

  // 更新内置 GEO 数据库（geoip.dat/geosite.dat）并热加载——分类规则的归类依赖它。
  async function updateGeo() {
    if (updatingGeo) return;
    setUpdatingGeo(true);
    setGeoMsg(null);
    try {
      await api.updateGeo();
      setGeoMsg(t("✓ GEO 数据已更新并热加载", "✓ GEO data updated & hot-loaded"));
      setTimeout(reload, 600);
      setTimeout(() => setGeoMsg(null), 4000);
    } catch (e) {
      setGeoMsg(e instanceof Error ? e.message : t("更新失败（内核未运行或下载超时）", "Update failed (kernel not running or download timed out)"));
      setTimeout(() => setGeoMsg(null), 6000);
    } finally {
      setUpdatingGeo(false);
    }
  }

  async function updateOne(name: string) {
    if (updatingOne) return;
    setUpdatingOne(name);
    try {
      await api.updateRuleProvider(name);
      setTimeout(reload, 500);
    } finally {
      setUpdatingOne(null);
    }
  }

  function openAddRp() {
    setRpForm({ name: "", url: "", behavior: "domain", format: "mrs", target: "PROXY", interval: 24 });
    setRpError(null);
    setAddRpOpen(true);
  }
  async function submitAddRp() {
    const name = rpForm.name.trim();
    const url = rpForm.url.trim();
    if (!name) { setRpError(t("请填写规则集名称", "Please enter a rule-set name")); return; }
    if (!url) { setRpError(t("请填写订阅 URL", "Please enter the subscription URL")); return; }
    if (!rpForm.target) { setRpError(t("请选择出站策略", "Please choose an outbound")); return; }
    setSavingRp(true);
    setRpError(null);
    try {
      const interval = Math.max(1, Math.round(rpForm.interval || 24)) * 3600; // 小时 → 秒
      await api.addRuleProvider({ name, url, behavior: rpForm.behavior, format: rpForm.format, target: rpForm.target, interval });
      setAddRpOpen(false);
      setTimeout(reload, 600);
    } catch (e) {
      setRpError(e instanceof Error ? e.message : t("添加失败", "Add failed"));
    } finally {
      setSavingRp(false);
    }
  }
  async function confirmDelRp() {
    if (!delRp) return;
    setDeletingRp(true);
    try {
      await api.deleteRuleProvider(delRp);
      setDelRp(null);
      setTimeout(reload, 500);
    } finally {
      setDeletingRp(false);
    }
  }

  const filtered = useMemo(
    () => rawRules.filter((r) => !q || r.payload.includes(q) || r.target.includes(q) || r.type.includes(q.toUpperCase())),
    [q, rawRules]
  );
  const matchRule = rawRules.find((r) => r.type === "MATCH");
  const enabledCatCount = RULE_CATS.filter((c) => catRuleOf(rawRules, c)).length;

  return (
    <div className="page">
      <div className="grid cols-3">
        <Mini icon={<ListFilter size={18} />} c="#0a84ff" label={t("规则条数", "Rules")} value={String(rawRules.length)} />
        <Mini icon={<Database size={18} />} c="#bf5af2" label={t("启用分类", "Enabled cats")} value={`${enabledCatCount}/${RULE_CATS.length}`} />
        <Mini icon={<FileText size={18} />} c="#30d158" label={t("兜底策略", "Fallback")} value={matchRule?.target ?? "—"} />
      </div>

      <div className="row gap-2" style={{ marginTop: 2 }}>
        {([
          { k: "rules", label: t("分流规则", "Rules") },
          { k: "ruleset", label: t("规则集", "Rule-sets") },
          { k: "config", label: t("配置源码", "Raw config") },
        ] as const).map((t) => (
          <button key={t.k} className={`btn btn-sm ${tab === t.k ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ruleset" && (
      <GlassCard>
        <CardHead
          icon={<Database size={18} color="var(--purple)" />}
          title={t("规则分类（开关 = 配置里的分流规则）", "Rule categories (toggle = a rule in your config)")}
          sub={t("每个开关直接对应 config 内置 GEOSITE/GEOIP 规则 · 拨动即增删并热重载 · 已启用的来自你当前配置", "Each toggle maps to a built-in GEOSITE/GEOIP rule in config · toggling adds/removes & hot-reloads · enabled ones reflect your current config")}
          right={
            <div className="row gap-2" style={{ alignItems: "center" }}>
              {geoMsg && <span style={{ fontSize: 12, color: geoMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{geoMsg}</span>}
              <button className="btn btn-ghost btn-sm" onClick={updateGeo} disabled={updatingGeo} title={t("重新下载 geoip.dat/geosite.dat 并热加载（分类规则的归类依赖它）", "Re-download geoip.dat/geosite.dat & hot-load (categories depend on it)")}>
                <RefreshCw size={14} className={updatingGeo ? "spin" : ""} /> {updatingGeo ? t("更新中…", "Updating…") : t("更新 GEO 数据", "Update GEO")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={openAddRp}><Plus size={14} /> {t("自定义规则集", "Custom rule-set")}</button>
            </div>
          }
        />
        <div className="grid cols-2">
          {RULE_CATS.map((cat) => {
            const id = cat.type + ":" + cat.payload;
            const live = catRuleOf(rawRules, cat);
            const on = !!live;
            return (
              <div
                key={id}
                className="row between"
                style={{ gap: 10, padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--fill-2)", border: `1px solid ${on ? "rgba(48,209,88,0.32)" : "var(--hairline)"}` }}
              >
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "en" ? cat.en : cat.label}</span>
                    <Pill tone={cat.type === "GEOIP" ? "orange" : "blue"}>{cat.type}</Pill>
                  </div>
                  <span className="muted-2 mono" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cat.payload} → {live ? live.target : cat.defaultTarget}
                  </span>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {togglingCat === id ? (
                    <RefreshCw size={15} className="spin" />
                  ) : (
                    <Switch on={on} onChange={(v) => toggleCat(cat, v)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {ruleProviders.length > 0 && (
          <>
            <div style={{ margin: "16px 0 8px", fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t("自定义规则集 (rule-providers)", "Custom rule-sets (rule-providers)")}</div>
            <div className="grid cols-4">
              {ruleProviders.map((p) => (
                <div key={p.name} className="col" style={{ gap: 8, padding: 14, borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)" }}>
                  <div className="row between">
                    <span style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <div className="row" style={{ gap: 6 }}>
                      <Pill tone={p.behavior === "ipcidr" ? "orange" : "blue"}>{p.behavior}</Pill>
                      <button className="icon-btn" style={{ width: 26, height: 26 }} title={t("立即更新该规则集", "Update this rule-set now")} onClick={() => updateOne(p.name)} disabled={updatingOne === p.name}>
                        <RefreshCw size={13} className={updatingOne === p.name ? "spin" : ""} />
                      </button>
                      <button className="icon-btn" style={{ width: 26, height: 26 }} title={t("删除该规则集", "Delete this rule-set")} onClick={() => setDelRp(p.name)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{p.count.toLocaleString()}</span>
                  <span className="muted-2" style={{ fontSize: 11 }}>{p.type} · {p.updatedAt ? `${t("更新于", "updated")} ${p.updatedAt}${t("前", " ago")}` : t("待内核加载", "pending kernel load")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </GlassCard>
      )}

      {tab === "rules" && (
      <GlassCard>
        <CardHead
          icon={<ListFilter size={18} color="var(--blue)" />}
          title={t("分流规则", "Routing Rules")}
          sub={t("按优先级从上到下匹配 · 命中 = 当前活动连接数（每 5s 刷新）", "Matched top-down by priority · hits = current active connections (refresh every 5s)")}
          right={
            <div className="row gap-2">
              <div className="row" style={{ background: "var(--fill-2)", border: "1px solid var(--hairline)", borderRadius: "var(--r-sm)", padding: "0 12px", height: 34 }}>
                <Search size={15} color="var(--t3)" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("搜索规则", "Search rules")}
                  style={{ background: "transparent", border: "none", outline: "none", color: "var(--t1)", fontSize: 13, width: 160, marginLeft: 8, fontFamily: "inherit" }}
                />
              </div>
              <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> {t("添加规则", "Add Rule")}</button>
            </div>
          }
        />
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>{t("类型", "Type")}</th>
              <th>{t("匹配内容", "Match")}</th>
              <th>{t("出站", "Outbound")}</th>
              <th style={{ textAlign: "right", width: 64 }}>{t("命中", "Hits")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.type + r.payload + i}>
                <td className="muted-2 mono">{i + 1}</td>
                <td><span className="mono muted" style={{ fontSize: 11.5 }}>{r.type}</span></td>
                <td style={{ fontWeight: r.type === "MATCH" ? 400 : 600 }}>{r.payload || <span className="muted-2">{t("（兜底）", "(fallback)")}</span>}</td>
                <td><Pill tone={targetTone(r.target)}>{r.target}</Pill></td>
                <td style={{ textAlign: "right" }}>
                  {r.hit ? <span className="mono" style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>{r.hit}</span> : <span className="muted-2" style={{ fontSize: 11 }}>—</span>}
                </td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} title={t("编辑规则", "Edit rule")} onClick={() => openEdit(r)}><Pencil size={13} /></button>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} title={t("删除规则", "Delete rule")} onClick={() => setDelTarget(r)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
      )}

      {tab === "config" && <Config />}

      {addOpen && (
        <Modal
          title={t("添加分流规则", "Add Routing Rule")}
          sub={t("新规则会插入到 MATCH 兜底之前", "New rule is inserted before the MATCH fallback")}
          width={460}
          onClose={() => !saving && setAddOpen(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "var(--accent-grad)" }}><ListFilter size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setAddOpen(false)} disabled={saving}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={submitAdd} disabled={saving} style={{ gap: 8 }}>
                {saving ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
                {saving ? t("添加中…", "Adding…") : t("添加规则", "Add Rule")}
              </button>
            </>
          }
        >
          <FormField label={t("规则类型", "Rule type")}>
            <Select value={form.type} options={RULE_TYPES} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
          </FormField>
          {!isMatch && (
            <FormField label={t("匹配内容", "Match content")} hint={t("如 openai.com / 142.250.0.0/15 / google", "e.g. openai.com / 142.250.0.0/15 / google")}>
              <input
                className="input"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                placeholder="openai.com"
                value={form.payload}
                autoFocus
                onChange={(e) => setForm((f) => ({ ...f, payload: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              />
            </FormField>
          )}
          <FormField label={t("出站策略", "Outbound")}>
            <Select value={form.target} options={targets} onChange={(v) => setForm((f) => ({ ...f, target: v }))} />
          </FormField>
          {addError && <InlineError>{addError}</InlineError>}
        </Modal>
      )}

      {delTarget && (
        <ConfirmDialog
          title={t("删除规则", "Delete Rule")}
          danger
          busy={deleting}
          confirmText={deleting ? t("删除中…", "Deleting…") : t("删除", "Delete")}
          message={<>{t("确定删除规则 ", "Delete rule ")}<b className="mono" style={{ color: "var(--t1)" }}>{ruleRaw(delTarget)}</b>{t("？", "?")}</>}
          onConfirm={confirmDel}
          onCancel={() => !deleting && setDelTarget(null)}
        />
      )}

      {editTarget && (
        <Modal
          title={t("编辑分流规则", "Edit Routing Rule")}
          sub={t("就地修改，保留该规则在列表中的优先级位置", "Edit in place, keeping the rule's priority position")}
          width={460}
          onClose={() => !savingEdit && setEditTarget(null)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "var(--accent-grad)" }}><Pencil size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditTarget(null)} disabled={savingEdit}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={submitEdit} disabled={savingEdit} style={{ gap: 8 }}>
                {savingEdit ? <RefreshCw size={15} className="spin" /> : <Pencil size={15} />}
                {savingEdit ? t("保存中…", "Saving…") : t("保存修改", "Save")}
              </button>
            </>
          }
        >
          <FormField label={t("规则类型", "Rule type")}>
            <Select
              value={editForm.type}
              options={RULE_TYPES.some((rt) => rt.value === editForm.type) ? RULE_TYPES : [{ value: editForm.type, label: editForm.type }, ...RULE_TYPES]}
              onChange={(v) => setEditForm((f) => ({ ...f, type: v }))}
            />
          </FormField>
          {editForm.type !== "MATCH" && (
            <FormField label={t("匹配内容", "Match content")} hint={t("如 openai.com / 142.250.0.0/15 / google", "e.g. openai.com / 142.250.0.0/15 / google")}>
              <input
                className="input"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                placeholder="openai.com"
                value={editForm.payload}
                autoFocus
                onChange={(e) => setEditForm((f) => ({ ...f, payload: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && submitEdit()}
              />
            </FormField>
          )}
          <FormField label={t("出站策略", "Outbound")}>
            <Select
              value={editForm.target}
              options={targets.some((tg) => tg.value === editForm.target) ? targets : [{ value: editForm.target, label: editForm.target }, ...targets]}
              onChange={(v) => setEditForm((f) => ({ ...f, target: v }))}
            />
          </FormField>
          {editError && <InlineError>{editError}</InlineError>}
        </Modal>
      )}

      {addRpOpen && (
        <Modal
          title={t("添加自定义规则集", "Add Custom Rule-set")}
          sub={t("远程 rule-provider（用于内置 GEOSITE 没覆盖的场景），自动追加 RULE-SET 规则到 MATCH 之前", "Remote rule-provider (for cases built-in GEOSITE doesn't cover); a RULE-SET rule is appended before MATCH")}
          width={480}
          onClose={() => !savingRp && setAddRpOpen(false)}
          icon={<span className="stat-ico" style={{ width: 36, height: 36, background: "var(--accent-grad)" }}><Database size={17} /></span>}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setAddRpOpen(false)} disabled={savingRp}>{t("取消", "Cancel")}</button>
              <button className="btn btn-primary" onClick={submitAddRp} disabled={savingRp} style={{ gap: 8 }}>
                {savingRp ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
                {savingRp ? t("添加中…", "Adding…") : t("添加规则集", "Add rule-set")}
              </button>
            </>
          }
        >
          <FormField label={t("名称", "Name")} hint={t("唯一标识，如 reject-ad / cn-ip", "Unique id, e.g. reject-ad / cn-ip")}>
            <input
              className="input"
              placeholder="reject-ad"
              value={rpForm.name}
              autoFocus
              onChange={(e) => setRpForm((f) => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <FormField label={t("订阅 URL", "Subscription URL")}>
            <input
              className="input"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
              placeholder="https://example.com/ruleset.mrs"
              value={rpForm.url}
              onChange={(e) => setRpForm((f) => ({ ...f, url: e.target.value }))}
            />
          </FormField>
          <div className="row gap-2">
            <FormField label={t("行为 (behavior)", "Behavior")}>
              <Select
                value={rpForm.behavior}
                options={[
                  { value: "domain", label: t("domain 域名", "domain") },
                  { value: "ipcidr", label: t("ipcidr IP段", "ipcidr") },
                  { value: "classical", label: t("classical 综合", "classical") },
                ]}
                onChange={(v) => setRpForm((f) => ({ ...f, behavior: v }))}
              />
            </FormField>
            <FormField label={t("格式 (format)", "Format")}>
              <Select
                value={rpForm.format}
                options={[
                  { value: "mrs", label: "mrs" },
                  { value: "yaml", label: "yaml" },
                  { value: "text", label: "text" },
                ]}
                onChange={(v) => setRpForm((f) => ({ ...f, format: v }))}
              />
            </FormField>
          </div>
          <FormField label={t("出站策略", "Outbound")} hint={t("命中该规则集的流量走此策略", "Traffic matching this rule-set uses this outbound")}>
            <Select value={rpForm.target} options={targets} onChange={(v) => setRpForm((f) => ({ ...f, target: v }))} />
          </FormField>
          <FormField label={t("自动更新间隔（小时）", "Auto-update interval (hours)")} hint={t("到期由内核自动重新下载该规则集；默认 24 小时", "Kernel re-downloads the rule-set on expiry; default 24h")}>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="24"
              value={rpForm.interval}
              onChange={(e) => setRpForm((f) => ({ ...f, interval: Number(e.target.value) || 24 }))}
            />
          </FormField>
          {rpError && <InlineError>{rpError}</InlineError>}
        </Modal>
      )}

      {delRp && (
        <ConfirmDialog
          title={t("删除规则集", "Delete Rule-set")}
          danger
          busy={deletingRp}
          confirmText={deletingRp ? t("删除中…", "Deleting…") : t("删除", "Delete")}
          message={<>{t("确定删除规则集 ", "Delete rule-set ")}<b className="mono" style={{ color: "var(--t1)" }}>{delRp}</b>{t("？将同时移除其 RULE-SET 规则与缓存文件。", "? Its RULE-SET rule and cache file will also be removed.")}</>}
          onConfirm={confirmDelRp}
          onCancel={() => !deletingRp && setDelRp(null)}
        />
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
      <div className="stat-value" style={{ fontSize: 26 }}>{value}</div>
    </div>
  );
}
