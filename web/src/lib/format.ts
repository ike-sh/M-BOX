// 格式化工具

export function bytes(n: number, fixed = 1): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(fixed)} ${u[i]}`;
}

export function speed(bytesPerSec: number): { val: string; unit: string } {
  if (bytesPerSec < 1024) return { val: String(Math.round(bytesPerSec)), unit: "B/s" };
  const u = ["KB/s", "MB/s", "GB/s"];
  let n = bytesPerSec;
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return { val: n.toFixed(n >= 100 ? 0 : 1), unit: u[i] };
}

// cleanNodeName 去掉节点名里的国旗 emoji（区域指示符 U+1F1E6–U+1F1FF）与开头的
// 分隔符/空白。机场常给节点名加国旗前缀，而 Windows 浏览器不渲染国旗，会显示成
// "US"/"JP" 之类的字母对乱码；这里仅用于「展示」清理，原始名仍用于选择/请求。
export function cleanNodeName(name: string): string {
  const cleaned = name
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-_|·•:：]+/, "")
    .trim();
  return cleaned || name;
}

export function latencyClass(ms: number): string {
  if (ms < 0) return "lat-dead";
  if (ms < 120) return "lat-good";
  if (ms < 300) return "lat-mid";
  return "lat-bad";
}

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
