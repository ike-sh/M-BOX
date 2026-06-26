import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check, X, AlertTriangle } from "lucide-react";
import { useI18n } from "../lib/i18n";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Select 是与 Liquid Glass 风格一致的自定义下拉，替代样式无法自定义的原生 <select>
 *（原生弹层为系统直角白底，与玻璃圆角风格不匹配）。
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = options.find((o) => o.value === value);
  return (
    <div className="cselect" ref={ref}>
      <button type="button" className="cselect-trigger" onClick={() => setOpen((o) => !o)}>
        <span className={cur && cur.label ? "" : "muted-2"}>{cur ? cur.label || t("（无）", "(none)") : (placeholder ?? t("请选择", "Select..."))}</span>
        <ChevronDown size={15} className={`cselect-chev ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div className="cselect-menu">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`cselect-opt ${o.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label || t("（无）", "(none)")}</span>
              {o.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={() => onChange?.(!on)}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onChange?.(!on)}
    >
      <div className="knob" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Tone = "green" | "blue" | "orange" | "red" | "purple" | "gray";
export function Pill({ tone = "gray", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className="dot" style={{ background: "currentColor" }} />}
      {children}
    </span>
  );
}

export function GlassCard({
  className = "",
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`glass card ${className}`} style={style}>
      {children}
    </div>
  );
}

/**
 * Modal 是与 Liquid Glass 风格一致的居中弹窗，替代浏览器原生 prompt/confirm/alert
 *（原生弹窗为系统直角白底，与玻璃圆角风格不匹配）。
 * 支持点击遮罩 / Esc 关闭。
 */
export function Modal({
  title,
  sub,
  icon,
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { t } = useI18n();
  // 收回动画：关闭时先播放退出动效，待动画结束(150ms)再真正卸载，避免「秒消失」。
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 150);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  return (
    <div className={`modal-overlay${closing ? " closing" : ""}`} onMouseDown={close}>
      <div
        className={`glass modal${closing ? " closing" : ""}`}
        style={{ width: "min(92vw, " + width + "px)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          {icon}
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <span className="card-title">{title}</span>
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={close} aria-label={t("关闭", "Close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** FormField 是表单里的「标签 + 控件」纵向单元。 */
export function FormField({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="col" style={{ gap: 6 }}>
      {label && <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{label}</span>}
      {children}
      {hint && <span className="muted-2" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
}

/** InlineError 是表单里统一风格的内联错误提示条。 */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, color: "var(--red)", background: "rgba(255,69,58,0.1)", padding: "8px 12px", borderRadius: "var(--r-xs)" }}>
      {children}
    </div>
  );
}

/**
 * PromptDialog 是统一风格的单行输入弹窗，替代原生 prompt。
 * onConfirm 可返回 Promise，期间按钮进入 loading 态。
 */
export function PromptDialog({
  title,
  sub,
  label,
  hint,
  placeholder,
  defaultValue = "",
  confirmText,
  mono,
  validate,
  onConfirm,
  onCancel,
}: {
  title: string;
  sub?: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  mono?: boolean;
  validate?: (v: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [val, setVal] = useState(defaultValue);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = val.trim();
    if (validate) {
      const e = validate(v);
      if (e) { setErr(e); return; }
    }
    setBusy(true);
    try {
      await onConfirm(v);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      sub={sub}
      width={420}
      onClose={() => !busy && onCancel()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t("取消", "Cancel")}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{confirmText ?? t("确认", "Confirm")}</button>
        </>
      }
    >
      <FormField label={label} hint={hint}>
        <input
          className="input"
          autoFocus
          placeholder={placeholder}
          value={val}
          style={mono ? { fontFamily: "var(--font-mono)", fontSize: 12.5 } : undefined}
          onChange={(e) => { setVal(e.target.value); setErr(null); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </FormField>
      {err && <InlineError>{err}</InlineError>}
    </Modal>
  );
}

/** ConfirmDialog 是统一风格的确认弹窗，替代原生 confirm。 */
export function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={title}
      width={400}
      onClose={onCancel}
      icon={
        <span
          className="stat-ico"
          style={{ width: 36, height: 36, background: danger ? "linear-gradient(135deg,#ff453a,#ff9f0a)" : "var(--accent-grad)" }}
        >
          <AlertTriangle size={17} />
        </span>
      }
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelText ?? t("取消", "Cancel")}</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {confirmText ?? t("确认", "Confirm")}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: "var(--t2)", lineHeight: 1.7 }}>{message}</div>
    </Modal>
  );
}

export function CardHead({
  icon,
  title,
  sub,
  right,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="card-head">
      {icon}
      <div className="col">
        <span className="card-title">{title}</span>
        {sub && <span className="card-sub">{sub}</span>}
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}
