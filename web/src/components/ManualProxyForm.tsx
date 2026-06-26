import { useMemo, useState } from "react";
import { Plus, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Switch, Select } from "./ui";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

// 字段标签 / 占位符的英文映射（避免逐个改 Field 定义）。
const LABEL_EN: Record<string, string> = {
  "节点名称": "Name", "服务器地址": "Server", "端口": "Port",
  "加密方式": "Cipher", "密码": "Password", "加密": "Cipher",
  "安全层": "Security", "指纹": "Fingerprint", "跳过证书校验": "Skip cert verify",
  "上行带宽": "Up bandwidth", "下行带宽": "Down bandwidth", "拥塞控制": "Congestion",
  "协议": "Protocol", "混淆": "Obfs", "协议参数": "Protocol param",
  "混淆参数": "Obfs param", "用户名": "Username", "传输": "Transport", "obfs 密码": "obfs password",
};
const PH_EN: Record<string, string> = {
  "如 香港-IEPL-01": "e.g. HK-IEPL-01", "域名或 IP": "domain or IP", "Host 头": "Host header",
  "如 salamander": "e.g. salamander", "如 50 Mbps": "e.g. 50 Mbps", "如 200 Mbps": "e.g. 200 Mbps",
  "如 aes-256-cfb": "e.g. aes-256-cfb", "如 auth_aes128_md5": "e.g. auth_aes128_md5",
  "如 tls1.2_ticket_auth": "e.g. tls1.2_ticket_auth", "逗号分隔，如 h3": "comma-separated, e.g. h3",
};

type Field =
  | { k: string; label: string; t: "text"; ph?: string }
  | { k: string; label: string; t: "num"; def?: number }
  | { k: string; label: string; t: "select"; opts: string[]; def?: string }
  | { k: string; label: string; t: "bool"; def?: boolean };

const PROTOCOLS = [
  "ss",
  "vmess",
  "vless",
  "trojan",
  "hysteria2",
  "hysteria",
  "tuic",
  "ssr",
  "socks5",
  "http",
];

const SS_CIPHERS = [
  "aes-256-gcm",
  "aes-128-gcm",
  "chacha20-ietf-poly1305",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "none",
];

const COMMON: Field[] = [
  { k: "name", label: "节点名称", t: "text", ph: "如 香港-IEPL-01" },
  { k: "server", label: "服务器地址", t: "text", ph: "域名或 IP" },
  { k: "port", label: "端口", t: "num", def: 443 },
];

const NET: Field = { k: "network", label: "传输", t: "select", opts: ["tcp", "ws", "grpc", "h2"], def: "tcp" };
const WS: Field[] = [
  { k: "wsPath", label: "WS path", t: "text", ph: "/path" },
  { k: "wsHost", label: "WS Host", t: "text", ph: "Host 头" },
];
const GRPC: Field = { k: "grpcServiceName", label: "gRPC serviceName", t: "text" };

// 各协议的专属字段（公共 name/server/port 之外）。
const FIELDS: Record<string, Field[]> = {
  ss: [
    { k: "cipher", label: "加密方式", t: "select", opts: SS_CIPHERS, def: "aes-256-gcm" },
    { k: "password", label: "密码", t: "text" },
    { k: "udp", label: "UDP", t: "bool", def: true },
  ],
  vmess: [
    { k: "uuid", label: "UUID", t: "text" },
    { k: "alterId", label: "alterId", t: "num", def: 0 },
    { k: "cipher", label: "加密", t: "select", opts: ["auto", "none", "aes-128-gcm", "chacha20-poly1305"], def: "auto" },
    NET,
    ...WS,
    GRPC,
    { k: "tls", label: "TLS", t: "bool" },
    { k: "servername", label: "SNI / servername", t: "text" },
    { k: "udp", label: "UDP", t: "bool", def: true },
  ],
  vless: [
    { k: "uuid", label: "UUID", t: "text" },
    { k: "flow", label: "flow", t: "select", opts: ["", "xtls-rprx-vision"], def: "" },
    { k: "security", label: "安全层", t: "select", opts: ["none", "tls", "reality"], def: "tls" },
    NET,
    ...WS,
    GRPC,
    { k: "servername", label: "SNI / servername", t: "text" },
    { k: "realityPbk", label: "Reality public-key", t: "text" },
    { k: "realitySid", label: "Reality short-id", t: "text" },
    { k: "clientFp", label: "指纹", t: "select", opts: ["", "chrome", "firefox", "safari", "ios", "random"], def: "" },
    { k: "udp", label: "UDP", t: "bool", def: true },
  ],
  trojan: [
    { k: "password", label: "密码", t: "text" },
    { k: "sni", label: "SNI", t: "text" },
    NET,
    ...WS,
    GRPC,
    { k: "skipCertVerify", label: "跳过证书校验", t: "bool" },
  ],
  hysteria2: [
    { k: "password", label: "密码", t: "text" },
    { k: "sni", label: "SNI", t: "text" },
    { k: "obfs", label: "obfs", t: "text", ph: "如 salamander" },
    { k: "obfsPassword", label: "obfs 密码", t: "text" },
    { k: "skipCertVerify", label: "跳过证书校验", t: "bool" },
  ],
  hysteria: [
    { k: "authStr", label: "auth-str", t: "text" },
    { k: "sni", label: "SNI / peer", t: "text" },
    { k: "up", label: "上行带宽", t: "text", ph: "如 50 Mbps" },
    { k: "down", label: "下行带宽", t: "text", ph: "如 200 Mbps" },
    { k: "skipCertVerify", label: "跳过证书校验", t: "bool" },
  ],
  tuic: [
    { k: "uuid", label: "UUID", t: "text" },
    { k: "password", label: "密码", t: "text" },
    { k: "sni", label: "SNI", t: "text" },
    { k: "congestion", label: "拥塞控制", t: "select", opts: ["bbr", "cubic", "new_reno"], def: "bbr" },
    { k: "alpn", label: "ALPN", t: "text", ph: "逗号分隔，如 h3" },
    { k: "skipCertVerify", label: "跳过证书校验", t: "bool" },
  ],
  ssr: [
    { k: "cipher", label: "加密方式", t: "text", ph: "如 aes-256-cfb" },
    { k: "password", label: "密码", t: "text" },
    { k: "protocol", label: "协议", t: "text", ph: "如 auth_aes128_md5" },
    { k: "obfs", label: "混淆", t: "text", ph: "如 tls1.2_ticket_auth" },
    { k: "protocolParam", label: "协议参数", t: "text" },
    { k: "obfsParam", label: "混淆参数", t: "text" },
  ],
  socks5: [
    { k: "username", label: "用户名", t: "text" },
    { k: "password", label: "密码", t: "text" },
    { k: "udp", label: "UDP", t: "bool", def: true },
  ],
  http: [
    { k: "username", label: "用户名", t: "text" },
    { k: "password", label: "密码", t: "text" },
    { k: "tls", label: "TLS (https)", t: "bool" },
  ],
};

