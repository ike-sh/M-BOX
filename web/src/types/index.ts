// M-BOX 领域模型（与 daemon API 对齐的前端类型）

export type CoreStatus = "running" | "stopped" | "reloading" | "error";

export type ProxyType =
  | "ss"
  | "vmess"
  | "vless"
  | "trojan"
  | "hysteria2"
  | "tuic"
  | "wireguard"
  | "direct";

export interface ProxyNode {
  name: string;
  type: ProxyType;
  /** 节点所属区域，用于显示旗帜 */
  region: string;
  flag: string;
  /** 延迟 ms，-1 表示超时/不可用 */
  delay: number;
  /** 倍率 */
  multiplier?: number;
  udp?: boolean;
}

export type GroupType = "select" | "url-test" | "fallback" | "load-balance";

export interface ProxyGroup {
  name: string;
  type: GroupType;
  now: string;
  icon?: string;
  proxies: string[];
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  /** 已用 / 总量，单位 GB；-1 表示未知 */
  used: number;
  total: number;
  expire: string;
  nodeCount: number;
  updatedAt: string;
  interval: number; // hours
  enabled: boolean;
}

export type RuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "DOMAIN-KEYWORD"
  | "GEOSITE"
  | "GEOIP"
  | "IP-CIDR"
  | "PROCESS-NAME"
  | "RULE-SET"
  | "MATCH";

export interface RuleItem {
  type: RuleType;
  payload: string;
  target: string;
  hit?: number;
}

export interface RuleProvider {
  name: string;
  type: "http" | "file";
  behavior: "domain" | "ipcidr" | "classical";
  count: number;
  updatedAt: string;
}

export interface Connection {
  id: string;
  host: string;
  destIP: string;
  type: string; // TCP/UDP
  rule: string;
  chain: string[];
  upload: number; // bytes
  download: number; // bytes
  ulSpeed: number; // bytes/s
  dlSpeed: number; // bytes/s
  start: number; // ts
  process?: string;
}

export interface TrafficPoint {
  t: string; // 人类可读时分秒（后端 "15:04:05"，兼容字段）
  ts: number; // unix 毫秒时间戳，用于图表精确对齐时间轴（后端新增）
  up: number; // KB/s
  down: number; // KB/s
}

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  cpu: number; // %
  mem: { used: number; total: number }; // MB
  disk: { used: number; total: number }; // GB
  loadavg: [number, number, number];
  core?: {
    status: string;
    version: string;
    managed: boolean;
    error?: string;
  };
  /** M-BOX 自身版本（后端注入）。 */
  mboxVersion?: string;
}

export interface DnsPolicyEntry {
  domain: string;
  servers: string[];
}

export interface DnsFallbackFilter {
  geoip: boolean;
  geoipCode: string;
  geosite: string[];
  ipcidr: string[];
  domain: string[];
}

export interface DnsHostEntry {
  domain: string;
  values: string[];
}

export interface DnsConfig {
  enable: boolean;
  enhancedMode: "fake-ip" | "redir-host";
  fakeIpRange: string;
  listen: string;
  ipv6: boolean;
  nameservers: string[];
  defaultNameservers: string[];
  fakeIpFilter: string[];
  fakeIpFilterMode: "blacklist" | "whitelist";
  nameserverPolicy: DnsPolicyEntry[];
  proxyServerNameserver: string[];
  directNameserver: string[];
  directNameserverFollowRule: boolean;
  fallback: string[];
  fallbackFilter: DnsFallbackFilter;
  cacheAlgorithm: "lru" | "arc";
  respectRules: boolean;
  adBlock: boolean;
  preferH3: boolean;
  useHosts: boolean;
  useSystemHosts: boolean;
  hosts: DnsHostEntry[];
}

export interface TunConfig {
  enable: boolean;
  device: string;
  stack: "system" | "gvisor" | "mixed";
  autoRoute: boolean;
  autoRedirect: boolean;
  strictRoute: boolean;
  gso: boolean;
  endpointIndependentNat: boolean;
  dnsHijack: string[];
  excludeCidr: string[];
}

export interface DiagItem {
  id: string;
  label: string;
  desc: string;
  status: "idle" | "running" | "pass" | "warn" | "fail";
  detail?: string;
}

export interface GatewayStatus {
  tunEnable: boolean;
  ipForward: boolean;
  autostart: boolean;
  coreRunning: boolean;
  managed: boolean;
}

export interface GatewayStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface GatewayResult {
  enabled: boolean;
  ok: boolean;
  steps: GatewayStep[];
}

// ---- M4 ----

export interface KernelInfo {
  kind: string;
  displayName: string;
  defaultBin: string;
  configFile: string;
  releaseRepo: string;
  clashApi: boolean;
  current: boolean;
  installed: string; // 磁盘上二进制版本，空=未安装
  latest: string; // GitHub 最新版本，空=未知
  running: boolean; // 当前内核且控制器可达
}

export interface KernelsResp {
  current: string;
  os: string;
  arch: string;
  kernels: KernelInfo[];
}

export interface GeneralSniffer {
  enable: boolean;
  overrideDestination: boolean;
  http: boolean;
  tls: boolean;
  quic: boolean;
}

// GeneralConfig 是「代理设置」页的综合配置（端口/基础/性能/网络/嗅探/GEO/认证）。
export interface GeneralConfig {
  mixedPort: number;
  socksPort: number;
  httpPort: number;
  allowLan: boolean;
  logLevel: string;
  unifiedDelay: boolean;
  tcpConcurrent: boolean;
  findProcessMode: string;
  globalClientFingerprint: string;
  interfaceName: string;
  routingMark: number;
  keepAliveInterval: number;
  keepAliveIdle: number;
  disableKeepAlive: boolean;
  globalUa: string;
  geodataMode: boolean;
  geoAutoUpdate: boolean;
  geoUpdateInterval: number;
  geodataLoader: string;
  authentication: string[];
  sniffer: GeneralSniffer;
  // 节点测速参数（面板侧设置，供节点测试使用）。
  testUrl: string;
  testTimeout: number;
  testInterval: number;
}

/** 按设备策略：把某个源 IP/网段的流量定向到指定策略组/直连/拦截。 */
export interface DevicePolicy {
  id: string;
  name: string;
  ip: string;
  target: string;
  enabled: boolean;
}

/** 在线设备实时聚合（按源 IP 统计的活动连接与流量）。 */
export interface DeviceLive {
  ip: string;
  connCount: number;
  ulSpeed: number; // bytes/s
  dlSpeed: number; // bytes/s
  upload: number; // bytes（本次连接累计）
  download: number; // bytes
}

/** 历史流量时间桶（小时/天聚合）。 */
export interface TrafficBucket {
  key: string; // 小时 "2006-01-02T15" 或 天 "2006-01-02"
  up: number; // 累计上行字节
  down: number; // 累计下行字节
}

/** 历史流量聚合（跨重启持久化）。 */
export interface TrafficStats {
  hourly: TrafficBucket[];
  daily: TrafficBucket[];
}

export interface IPv6Status {
  enabled: boolean;
  top: boolean;
  dns: boolean;
  consistent: boolean;
}

