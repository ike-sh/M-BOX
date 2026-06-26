/**
 * M-BOX API 适配层
 * ------------------------------------------------------------------
 * 默认连接真实 daemon（REST /api/* + WS /ws/*）。当 daemon 不可达时
 * （例如纯前端演示 / 设计预览），自动回退到 mock 数据，保证页面可用。
 *
 * 约定（与 DESIGN.md 一致）：
 *   - daemon 暴露 /api/* (REST) 与 /ws/* (WebSocket)
 *   - daemon 反代 mihomo external-controller (127.0.0.1:9090)
 */
import {
  nodes,
  groups,
  subscriptions,
  rules,
  ruleProviders,
  genConnections,
  genTraffic,
  system,
  dnsConfig,
  tunConfig,
  diagnostics,
} from "../mock/data";
import type {
  GatewayResult,
  GatewayStatus,
  KernelsResp,
  GeneralConfig,
  DevicePolicy,
  DeviceLive,
  IPv6Status,
  TrafficPoint,
  TrafficStats,
} from "../types";

/** 强制使用 mock（设置 VITE_MOCK=1 可在纯前端开发时启用）。 */
const FORCE_MOCK = import.meta.env.VITE_MOCK === "1";

/** 运行期探测结果：true=后端可用，false=回退 mock，null=尚未探测。 */
let backendAlive: boolean | null = FORCE_MOCK ? false : null;

/** 是否处于 mock 模式（供 UI 显示「演示数据」角标）。 */
export function isMockMode(): boolean {
  return backendAlive === false;
}

/** 上次探测时间戳；离线状态每隔 PROBE_RETRY_MS 才重试，避免放大健康检查。 */
let lastProbeAt = 0;
const PROBE_RETRY_MS = 5000;

async function probe(): Promise<boolean> {
  if (FORCE_MOCK) return false;
  // 一旦确认在线就长期缓存（单次请求失败由 get() 自行兜底，不回滚此标记）。
  if (backendAlive === true) return true;
  // 尚未探测 / 上次判为离线：到冷却期就重试。修复「首次慢探测(如 daemon 正在启动)
  // 把整个面板永久锁死成 mock、直到手动刷新」的问题——daemon 恢复后会自动切回真实数据。
  const now = Date.now();
  if (backendAlive === false && now - lastProbeAt < PROBE_RETRY_MS) return false;
  lastProbeAt = now;
  try {
    const r = await fetch("/api/health", { signal: AbortSignal.timeout(2500) });
    backendAlive = r.ok;
  } catch {
    backendAlive = false;
  }
  return backendAlive;
}

/**
 * 带回退的 GET：后端可用走真实接口，否则返回 mock。
 *
 * 注意：单次请求失败（超时 / 某个端点 5xx）只对「本次调用」回退 mock，
 * 不会把 backendAlive 永久置为 false——否则一次慢请求（如耗时较长的诊断）
 * 会让整个面板悄悄退化成演示数据，直到刷新页面。
 */
async function get<T>(
  path: string,
  mock: () => T | Promise<T>,
  timeoutMs = 8000
): Promise<T> {
  if (!(await probe())) return mock();
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    // 后端在线但本次请求失败（超时/5xx）：仅本次回退兜底数据，不把整个面板永久退化成
    // 演示模式（probe 的 backendAlive 保持 true）。后端在线时告警，便于排查偶发失败。
    if (backendAlive === true) console.warn(`[M-BOX] 接口 ${path} 本次请求失败，已用兜底数据：`, e);
    return mock();
  }
}

async function send<T>(
  path: string,
  init: RequestInit,
  mock: () => T | Promise<T>
): Promise<T> {
  if (!(await probe())) return mock();
  try {
    const r = await fetch(path, { ...init, signal: AbortSignal.timeout(40000) });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return (await r.json()) as T;
  } catch {
    return mock();
  }
}

/**
 * 严格写入：当后端可用但请求失败（超时 / 非 2xx）时**抛出**错误，便于调用方回滚乐观更新
 * 并提示用户；仅当后端整体不可达（演示模式）时才回退 mock。用于 DNS 这类「写失败必须让
 * 用户感知」的危险配置变更。
 */