function defaults(type: string): Record<string, any> {
  const v: Record<string, any> = {};
  for (const f of [...COMMON, ...(FIELDS[type] || [])]) {
    if (f.t === "bool") v[f.k] = f.def ?? false;
    else if (f.t === "num") v[f.k] = f.def ?? 0;
    else if (f.t === "select") v[f.k] = f.def ?? f.opts[0];
    else v[f.k] = "";
  }
  return v;
}

// addTransport 把传输层字段写进 mihomo 对象。
function addTransport(o: any, v: Record<string, any>) {
  const net = v.network;
  if (net === "ws") {
    o.network = "ws";
    const ws: any = {};
    if (v.wsPath) ws.path = v.wsPath;
    if (v.wsHost) ws.headers = { Host: v.wsHost };
    if (Object.keys(ws).length) o["ws-opts"] = ws;
  } else if (net === "grpc") {
    o.network = "grpc";
    if (v.grpcServiceName) o["grpc-opts"] = { "grpc-service-name": v.grpcServiceName };
  } else if (net && net !== "tcp") {
    o.network = net;
  }
}

function buildProxy(type: string, v: Record<string, any>): Record<string, any> {
  const base: any = { name: String(v.name || "").trim(), type, server: String(v.server || "").trim(), port: Number(v.port) };
  switch (type) {
    case "ss":
      return { ...base, cipher: v.cipher, password: v.password, udp: !!v.udp };
    case "vmess": {
      const o: any = { ...base, uuid: v.uuid, alterId: Number(v.alterId || 0), cipher: v.cipher || "auto", udp: !!v.udp };
      if (v.tls) { o.tls = true; if (v.servername) o.servername = v.servername; }
      addTransport(o, v);
      return o;
    }
    case "vless": {
      const o: any = { ...base, uuid: v.uuid, udp: !!v.udp };
      if (v.flow) o.flow = v.flow;
      if (v.security === "tls" || v.security === "reality") { o.tls = true; if (v.servername) o.servername = v.servername; }
      if (v.security === "reality") {
        const ro: any = {};
        if (v.realityPbk) ro["public-key"] = v.realityPbk;
        if (v.realitySid) ro["short-id"] = v.realitySid;
        o["reality-opts"] = ro;
      }
      if (v.clientFp) o["client-fingerprint"] = v.clientFp;
      addTransport(o, v);
      return o;
    }
    case "trojan": {
      const o: any = { ...base, password: v.password, udp: true };
      if (v.sni) o.sni = v.sni;
      if (v.skipCertVerify) o["skip-cert-verify"] = true;
      addTransport(o, v);
      return o;
    }
    case "hysteria2": {
      const o: any = { ...base, password: v.password };
      if (v.sni) o.sni = v.sni;
      if (v.skipCertVerify) o["skip-cert-verify"] = true;
      if (v.obfs) { o.obfs = v.obfs; if (v.obfsPassword) o["obfs-password"] = v.obfsPassword; }
      return o;
    }
    case "hysteria": {
      const o: any = { ...base };
      if (v.authStr) o["auth-str"] = v.authStr;
      if (v.sni) o.sni = v.sni;
      if (v.up) o.up = v.up;
      if (v.down) o.down = v.down;
      if (v.skipCertVerify) o["skip-cert-verify"] = true;
      return o;
    }
    case "tuic": {
      const o: any = { ...base, uuid: v.uuid, password: v.password };
      if (v.sni) o.sni = v.sni;
      if (v.congestion) o["congestion-controller"] = v.congestion;
      if (v.alpn) o.alpn = String(v.alpn).split(",").map((s) => s.trim()).filter(Boolean);
      if (v.skipCertVerify) o["skip-cert-verify"] = true;
      return o;
    }
    case "ssr": {
      const o: any = { ...base, cipher: v.cipher, password: v.password, protocol: v.protocol, obfs: v.obfs, udp: true };
      if (v.protocolParam) o["protocol-param"] = v.protocolParam;
      if (v.obfsParam) o["obfs-param"] = v.obfsParam;
      return o;
    }
    case "socks5": {
      const o: any = { ...base, udp: !!v.udp };
      if (v.username) o.username = v.username;
      if (v.password) o.password = v.password;
      return o;
    }
    case "http": {
      const o: any = { ...base };
      if (v.tls) o.tls = true;
      if (v.username) o.username = v.username;
      if (v.password) o.password = v.password;
      return o;
    }
    default:
      return base;
  }
}

