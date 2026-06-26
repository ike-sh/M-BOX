import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { system as mockSystem } from "../mock/data";
import type { SystemInfo } from "../types";

/**
 * SystemProvider 在全局**只跑一份** `/api/system` 轮询，供 TopBar / Sidebar / 系统页共享，
 * 取代此前三个组件各自的定时器（TopBar 4s + Sidebar 5s + System 3s 同时打同一个接口）。
 * refresh() 触发一次立即刷新（用于内核启停后尽快回显）。
 */
interface SystemCtx {
  system: SystemInfo;
  refresh: () => void;
}

const SystemContext = createContext<SystemCtx>({ system: mockSystem, refresh: () => {} });

export function SystemProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<SystemInfo>(mockSystem);
  const aliveRef = useRef(true);

  const load = () => api.getSystem().then((s) => aliveRef.current && setSystem(s));

  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(load, 3000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <SystemContext.Provider value={{ system, refresh: load }}>{children}</SystemContext.Provider>;
}

export const useSystem = () => useContext(SystemContext);