async function sendStrict<T>(
  path: string,
  init: RequestInit,
  mock: () => T | Promise<T>,
  timeoutMs = 40000
): Promise<T> {
  if (!(await probe())) return mock();
  const r = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) detail = j.error;
    } catch {
      /* ignore non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await r.json()) as T;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 演示态（无后端）下的一键网关结果，仅用于预览交互流程。 */
function demoGatewayResult(enabled: boolean): GatewayResult {
  if (!enabled) {
    return {
      enabled: false,
      ok: true,
      steps: [
        { name: "关闭 TUN 透明代理", ok: true, detail: "（演示）已关闭 TUN" },
        { name: "热重载配置", ok: true, detail: "（演示）mihomo 已应用关闭" },
      ],
    };
  }
  return {
    enabled: true,
    ok: true,
    steps: [
      { name: "写入透明代理配置", ok: true, detail: "（演示）已开启 TUN + auto-route + auto-redirect + strict-route" },
      { name: "开启 IP 转发 (ip_forward)", ok: true, skipped: true, detail: "（演示）真机由 Linux 网关负责" },
      { name: "启动 mihomo 内核", ok: true, skipped: true, detail: "（演示）真机由 daemon 托管" },
      { name: "热重载配置", ok: true, detail: "（演示）mihomo 已按最新配置生效" },
      { name: "设置开机自启", ok: true, skipped: true, detail: "（演示）真机由 systemd 负责" },
    ],
  };
}

export const api = {
  async getProxies() {
    return get("/api/proxies", async () => {
      await delay(120);
      return { nodes, groups };
    });
  },

  async getSubscriptions() {
    return get("/api/subscriptions", async () => {
      await delay(120);
      return subscriptions;
    });
  },

  async getRules() {
    return get("/api/rules", async () => {
      await delay(120);
      return { rules, providers: ruleProviders };
    });
  },

  async getSystem() {
    return get("/api/system", async () => {
      await delay(120);
      return system;
    });
  },

  /**
   * 本地公网出口 IP(直连) / 代理出口 IP / 局域网地址。
   * 传 scope 可只探测其中一路（local / egress），用于两个刷新按钮各刷各的。
   */
  async getNetInfo(
    scope?: "local" | "egress"
  ): Promise<{ localIP?: string; egressIP?: string; lanIP?: string }> {
    const q = scope ? `?scope=${scope}` : "";
    return get<{ localIP?: string; egressIP?: string; lanIP?: string }>(
      `/api/netinfo${q}`,
      async () => {
        await delay(150);
        if (scope === "egress") return { egressIP: "203.0.113.10" };
        if (scope === "local") return { localIP: "113.65.0.10", lanIP: "192.168.1.2" };
        return { localIP: "113.65.0.10", egressIP: "203.0.113.10", lanIP: "192.168.1.2" };
      },
      12000
    );
  },

  /** DNS 解析统计（由连接派生：累计解析域名 + 当前 fake-ip/域名/直连IP 连接）。 */
  async getDnsStats(): Promise<{ resolvedTotal: number; fakeipActive: number; domainActive: number; directActive: number; totalActive: number }> {
    return get(
      "/api/dns/stats",
      async () => ({ resolvedTotal: 0, fakeipActive: 0, domainActive: 0, directActive: 0, totalActive: 0 })
    );
  },

  async getDns() {
    return get("/api/dns", () => dnsConfig);
  },

  async getTun() {
    return get("/api/tun", () => tunConfig);
  },

  async getDiagnostics() {
    // 后端诊断预算约 12s，客户端给 16s 余量，避免误超时回退 mock。
    return get(
      "/api/diagnostics",
      async () => {
        await delay(120);
        return diagnostics;
      },
      16000
    );
  },

  async getConnections() {
    return get("/api/connections", async () => {
      await delay(80);
      return genConnections();
    });
  },

  /**
   * 实时流量订阅。后端可用时连 WebSocket /ws/traffic；否则用本地定时器模拟，
   * 保证图表始终有数据。
   */
  subscribeTraffic(cb: (p: { up: number; down: number }) => void) {
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const startMock = () => {
      let down = 1_900_000;
      let up = 240_000;
      timer = setInterval(() => {
        down = Math.max(120_000, down + (Math.random() - 0.5) * 900_000);
        up = Math.max(40_000, up + (Math.random() - 0.5) * 240_000);
        cb({ up: Math.round(up), down: Math.round(down) });
      }, 1000);
    };

    (async () => {
      if (!(await probe())) {
        if (!closed) startMock();
        return;
      }
      try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${location.host}/ws/traffic`);
        ws.onmessage = (e) => {
          try {
            cb(JSON.parse(e.data));
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onerror = () => {
          if (!closed && !timer) startMock();
        };
        // 服务端主动关闭（如 daemon 重启）时 onerror 未必触发，这里兜底切到本地模拟。
        ws.onclose = () => {
          if (!closed && !timer) startMock();
        };
      } catch {
        if (!closed) startMock();
      }
    })();

    return () => {
      closed = true;
      if (ws) ws.close();
      if (timer) clearInterval(timer);
    };
  },

  /**
   * 历史流量曲线。后端可用时取真实采样（GET /api/traffic，秒级环形缓冲）；
   * 后端不可达或尚无采样时回退 mock，保证图表首屏有数据。
   */
  async getTrafficHistory(): Promise<TrafficPoint[]> {
    const data = await get<TrafficPoint[]>("/api/traffic", async () => {
      await delay(60);
      return genTraffic();
    });
    // daemon 刚启动、还没有任何采样时返回空数组：用 mock 兜底首屏。
    return data && data.length > 0 ? data : genTraffic();
  },

  /**
   * 历史流量按小时/天聚合（跨重启持久化）。后端不可达时返回空集，
   * 调用方据此显示「暂无统计」。
   */
  async getTrafficStats(): Promise<TrafficStats> {
    return get<TrafficStats>("/api/traffic/stats", () => ({ hourly: [], daily: [] }));
  },

  async selectProxy(group: string, name: string) {
    return send(
      `/api/proxies/${encodeURIComponent(group)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
      async () => {
        await delay(150);
        return { group, name, ok: true };
      }
    );
  },

  /** 导入分享链接节点（支持多行；ss/vmess/vless/trojan/hysteria2/tuic 等）。 */
  async importProxies(text: string): Promise<{ added: string[]; count: number; errors: string[] }> {
    return send(
      `/api/proxies/import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: text }),
      },
      async () => {
        await delay(300);
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        return { added: lines.map((_, i) => `演示节点-${i + 1}`), count: lines.length, errors: [] };
      }
    );
  },

  /** 手动按参数添加一个节点（前端按协议组装 mihomo proxy 对象）。 */
  async addManualProxy(proxy: Record<string, unknown>): Promise<{ added: string[]; count: number }> {
    return send(
      `/api/proxies/manual`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proxy),
      },
      async () => {
        await delay(250);
        return { added: [String(proxy.name || "演示节点")], count: 1 };
      }
    );
  },

  /** 删除手动添加的节点。 */
  async deleteNode(name: string) {
    return send(`/api/proxies/node/${encodeURIComponent(name)}`, { method: "DELETE" }, async () => ({ ok: true }));
  },

  /** 单节点测速。 */
  async testProxy(name: string) {
    return send(
      `/api/proxies/${encodeURIComponent(name)}/delay`,
      { method: "POST" },
      async () => {
        await delay(400);
        return { name, delay: Math.round(40 + Math.random() * 260) };
      }
    );
  },

  /** 批量测速：一次请求在服务端并发测试多个节点，返回 name->delay(ms，-1=失败/超时)。 */
  async batchDelay(names: string[], url?: string, timeout?: number): Promise<Record<string, number>> {
    const r = await send<{ results?: Record<string, number> }>(
      `/api/proxies/delay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, url, timeout }),
      },
      async () => {
        await delay(500);
        const m: Record<string, number> = {};
        for (const n of names) m[n] = Math.round(40 + Math.random() * 320);
        return { results: m };
      }
    );
    return r.results ?? {};
  },

  /** 节点健康评分：服务端多采样测速并综合评分（延迟中位数/抖动/丢包/倍率），按 score 降序。
   *  耗时较长（每节点多次采样），给 150s 严格写入；演示模式回退随机评分。 */
  async healthProxies(
    names: string[],
    opts?: { url?: string; timeout?: number; samples?: number }
  ): Promise<{ name: string; median: number; jitter: number; loss: number; samples: number; ok: number; multiplier: number; score: number }[]> {
    const r = await sendStrict<{ results?: { name: string; median: number; jitter: number; loss: number; samples: number; ok: number; multiplier: number; score: number }[] }>(
      `/api/proxies/health`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names, ...opts }) },
      async () => {
        await delay(500);
        return {
          results: names
            .map((n) => {
              const median = Math.round(40 + Math.random() * 240);
              return { name: n, median, jitter: Math.round(Math.random() * 30), loss: 0, samples: 3, ok: 3, multiplier: 0, score: Math.round(100 - median / 10) };
            })
            .sort((a, b) => b.score - a.score),
        };
      },
      150000
    );
    return r.results ?? [];
  },

  /** 内核控制：start / stop / restart / reload。 */
  async coreAction(action: "start" | "stop" | "restart" | "reload") {
    return send(`/api/core/${action}`, { method: "POST" }, async () => {
      await delay(300);
      return { ok: true };
    });
  },

  /** 刷新某条订阅。 */
  async updateSubscription(name: string) {
    return send(
      `/api/subscriptions/${encodeURIComponent(name)}/update`,
      { method: "POST" },
      async () => {
        await delay(500);
        return { ok: true };
      }
    );
  },

  /** 新增订阅（拉取 + 注入 mihomo config + 重载）。 */
  async addSubscription(name: string, url: string, interval = 24) {
    return send(
      `/api/subscriptions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, interval }),
      },
      async () => {
        await delay(500);
        return { ok: true };
      }
    );
  },

  /** 启用 / 停用订阅（停用会从内核移除其 proxy-provider 并热重载）。 */
  async setSubscriptionEnabled(name: string, enabled: boolean) {
    return sendStrict(
      `/api/subscriptions/${encodeURIComponent(name)}/enable`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
      async () => {
        await delay(150);
        return { enabled };
      }
    );
  },

  /** 删除订阅。 */
  async deleteSubscription(name: string) {
    return send(
      `/api/subscriptions/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      async () => {
        await delay(200);
        return { ok: true };
      }
    );
  },

  /** 断开某条连接。 */
  async closeConnection(id: string) {
    return send(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" }, async () => {
      await delay(120);
      return { ok: true };
    });
  },

  /**
   * 应用 DNS 配置变更。采用严格写入：真实后端写失败会抛错，调用方据此回滚 + 提示；
   * 演示模式（无后端）下返回 patch 以便预览交互。
   */
  async applyDns(patch: Record<string, unknown>) {
    return sendStrict(
      `/api/dns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      async () => {
        await delay(200);
        return patch;
      }
    );
  },

  /** DNS 解析自测：返回 mihomo 对某域名的实时解析结果。 */
  async queryDns(name: string, type = "A") {
    return get<{ Status?: number; Answer?: { name: string; type: number; TTL: number; data: string }[] }>(
      `/api/dns/query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      async () => {
        await delay(300);
        return { Status: 0, Answer: [{ name, type: 1, TTL: 300, data: "203.0.113.10" }] };
      },
      9000
    );
  },

  /** 应用 TUN 配置变更。 */
  async applyTun(patch: Record<string, unknown>) {
    return send(
      `/api/tun`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      async () => {
        await delay(200);
        return patch;
      }
    );
  },

  /** 透明代理网关当前状态（TUN/IP 转发/开机自启/内核运行）。 */
  async getTransparentStatus(): Promise<GatewayStatus> {
    return get("/api/transparent", async () => ({
      tunEnable: tunConfig.enable,
      ipForward: false,
      autostart: false,
      coreRunning: false,
      managed: false,
    }));
  },

  /** 一键开启透明代理网关：写配置 + 开 IP 转发 + 启动内核 + 重载 + 开机自启。 */
  async enableTransparent(): Promise<GatewayResult> {
    return send(
      `/api/transparent/enable`,
      { method: "POST" },
      async () => {
        await delay(400);
        return demoGatewayResult(true);
      }
    );
  },

  /** 一键关闭透明代理（仅关 TUN 并重载，保留转发与自启）。 */
  async disableTransparent(): Promise<GatewayResult> {
    return send(
      `/api/transparent/disable`,
      { method: "POST" },
      async () => {
        await delay(300);
        return demoGatewayResult(false);
      }
    );
  },

  /** 完全卸载/还原网关：关 TUN + 关 IP 转发(移除持久化) + 取消自启 + 清设备规则。 */
  async uninstallTransparent(): Promise<GatewayResult> {
    return send(
      `/api/transparent/uninstall`,
      { method: "POST" },
      async () => {
        await delay(400);
        return demoGatewayResult(false);
      }
    );
  },

  /** 切换全局模式 rule/global/direct。 */
  async setMode(mode: string) {
    return send(
      `/api/config/mode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      },
      async () => ({ mode })
    );
  },

  async getMode(): Promise<{ mode: string }> {
    return get(`/api/config/general`, () => ({ mode: "rule" }));
  },

  /** 「代理设置」综合配置（端口/基础/性能/网络/嗅探/GEO/认证）。 */
  async getGeneral(): Promise<GeneralConfig> {
    return get(`/api/general`, () => ({
      mixedPort: 7890, socksPort: 0, httpPort: 0,
      allowLan: true, logLevel: "info",
      unifiedDelay: true, tcpConcurrent: true, findProcessMode: "off", globalClientFingerprint: "",
      interfaceName: "", routingMark: 0, keepAliveInterval: 30, keepAliveIdle: 600, disableKeepAlive: false,
      globalUa: "clash.meta", geodataMode: false, geoAutoUpdate: false, geoUpdateInterval: 24, geodataLoader: "memconservative",
      authentication: [],
      sniffer: { enable: true, overrideDestination: false, http: true, tls: true, quic: true },
      testUrl: "http://www.gstatic.com/generate_204", testTimeout: 5000, testInterval: 300,
    }));
  },

  /** 恢复默认配置（先自动备份，保留控制器密钥，热重载）。 */
  async resetDefault(): Promise<{ ok: boolean; reloaded?: boolean; warning?: string }> {
    return sendStrict(`/api/config/reset`, { method: "POST" }, async () => ({ ok: true }));
  },

  /** 写回「代理设置」综合配置（严格写入，失败抛错以便回滚）。 */
  async applyGeneral(patch: Record<string, unknown>): Promise<GeneralConfig> {
    return sendStrict(
      `/api/general`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      async () => patch as unknown as GeneralConfig
    );
  },

  /** 一键应用推荐策略模板：重写 proxy-groups + rules（地区组/分类分流/内置 GEOSITE），自动备份。 */
  async applyTemplate(): Promise<{ ok: boolean; providers: number; reloaded?: boolean; warning?: string }> {
    return send(
      `/api/config/template`,
      { method: "POST" },
      async () => ({ ok: true, providers: 0, reloaded: true })
    );
  },

  /** 新增自定义规则。 */
  async addRule(rule: { type: string; payload: string; target: string }) {
    return send(
      `/api/rules`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      },
      async () => ({ ok: true })
    );
  },

  /** 原地更新一条已有规则（old=原规则文本，保留其在列表中的位置）。 */
  async updateRule(body: { old: string; type: string; payload: string; target: string }) {
    return sendStrict(
      `/api/rules`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      async () => ({ ok: true })
    );
  },

  /** 删除自定义规则（按完整规则文本）。 */
  async deleteRule(raw: string) {
    return send(
      `/api/rules`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      },
      async () => ({ ok: true })
    );
  },

  /** 新增规则集订阅（写入 rule-providers + 追加 RULE-SET 规则）。 */
  async addRuleProvider(body: {
    name: string;
    url: string;
    behavior: string;
    format?: string;
    target: string;
    interval?: number;
  }): Promise<{ ok: boolean; name: string }> {
    return send(
      `/api/rules/providers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      async () => ({ ok: true, name: body.name })
    );
  },

  /** 删除规则集订阅（连同其 RULE-SET 规则与缓存文件）。 */
  async deleteRuleProvider(name: string) {
    return send(`/api/rules/providers/${encodeURIComponent(name)}`, { method: "DELETE" }, async () => ({ ok: true }));
  },

  /** 手动更新单个规则集（mihomo 重新拉取远程规则）。 */
  async updateRuleProvider(name: string) {
    return send(
      `/api/rules/providers/${encodeURIComponent(name)}/update`,
      { method: "POST" },
      async () => {
        await delay(400);
        return { name, ok: true };
      }
    );
  },

  /** 手动更新全部规则集，返回成功列表与失败原因。 */
  async updateAllRuleProviders(): Promise<{ updated: string[]; failed: Record<string, string>; count: number; ok: boolean }> {
    return send(
      `/api/rules/providers/update`,
      { method: "POST" },
      async () => {
        await delay(600);
        return { updated: ruleProviders.map((p) => p.name), failed: {}, count: ruleProviders.length, ok: true };
      }
    );
  },

  /** 更新内置 GEOSITE/GEOIP 规则库：触发内核重新下载 geoip.dat/geosite.dat 并热加载。 */
  async updateGeo(): Promise<{ ok: boolean }> {
    return sendStrict(
      `/api/geo/update`,
      { method: "POST" },
      async () => {
        await delay(800);
        return { ok: true };
      },
      100000
    );
  },

  // ---- 配置管理 ----
  async getConfigRaw(): Promise<{ content: string }> {
    return get(`/api/config/raw`, () => ({
      content:
        "# 演示模式：未连接 daemon，无法读取真实 config.yaml\nmode: rule\n",
    }));
  },

  async saveConfigRaw(content: string): Promise<{ ok: boolean; reloaded?: boolean; warning?: string }> {
    return send(
      `/api/config/raw`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
      async () => ({ ok: true, reloaded: true })
    );
  },

  async getBackups(): Promise<
    { id: string; name: string; note: string; time: string; size: string; current: boolean }[]
  > {
    return get(`/api/config/backups`, () => [
      { id: "demo1", name: "自动备份", note: "演示数据", time: "今天 18:30", size: "12.4 KB", current: true },
    ]);
  },

  async createBackup(note: string) {
    return send(
      `/api/config/backups`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      },
      async () => ({ ok: true })
    );
  },

  async restoreBackup(id: string) {
    return send(`/api/config/backups/${encodeURIComponent(id)}/restore`, { method: "POST" }, async () => ({ ok: true }));
  },

  async deleteBackup(id: string) {
    return send(`/api/config/backups/${encodeURIComponent(id)}`, { method: "DELETE" }, async () => ({ ok: true }));
  },

  backupDownloadUrl(id: string) {
    return `/api/config/backups/${encodeURIComponent(id)}/download`;
  },

  /** 内核版本检查（当前 vs GitHub 最新）。force=true 强制绕过后端 1h 缓存重新查询。 */
  async getCoreLatest(force = false): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
    // 该接口会访问 GitHub（后端 8s 预算），客户端给 12s 余量。
    return get(`/api/core/latest${force ? "?force=1" : ""}`, () => ({ current: "", latest: "", hasUpdate: false }), 12000);
  },

  /** 系统优化状态（BBR / 开机自启 / IP 转发）。 */
  async getSystemOptimize(): Promise<{ bbr: boolean; bbrAvailable: boolean; autostart: boolean; ipForward: boolean }> {
    return get(`/api/system/optimize`, () => ({ bbr: false, bbrAvailable: false, autostart: false, ipForward: false }));
  },

  /** 应用系统优化（任意子集：bbr / autostart / ipForward），返回最新状态。 */
  async applySystemOptimize(patch: Record<string, unknown>): Promise<{ bbr: boolean; bbrAvailable: boolean; autostart: boolean; ipForward: boolean }> {
    return sendStrict(
      `/api/system/optimize`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      async () => ({ bbr: false, bbrAvailable: false, autostart: false, ipForward: false })
    );
  },

  /** 系统控制：重启 / 停止 daemon 服务（异步执行）。 */
  async systemControl(action: "restart" | "stop"): Promise<{ ok: boolean; action: string }> {
    return send(
      `/api/system/control`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
      async () => ({ ok: true, action })
    );
  },

  /** 在线更新 mihomo 内核（下载最新 → 替换 → 重启内核）。耗时较长，给 120s 严格写入。 */
  async coreUpdate(): Promise<{ ok: boolean; version: string }> {
    return sendStrict(`/api/core/update`, { method: "POST" }, async () => ({ ok: true, version: "" }), 120000);
  },

  // ---- M4: 多内核 / 设备策略 / IPv6 / 告警 ----

  /** 可用内核列表与当前选择。 */
  async getKernels(): Promise<KernelsResp> {
    return get(
      `/api/kernels`,
      () => ({
        current: "mihomo",
        os: "linux",
        arch: "amd64",
        kernels: [
          {
            kind: "mihomo",
            displayName: "mihomo (Clash.Meta)",
            defaultBin: "mihomo",
            configFile: "config.yaml",
            releaseRepo: "MetaCubeX/mihomo",
            clashApi: true,
            current: true,
            installed: "",
            latest: "",
            running: true,
          },
          {
            kind: "sing-box",
            displayName: "sing-box",
            defaultBin: "sing-box",
            configFile: "config.json",
            releaseRepo: "SagerNet/sing-box",
            clashApi: true,
            current: false,
            installed: "",
            latest: "",
            running: false,
          },
        ],
      }),
      12000
    );
  },

  /** 设备策略列表。 */
  async getDevices(): Promise<DevicePolicy[]> {
    return get(`/api/devices`, () => [
      { id: "demo1", name: "客厅电视", ip: "192.168.1.50", target: "🚀 节点选择", enabled: true },
      { id: "demo2", name: "工作笔记本", ip: "192.168.1.0/24", target: "DIRECT", enabled: false },
    ]);
  },

  /** 新增/更新设备策略。 */
  async upsertDevice(d: Partial<DevicePolicy>): Promise<DevicePolicy> {
    return send(
      `/api/devices`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      },
      async () => ({
        id: d.id || `demo-${Date.now()}`,
        name: d.name || d.ip || "",
        ip: d.ip || "",
        target: d.target || "",
        enabled: d.enabled ?? true,
      })
    );
  },

  /** 删除设备策略。 */
  async deleteDevice(id: string) {
    return send(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }, async () => ({ ok: true }));
  },

  /** 在线设备实时聚合（按源 IP 统计活动连接与上下行速率）。 */
  async getDevicesLive(): Promise<DeviceLive[]> {
    return get(`/api/devices/live`, () => [
      { ip: "192.168.1.50", connCount: 8, ulSpeed: 64_000, dlSpeed: 920_000, upload: 12_000_000, download: 480_000_000 },
      { ip: "192.168.1.66", connCount: 3, ulSpeed: 12_000, dlSpeed: 180_000, upload: 3_000_000, download: 90_000_000 },
    ]);
  },

  /** IPv6 当前状态。 */
  async getIPv6(): Promise<IPv6Status> {
    return get(`/api/ipv6`, () => ({ enabled: false, top: false, dns: false, consistent: true }));
  },

  /** 设置 IPv6 总开关（协调顶层 ipv6 + dns.ipv6）。 */
  async applyIPv6(enable: boolean): Promise<IPv6Status> {
    return send(
      `/api/ipv6`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      },
      async () => ({ enabled: enable, top: enable, dns: enable, consistent: true })
    );
  },

  /** 实时日志订阅（WS /ws/logs）。level 默认 info；DNS 查询日志需 debug。
   *  断线/后端未就绪会每 3s 自动重连，避免首连失败后一直空白。 */
  subscribeLogs(cb: (msg: { type: string; payload: string }) => void, level: string = "info") {
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reconnect = () => {
      if (!closed && !timer) timer = setTimeout(() => { timer = null; connect(); }, 3000);
    };
    const connect = async () => {
      if (closed) return;
      if (!(await probe())) {
        reconnect();
        return;
      }
      try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${location.host}/ws/logs?level=${encodeURIComponent(level)}`);
        ws.onmessage = (e) => {
          try {
            cb(JSON.parse(e.data));
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = reconnect;
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        reconnect();
      }
    };
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ws) ws.close();
    };
  },

  /** 后端(daemon)自身日志实时订阅（WS /ws/logs/backend）：连上先收历史快照再收实时增量，
   *  断线/未就绪每 3s 自动重连。返回取消函数。 */
  subscribeBackendLogs(cb: (line: { time: string; level: string; msg: string }) => void) {
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconnect = () => {
      if (!closed && !timer) timer = setTimeout(() => { timer = null; connect(); }, 3000);
    };
    const connect = async () => {
      if (closed) return;
      if (!(await probe())) {
        reconnect();
        return;
      }
      try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${location.host}/ws/logs/backend`);
        ws.onmessage = (e) => {
          try {
            cb(JSON.parse(e.data));
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = reconnect;
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        reconnect();
      }
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ws) ws.close();
    };
  },
};
