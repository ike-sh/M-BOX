import type {
  ProxyNode,
  ProxyGroup,
  Subscription,
  RuleItem,
  RuleProvider,
  Connection,
  TrafficPoint,
  SystemInfo,
  DnsConfig,
  TunConfig,
  DiagItem,
} from "../types";

export const nodes: ProxyNode[] = [
  { name: "香港 IEPL 01", type: "vless", region: "HK", flag: "🇭🇰", delay: 42, multiplier: 1, udp: true },
  { name: "香港 IEPL 02", type: "vless", region: "HK", flag: "🇭🇰", delay: 56, multiplier: 1, udp: true },
  { name: "日本 东京 BGP", type: "hysteria2", region: "JP", flag: "🇯🇵", delay: 88, multiplier: 1.5, udp: true },
  { name: "日本 大阪", type: "trojan", region: "JP", flag: "🇯🇵", delay: 102, multiplier: 1 },
  { name: "新加坡 01", type: "vmess", region: "SG", flag: "🇸🇬", delay: 135, multiplier: 1, udp: true },
  { name: "新加坡 CN2", type: "vless", region: "SG", flag: "🇸🇬", delay: 121, multiplier: 2, udp: true },
  { name: "美国 洛杉矶", type: "hysteria2", region: "US", flag: "🇺🇸", delay: 168, multiplier: 1, udp: true },
  { name: "美国 圣何塞", type: "trojan", region: "US", flag: "🇺🇸", delay: 245, multiplier: 0.5 },
  { name: "台湾 Hinet", type: "vless", region: "TW", flag: "🇹🇼", delay: 67, multiplier: 2 },
  { name: "韩国 首尔", type: "vmess", region: "KR", flag: "🇰🇷", delay: 94, multiplier: 1 },
  { name: "英国 伦敦", type: "trojan", region: "UK", flag: "🇬🇧", delay: 312, multiplier: 1 },
  { name: "德国 法兰克福", type: "vless", region: "DE", flag: "🇩🇪", delay: -1, multiplier: 1 },
];

export const groups: ProxyGroup[] = [
  { name: "PROXY", type: "select", now: "AUTO", proxies: ["AUTO", "香港 IEPL 01", "日本 东京 BGP", "新加坡 01", "美国 洛杉矶", "DIRECT"] },
  { name: "AUTO", type: "url-test", now: "香港 IEPL 01", proxies: ["香港 IEPL 01", "香港 IEPL 02", "台湾 Hinet", "日本 东京 BGP"] },
  { name: "流媒体", type: "select", now: "新加坡 CN2", proxies: ["新加坡 CN2", "日本 东京 BGP", "美国 洛杉矶", "台湾 Hinet"] },
  { name: "AI 服务", type: "select", now: "日本 大阪", proxies: ["日本 大阪", "美国 圣何塞", "新加坡 01"] },
  { name: "兜底", type: "fallback", now: "香港 IEPL 01", proxies: ["香港 IEPL 01", "新加坡 01", "美国 洛杉矶"] },
];

export const subscriptions: Subscription[] = [
  {
    id: "sub1",
    name: "主力机场",
    url: "https://airport.example.com/sub?token=••••••••",
    used: 312.6,
    total: 1024,
    expire: "2026-12-31",
    nodeCount: 86,
    updatedAt: "42 分钟前",
    interval: 24,
    enabled: true,
  },
  {
    id: "sub2",
    name: "备用 IPLC",
    url: "https://backup.example.net/clash?sid=••••••",
    used: 47.2,
    total: 200,
    expire: "2026-09-15",
    nodeCount: 24,
    updatedAt: "6 小时前",
    interval: 12,
    enabled: true,
  },
];

export const rules: RuleItem[] = [
  { type: "GEOSITE", payload: "category-ads-all", target: "REJECT", hit: 18234 },
  { type: "GEOSITE", payload: "openai", target: "AI 服务", hit: 642 },
  { type: "GEOSITE", payload: "netflix", target: "流媒体", hit: 1289 },
  { type: "GEOSITE", payload: "youtube", target: "流媒体", hit: 9921 },
  { type: "GEOSITE", payload: "telegram", target: "PROXY", hit: 3344 },
  { type: "GEOSITE", payload: "google", target: "PROXY", hit: 7820 },
  { type: "GEOIP", payload: "telegram", target: "PROXY", hit: 211 },
  { type: "IP-CIDR", payload: "192.168.0.0/16", target: "DIRECT", hit: 45213 },
  { type: "GEOSITE", payload: "cn", target: "DIRECT", hit: 132904 },
  { type: "GEOIP", payload: "CN", target: "DIRECT", hit: 88123 },
  { type: "MATCH", payload: "", target: "PROXY", hit: 25612 },
];

export const ruleProviders: RuleProvider[] = [
  { name: "reject", type: "http", behavior: "domain", count: 12043, updatedAt: "2h" },
  { name: "proxy", type: "http", behavior: "domain", count: 8762, updatedAt: "2h" },
  { name: "direct", type: "http", behavior: "domain", count: 21588, updatedAt: "2h" },
  { name: "cncidr", type: "http", behavior: "ipcidr", count: 8453, updatedAt: "6h" },
];

