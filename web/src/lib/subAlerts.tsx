import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Subscription } from "../types";

/**
 * 订阅风险提醒（纯前端、零后端依赖）。
 * ------------------------------------------------------------------
 * 基于已拉取的订阅元数据，本地计算两类需要人工处理的风险：
 *   - expire：剩余天数 ≤ EXPIRE_DAYS（含已过期）
 *   - traffic：已用流量占比 ≥ TRAFFIC_RATIO
 * 计算结果在侧边栏「订阅管理」菜单与顶栏铃铛上以红点/数字角标呈现，
 * 取代之前要靠外部 webhook 才能感知的告警——内网自用场景看面板即可。
 */

const EXPIRE_DAYS = 7; // 剩余天数 ≤ 此值视为「快过期」
const TRAFFIC_RATIO = 0.9; // 已用占比 ≥ 此值视为「流量快用完」
const POLL_MS = 60_000; // 订阅变化很慢，1 分钟刷新一次即可

export interface SubWarning {
  id: string;
  name: string;
  kind: "expire" | "traffic";
  /** 面向用户的简短描述，如「3 天后到期」「流量已用 94%」 */
  detail: string;
}

interface SubAlertsCtx {
  warnings: SubWarning[];
  /** key=订阅 id，值为该订阅命中的告警类型，便于订阅页高亮对应卡片。 */
  byId: Record<string, SubWarning[]>;
  refresh: () => void;
}

const Ctx = createContext<SubAlertsCtx>({ warnings: [], byId: {}, refresh: () => {} });

/** 把订阅列表折算为风险列表。expire 形如 "2026-01-02"，"—" 表示未知。 */
export function computeWarnings(subs: Subscription[]): SubWarning[] {
  const out: SubWarning[] = [];
  const now = Date.now();
  for (const s of subs) {
    if (!s.enabled) continue; // 已停用的订阅不提醒

    if (s.total > 0) {
      const ratio = s.used / s.total;
      if (ratio >= TRAFFIC_RATIO) {
        out.push({
          id: s.id,
          name: s.name,
          kind: "traffic",
          detail: ratio >= 1 ? "流量已用尽" : `流量已用 ${Math.round(ratio * 100)}%`,
        });
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(s.expire)) {
      const exp = new Date(`${s.expire}T23:59:59`).getTime();
      const days = Math.floor((exp - now) / 86_400_000);
      if (days < 0) {
        out.push({ id: s.id, name: s.name, kind: "expire", detail: "已过期" });
      } else if (days <= EXPIRE_DAYS) {
        out.push({ id: s.id, name: s.name, kind: "expire", detail: days === 0 ? "今天到期" : `${days} 天后到期` });
      }
    }
  }
  return out;
}

export function SubAlertsProvider({ children }: { children: ReactNode }) {
  const [warnings, setWarnings] = useState<SubWarning[]>([]);
  const aliveRef = useRef(true);

  const load = () =>
    api.getSubscriptions().then((subs) => aliveRef.current && setWarnings(computeWarnings(subs)));

  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId: Record<string, SubWarning[]> = {};
  for (const w of warnings) (byId[w.id] ||= []).push(w);

  return <Ctx.Provider value={{ warnings, byId, refresh: load }}>{children}</Ctx.Provider>;
}

export const useSubAlerts = () => useContext(Ctx);
