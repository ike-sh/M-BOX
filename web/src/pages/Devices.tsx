import { useEffect, useState } from "react";
import { MonitorSmartphone, Plus, Trash2, Router, Activity } from "lucide-react";
import { GlassCard, CardHead, Switch, Pill, Select } from "../components/ui";
import { api } from "../lib/api";
import { speed, bytes } from "../lib/format";
import type { DevicePolicy, DeviceLive } from "../types";

// 内置目标选项：直连 / 拦截 + 运行时从策略组补充。
const BASE_TARGETS = ["DIRECT", "REJECT"];

export function Devices() {
  const [devices, setDevices] = useState<DevicePolicy[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [live, setLive] = useState<DeviceLive[]>([]);
  const [form, setForm] = useState({ name: "", ip: "", target: "DIRECT" });
  const [busy, setBusy] = useState(false);

  function reload() {
    api.getDevices().then(setDevices);
  }
  useEffect(() => {
    reload();
    api.getProxies().then((p) => setGroups(p.groups.map((g) => g.name)));
  }, []);

  // 在线设备实时聚合：轮询 /api/devices/live，组件卸载时清理定时器。
  useEffect(() => {
    let alive = true;
    const load = () => api.getDevicesLive().then((d) => alive && setLive(d));
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 把在线 IP 映射到已配置设备的备注名（命中网段也算），找不到则回显 IP。
  function deviceName(ip: string): string {
    const exact = devices.find((d) => d.ip === ip);
    if (exact) return exact.name;
    return ip;
  }

  const targets = [...groups, ...BASE_TARGETS.filter((t) => !groups.includes(t))];

  async function add() {
    const ip = form.ip.trim();
    if (!ip || busy) return;
    setBusy(true);
    try {
      const d = await api.upsertDevice({ name: form.name.trim() || ip, ip, target: form.target, enabled: true });
      setDevices((list) => {
        const i = list.findIndex((x) => x.id === d.id);
        if (i >= 0) {
          const next = [...list];
          next[i] = d;
          return next;
        }
        return [...list, d];
      });
      setForm({ name: "", ip: "", target: form.target });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(d: DevicePolicy, enabled: boolean) {
    setDevices((list) => list.map((x) => (x.id === d.id ? { ...x, enabled } : x)));
    await api.upsertDevice({ ...d, enabled });
  }

  async function changeTarget(d: DevicePolicy, target: string) {
    setDevices((list) => list.map((x) => (x.id === d.id ? { ...x, target } : x)));
    await api.upsertDevice({ ...d, target });
  }

  async function remove(d: DevicePolicy) {
    setDevices((list) => list.filter((x) => x.id !== d.id));
    await api.deleteDevice(d.id);
  }

  function targetTone(t: string): "green" | "red" | "blue" {
    if (t === "DIRECT") return "green";
    if (t === "REJECT") return "red";
    return "blue";
  }

  return (
    <div className="page">
      <GlassCard>
        <CardHead
          icon={<Router size={18} color="var(--blue)" />}
          title="按设备分流"
          sub="按源 IP / 网段把指定设备定向到策略组、直连或拦截 · 优先级最高"
        />
        <div className="row wrap gap-2" style={{ alignItems: "flex-end" }}>
          <Field label="备注名">
            <input
              className="input"
              placeholder="如 客厅电视"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="IP / CIDR">
            <input
              className="input mono"
              placeholder="192.168.1.50 或 192.168.1.0/24"
              value={form.ip}
              onChange={(e) => setForm({ ...form, ip: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </Field>
          <Field label="目标策略">
            <Select
              value={form.target}
              onChange={(v) => setForm({ ...form, target: v })}
              options={targets.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <button className="btn btn-primary" onClick={add} disabled={busy} style={{ gap: 6 }}>
            <Plus size={15} /> 添加
          </button>
        </div>
      </GlassCard>

      <GlassCard>
        <CardHead icon={<MonitorSmartphone size={18} color="var(--purple)" />} title="设备列表" sub={`${devices.length} 台设备`} />
        <div className="col gap-2">
          {devices.length === 0 && <span className="muted-2" style={{ fontSize: 13 }}>暂无设备策略，添加后将以 SRC-IP-CIDR 规则置顶生效。</span>}
          {devices.map((d) => (
            <div
              key={d.id}
              className="row between"
              style={{ padding: "12px 14px", borderRadius: "var(--r-md)", background: "var(--fill-2)", border: "1px solid var(--hairline)", gap: 12 }}
            >
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <Switch on={d.enabled} onChange={(v) => toggle(d, v)} />
                <div className="col" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t1)" }}>{d.name}</span>
                  <span className="mono muted-2" style={{ fontSize: 12 }}>{d.ip}</span>
                </div>
              </div>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <Pill tone={targetTone(d.target)}>{d.target}</Pill>
                <div style={{ minWidth: 150 }}>
                  <Select
                    value={d.target}
                    onChange={(v) => changeTarget(d, v)}
                    options={(targets.includes(d.target) ? targets : [d.target, ...targets]).map((t) => ({ value: t, label: t }))}
                  />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(d)} title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <CardHead
          icon={<Activity size={18} color="var(--green)" />}
          title="在线设备 · 实时"
          sub="按源 IP 聚合的活动连接与实时上下行（每 3 秒刷新）"
          right={<span className="row" style={{ gap: 6, fontSize: 12, color: "var(--t2)" }}><span className="live-dot" /> 实时</span>}
        />
        {live.length === 0 ? (
          <span className="muted-2" style={{ fontSize: 13 }}>暂无在线设备流量（需内核运行且有经过网关的活动连接）。</span>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>设备</th>
                <th style={{ textAlign: "right" }}>连接数</th>
                <th style={{ textAlign: "right" }}>下载速率</th>
                <th style={{ textAlign: "right" }}>上传速率</th>
                <th style={{ textAlign: "right" }}>累计下载</th>
              </tr>
            </thead>
            <tbody>
              {live.map((d) => {
                const dl = speed(d.dlSpeed);
                const ul = speed(d.ulSpeed);
                return (
                  <tr key={d.ip}>
                    <td>
                      <div className="col">
                        <span style={{ fontWeight: 600 }}>{deviceName(d.ip)}</span>
                        <span className="muted-2 mono" style={{ fontSize: 11 }}>{d.ip}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }} className="mono">{d.connCount}</td>
                    <td style={{ textAlign: "right" }} className="mono">{dl.val} {dl.unit}</td>
                    <td style={{ textAlign: "right" }} className="mono">{ul.val} {ul.unit}</td>
                    <td style={{ textAlign: "right" }} className="mono">{bytes(d.download)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col gap-1" style={{ flex: "1 1 180px", minWidth: 160 }}>
      <span className="muted-2" style={{ fontSize: 11.5 }}>{label}</span>
      {children}
    </div>
  );
}