// shouldShow 控制依赖字段的显隐（如 ws/grpc 仅在对应传输下显示，reality 字段仅在 reality 安全层下显示）。
function shouldShow(type: string, key: string, v: Record<string, any>): boolean {
  if ((key === "wsPath" || key === "wsHost") && v.network !== "ws") return false;
  if (key === "grpcServiceName" && v.network !== "grpc") return false;
  if ((key === "realityPbk" || key === "realitySid") && v.security !== "reality") return false;
  if (key === "servername" && type === "vless" && v.security === "none") return false;
  return true;
}

export function ManualProxyForm({ onAdded }: { onAdded?: (name: string) => void }) {
  const { t, lang } = useI18n();
  const [type, setType] = useState("vless");
  const [v, setV] = useState<Record<string, any>>(() => defaults("vless"));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fields = useMemo(() => [...COMMON, ...(FIELDS[type] || [])], [type]);

  function changeType(t: string) {
    setType(t);
    setV(defaults(t));
    setResult(null);
  }
  function set(k: string, val: any) {
    setV((s) => ({ ...s, [k]: val }));
  }

  async function submit() {
    if (busy) return;
    if (!String(v.server || "").trim() || !Number(v.port)) {
      setResult({ ok: false, msg: t("服务器地址和端口必填", "Server and port are required") });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const proxy = buildProxy(type, v);
      const r = await api.addManualProxy(proxy);
      if (r.count > 0) {
        const nm = r.added[0] || proxy.name;
        setResult({ ok: true, msg: `${t("已添加节点", "Added node")}「${nm}」` });
        onAdded?.(String(nm));
        setV(defaults(type)); // 重置表单便于继续添加
      } else {
        setResult({ ok: false, msg: t("添加失败", "Add failed") });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col gap-4">
      <div className="col gap-1" style={{ maxWidth: 280 }}>
        <span className="muted-2" style={{ fontSize: 11.5 }}>{t("协议类型", "Protocol")}</span>
        <Select value={type} onChange={changeType} options={PROTOCOLS.map((p) => ({ value: p, label: p }))} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
        {fields.map((f) => {
          if (!shouldShow(type, f.k, v)) return null;
          return (
            <div key={f.k} className="col gap-1">
              <span className="muted-2" style={{ fontSize: 11.5 }}>{lang === "en" ? (LABEL_EN[f.label] ?? f.label) : f.label}</span>
              {f.t === "bool" ? (
                <div style={{ height: 34, display: "flex", alignItems: "center" }}>
                  <Switch on={!!v[f.k]} onChange={(val) => set(f.k, val)} />
                </div>
              ) : f.t === "select" ? (
                <Select
                  value={v[f.k] ?? ""}
                  onChange={(val) => set(f.k, val)}
                  options={f.opts.map((o) => ({ value: o, label: o === "" ? t("（无）", "(none)") : o }))}
                />
              ) : (
                <input
                  className={f.t === "num" ? "input" : "input mono"}
                  type={f.t === "num" ? "number" : "text"}
                  placeholder={"ph" in f && f.ph ? (lang === "en" ? (PH_EN[f.ph] ?? f.ph) : f.ph) : ""}
                  value={v[f.k] ?? ""}
                  onChange={(e) => set(f.k, f.t === "num" ? e.target.value : e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="row between">
        {result ? (
          <span className="row" style={{ gap: 8, fontSize: 13, color: result.ok ? "var(--green)" : "var(--orange)" }}>
            {result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {result.msg}
          </span>
        ) : (
          <span className="muted-2" style={{ fontSize: 12 }}>{t("填写后将写入 config.yaml 并加入策略组", "Saved into config.yaml and added to proxy groups")}</span>
        )}
        <button className="btn btn-primary" onClick={submit} disabled={busy} style={{ gap: 8 }}>
          {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
          {busy ? t("添加中…", "Adding…") : t("添加节点", "Add node")}
        </button>
      </div>
    </div>
  );
}
