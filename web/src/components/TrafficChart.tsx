import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { TrafficPoint } from "../types";

function fmtKB(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  return `${Math.round(v)} KB/s`;
}

// fmtClock 把 unix 毫秒时间戳格式化为 HH:MM:SS，用于以 ts 为基准的时间轴刻度与提示。
function fmtClock(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function TT({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const ts = payload[0]?.payload?.ts;
  return (
    <div
      className="glass"
      style={{ borderRadius: 12, padding: "10px 12px", fontSize: 12, minWidth: 130 }}
    >
      {ts ? (
        <div className="mono" style={{ color: "var(--t3)", fontSize: 11, marginBottom: 4 }}>
          {fmtClock(ts)}
        </div>
      ) : null}
      {payload.map((p: any) => (
        <div
          key={p.dataKey}
          style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "2px 0" }}
        >
          <span style={{ color: "var(--t2)" }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: p.color,
                marginRight: 6,
              }}
            />
            {p.dataKey === "down" ? "下载" : "上传"}
          </span>
          <span className="mono" style={{ fontWeight: 600 }}>
            {fmtKB(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrafficChart({ data, height = 240 }: { data: TrafficPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a84ff" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#0a84ff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bf5af2" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#bf5af2" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--hairline)" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tick={{ fill: "var(--t3)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={44}
          tickFormatter={fmtClock}
        />
        <YAxis
          tick={{ fill: "var(--t3)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => (v >= 1024 ? `${(v / 1024).toFixed(0)}M` : `${v}K`)}
        />
        <Tooltip content={<TT />} cursor={{ stroke: "var(--glass-border-strong)" }} />
        <Area
          type="monotone"
          dataKey="down"
          stroke="#0a84ff"
          strokeWidth={2}
          fill="url(#gDown)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="up"
          stroke="#bf5af2"
          strokeWidth={2}
          fill="url(#gUp)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