const hosts = [
  ["chat.openai.com", "104.18.32.115", "AI 服务", "openai"],
  ["dns.google", "8.8.8.8", "PROXY", ""],
  ["www.youtube.com", "142.250.66.78", "流媒体", "youtube"],
  ["api.telegram.org", "149.154.167.220", "PROXY", "telegram"],
  ["github.com", "20.205.243.166", "PROXY", "github"],
  ["registry.npmjs.org", "104.16.31.34", "PROXY", ""],
  ["i.pximg.net", "210.140.92.143", "流媒体", "pixiv"],
  ["mirrors.tuna.tsinghua.edu.cn", "101.6.15.130", "DIRECT", "cn"],
  ["update.microsoft.com", "13.107.4.50", "DIRECT", ""],
  ["weixin.qq.com", "120.232.16.30", "DIRECT", "cn"],
];

export function genConnections(): Connection[] {
  return hosts.map((h, i) => {
    const chain = h[2] === "DIRECT" ? ["DIRECT"] : [h[2], "AUTO", "香港 IEPL 01"];
    return {
      id: "c" + i,
      host: h[0],
      destIP: h[1],
      type: i % 4 === 0 ? "UDP" : "TCP",
      rule: h[3] ? `GEOSITE,${h[3]}` : "MATCH",
      chain,
      upload: Math.round(Math.random() * 8_000_000),
      download: Math.round(Math.random() * 120_000_000),
      ulSpeed: Math.round(Math.random() * 90_000),
      dlSpeed: Math.round(Math.random() * 2_400_000),
      start: Date.now() - Math.round(Math.random() * 600_000),
      process: ["Safari", "Chrome", "Telegram", "node", "Music"][i % 5],
    };
  });
}

export function genTraffic(n = 40): TrafficPoint[] {
  const out: TrafficPoint[] = [];
  const now = Date.now();
  let down = 1800;
  let up = 240;
  for (let i = n - 1; i >= 0; i--) {
    down = Math.max(120, down + (Math.random() - 0.5) * 900);
    up = Math.max(40, up + (Math.random() - 0.5) * 200);
    out.push({ t: `-${i}s`, ts: now - i * 1000, down: Math.round(down), up: Math.round(up) });
  }
  return out;
}

export const system: SystemInfo = {
  hostname: "m-box",
  os: "Debian 12 (bookworm)",
  kernel: "6.1.0-21-amd64",
  uptime: "13天 4小时 22分",
  cpu: 12,
  mem: { used: 286, total: 1024 },
  disk: { used: 1.4, total: 8 },
  loadavg: [0.18, 0.22, 0.2],
  mboxVersion: "0.1.0",
};

export const dnsConfig: DnsConfig = {
  enable: true,
  enhancedMode: "fake-ip",
  fakeIpRange: "198.18.0.1/16",
  listen: "0.0.0.0:53",
  ipv6: false,
  nameservers: ["https://1.1.1.1/dns-query", "https://dns.google/dns-query"],
  defaultNameservers: ["223.5.5.5", "119.29.29.29"],
  fakeIpFilter: ["*.lan", "*.local", "+.market.xiaomi.com", "+.qq.com", "time.*.com", "+.pool.ntp.org"],
  fakeIpFilterMode: "blacklist",
  nameserverPolicy: [
    { domain: "geosite:cn", servers: ["https://223.5.5.5/dns-query", "https://119.29.29.29/dns-query"] },
    { domain: "geosite:geolocation-!cn", servers: ["https://1.1.1.1/dns-query"] },
  ],
  proxyServerNameserver: ["https://223.5.5.5/dns-query"],
  directNameserver: ["223.5.5.5", "119.29.29.29"],
  directNameserverFollowRule: false,
  fallback: ["tls://8.8.4.4", "tls://1.1.1.1"],
  fallbackFilter: {
    geoip: true,
    geoipCode: "CN",
    geosite: ["gfw"],
    ipcidr: ["240.0.0.0/4"],
    domain: ["+.google.com", "+.youtube.com"],
  },
  cacheAlgorithm: "lru",
  respectRules: false,
  adBlock: true,
  preferH3: false,
  useHosts: true,
  useSystemHosts: false,
  hosts: [
    { domain: "router.local", values: ["192.168.1.1"] },
    { domain: "nas.local", values: ["192.168.1.10"] },
  ],
};

export const tunConfig: TunConfig = {
  enable: true,
  device: "mbox-tun",
  stack: "mixed",
  autoRoute: true,
  autoRedirect: true,
  strictRoute: true,
  gso: false,
  endpointIndependentNat: false,
  dnsHijack: ["any:53", "tcp://any:53"],
  excludeCidr: ["192.168.0.0/16", "10.0.0.0/8"],
};

export const diagnostics: DiagItem[] = [
  { id: "core", label: "内核进程", desc: "mihomo 是否运行 & API 可达", status: "pass", detail: "mihomo v1.19.3 · API 127.0.0.1:9090 ✓" },
  { id: "tun", label: "TUN 网卡", desc: "mbox-tun 是否就绪、路由是否生效", status: "pass", detail: "mbox-tun up · auto-route ✓" },
  { id: "fwd", label: "IP 转发", desc: "net.ipv4.ip_forward", status: "pass", detail: "= 1" },
  { id: "dns", label: "DNS 解析", desc: "fake-ip 与上游连通", status: "pass", detail: "上游 1.1.1.1 RTT 38ms" },
  { id: "leak", label: "DNS 泄漏", desc: "出口 DNS 是否走加密上游", status: "warn", detail: "检测到 1 个本地回退，建议核查" },
  { id: "proxy", label: "代理连通", desc: "通过当前节点访问 gstatic", status: "pass", detail: "generate_204 · 204 · 46ms" },
  { id: "geo", label: "Geo 数据", desc: "geoip / geosite 是否最新", status: "pass", detail: "更新于 18 小时前" },
];
