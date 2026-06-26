<#
.SYNOPSIS
  M-BOX 离线整包构建脚本（Windows / PowerShell）。

.DESCRIPTION
  交叉编译 mbox(daemon) + 构建前端 + 下载 mihomo 内核与 geo 数据，
  连同开箱即用默认配置和离线安装脚本打成一个 tar.gz。
  产物可直接传到 Debian 旁路由，解压后 `sudo bash install.sh` 即完成部署。

  下载内容会缓存到 scripts/.cache，重复打包不再重复下载。

.PARAMETER Arch
  目标架构，可多选：amd64 / arm64。默认两个都打。

.PARAMETER MihomoVersion
  mihomo 版本（如 v1.19.27）。默认 latest（联网查询最新 stable）。

.PARAMETER GhMirror
  GitHub 下载镜像前缀（国内加速用），形如 https://ghfast.top。
  留空表示直连 github.com。注意：本脚本在打包机运行，能直连就留空。

.PARAMETER SkipWeb
  跳过前端构建（直接复用已存在的 web/dist）。

.EXAMPLE
  pwsh scripts/build-package.ps1
  pwsh scripts/build-package.ps1 -Arch amd64 -MihomoVersion v1.19.27
#>
[CmdletBinding()]
param(
  [ValidateSet('amd64', 'arm64')]
  [string[]]$Arch = @('amd64', 'arm64'),
  [string]$MihomoVersion = 'latest',
  [string]$GhMirror = '',
  [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ── 路径 ────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$CacheDir  = Join-Path $ScriptDir '.cache'
$OutDir    = Join-Path $RepoRoot 'dist-pkg'
$StageRoot = Join-Path $RepoRoot '.pkg-stage'

# M-BOX 自身版本（单一来源：仓库根 VERSION 文件），用于命名产物并注入二进制。
$MBoxVersion = '0.1.0'
$VerFile = Join-Path $RepoRoot 'VERSION'
if (Test-Path $VerFile) { $MBoxVersion = ((Get-Content $VerFile -Raw).Trim()) }

function Log  { param($m) Write-Host "[M-BOX] $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "[M-BOX] $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "[M-BOX] $m" -ForegroundColor Red; exit 1 }

# ── 工具检查 ────────────────────────────────────────────────────────
foreach ($c in @('go', 'tar')) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Die "缺少命令：$c" }
}
if (-not $SkipWeb -and -not (Get-Command 'npm' -ErrorAction SilentlyContinue)) {
  Die '缺少 npm（构建前端需要），或加 -SkipWeb 复用已有 web/dist'
}

New-Item -ItemType Directory -Force -Path $CacheDir, $OutDir | Out-Null

# ── 下载（带缓存）与 gzip 解压 ──────────────────────────────────────
function Resolve-Url {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($GhMirror)) { return $Url }
  return ($GhMirror.TrimEnd('/') + '/' + $Url)
}

function Get-Cached {
  param([string]$Url, [string]$OutFile)
  if (Test-Path $OutFile) {
    Log "缓存命中：$(Split-Path -Leaf $OutFile)"
    return
  }
  $real = Resolve-Url $Url
  Log "下载：$real"
  $tmp = "$OutFile.part"
  Invoke-WebRequest -Uri $real -OutFile $tmp -UseBasicParsing -TimeoutSec 120
  Move-Item -Force $tmp $OutFile
}

function Expand-Gzip {
  param([string]$Src, [string]$Dst)
  $in  = [System.IO.File]::OpenRead($Src)
  $out = [System.IO.File]::Create($Dst)
  try {
    $gz = New-Object System.IO.Compression.GzipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
    try { $gz.CopyTo($out) } finally { $gz.Dispose() }
  } finally {
    $out.Dispose(); $in.Dispose()
  }
}

# Copy-TextLf 复制文本文件并强制 LF 换行 + 无 BOM。
# 关键：在 Windows 打包时若把 CRLF 的 .sh 直接塞进包，Linux bash 会因行尾 \r 报
# "set: invalid option name" 等错误。所有进包的脚本/配置都走它，保证 Linux 可用。
function Copy-TextLf {
  param([string]$Src, [string]$Dst)
  $text = [System.IO.File]::ReadAllText($Src)
  $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
  [System.IO.File]::WriteAllText($Dst, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# ── 版本解析 ────────────────────────────────────────────────────────
if ($MihomoVersion -eq 'latest') {
  Log '查询 mihomo 最新 stable 版本…'
  $api = Resolve-Url 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
  $MihomoVersion = (Invoke-WebRequest -Uri $api -UseBasicParsing -TimeoutSec 30 | ConvertFrom-Json).tag_name
  if (-not $MihomoVersion) { Die '无法获取 mihomo 最新版本，请用 -MihomoVersion 显式指定' }
}
Log "mihomo 版本：$MihomoVersion"

# 架构 → mihomo 资产名 token（amd64 用 compatible 以兼容老 CPU / 各类 VM）。
$ArchAsset = @{ 'amd64' = 'amd64-compatible'; 'arm64' = 'arm64' }

# ── geo 数据（两架构通用，下载一次）──────────────────────────────────
$GeoBase = 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest'
foreach ($f in @('geoip.dat', 'geosite.dat')) {
  Get-Cached "$GeoBase/$f" (Join-Path $CacheDir $f)
}

# ── 前端构建（一次，所有架构共用）──────────────────────────────────
$WebDist = Join-Path $RepoRoot 'web\dist'
if ($SkipWeb) {
  if (-not (Test-Path $WebDist)) { Die "指定了 -SkipWeb 但不存在 $WebDist" }
  Log "复用已有前端：$WebDist"
} else {
  Log '构建前端（npm install && npm run build）…'
  Push-Location (Join-Path $RepoRoot 'web')
  try {
    if (Test-Path 'package-lock.json') { npm ci } else { npm install }
    if ($LASTEXITCODE -ne 0) { Die 'npm 依赖安装失败' }
    npm run build
    if ($LASTEXITCODE -ne 0) { Die '前端构建失败' }
  } finally { Pop-Location }
}
if (-not (Test-Path $WebDist)) { Die "前端产物缺失：$WebDist" }

# ── 逐架构组包 ──────────────────────────────────────────────────────
$DefaultConfig = Join-Path $RepoRoot 'internal\config\default.yaml'
if (-not (Test-Path $DefaultConfig)) { Die "缺少默认配置：$DefaultConfig" }

$built = @()
foreach ($a in $Arch) {
  Log "=== 组装 linux-$a ==="
  $pkgName = "mbox-v$MBoxVersion-linux-$a"
  $stage   = Join-Path $StageRoot $pkgName
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'bin'), (Join-Path $stage 'geo') | Out-Null

  # 1) 交叉编译 daemon
  Log "交叉编译 mbox (linux/$a)…"
  $env:GOOS = 'linux'; $env:GOARCH = $a; $env:CGO_ENABLED = '0'
  Push-Location $RepoRoot
  try {
    go build -trimpath -ldflags "-s -w -X github.com/mbox/mbox/internal/version.Version=$MBoxVersion" -o (Join-Path $stage 'mbox') ./cmd/mbox
    if ($LASTEXITCODE -ne 0) { Die "go build 失败 (linux/$a)" }
  } finally { Pop-Location }

  # 2) 下载并解压 mihomo 内核
  $token = $ArchAsset[$a]
  $gzName = "mihomo-linux-$token-$MihomoVersion.gz"
  $gzUrl  = "https://github.com/MetaCubeX/mihomo/releases/download/$MihomoVersion/$gzName"
  $gzPath = Join-Path $CacheDir $gzName
  Get-Cached $gzUrl $gzPath
  Log "解压 mihomo → bin/mihomo"
  Expand-Gzip $gzPath (Join-Path $stage 'bin\mihomo')

  # 3) geo 数据
  Copy-Item (Join-Path $CacheDir 'geoip.dat')   (Join-Path $stage 'geo\geoip.dat')   -Force
  Copy-Item (Join-Path $CacheDir 'geosite.dat') (Join-Path $stage 'geo\geosite.dat') -Force

  # 4) 前端
  Copy-Item $WebDist (Join-Path $stage 'web') -Recurse -Force

  # 5) 默认配置 + 安装脚本（强制 LF + 无 BOM，避免 Windows CRLF 让 Linux bash 报错）
  Copy-TextLf $DefaultConfig (Join-Path $stage 'config.yaml')
  Copy-TextLf (Join-Path $ScriptDir 'offline-install.sh')   (Join-Path $stage 'install.sh')
  Copy-TextLf (Join-Path $ScriptDir 'offline-uninstall.sh') (Join-Path $stage 'uninstall.sh')

  # 6) 版本信息 + 中文说明
  "M-BOX v$MBoxVersion 离线整包`nmihomo: $MihomoVersion`narch: linux-$a`nbuilt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" |
    Set-Content -Path (Join-Path $stage 'VERSION') -Encoding utf8
  @"
M-BOX 离线整包（linux-$a）

部署（Debian 12 旁路由，root）：
  1. 解压：    tar -xzf $pkgName.tar.gz
  2. 进目录：  cd $pkgName
  3. 安装：    sudo bash install.sh
  4. 按提示打开面板地址，局域网设备浏览器访问即可。

卸载：sudo bash uninstall.sh （加 PURGE=1 连配置一起删）

包内已内置：mbox 后端 / mihomo 内核 / geoip+geosite / 前端面板 / 默认配置，
全程离线安装，无需联网。
"@ | Set-Content -Path (Join-Path $stage 'README.txt') -Encoding utf8

  # 7) 打 tar.gz（在 StageRoot 下打包目录名，保证解压后是同名子目录）
  $tarball = Join-Path $OutDir "$pkgName.tar.gz"
  if (Test-Path $tarball) { Remove-Item -Force $tarball }
  Log "打包：$tarball"
  Push-Location $StageRoot
  try {
    tar -czf $tarball $pkgName
    if ($LASTEXITCODE -ne 0) { Die 'tar 打包失败' }
  } finally { Pop-Location }

  $size = '{0:N1} MB' -f ((Get-Item $tarball).Length / 1MB)
  $built += [pscustomobject]@{ Arch = $a; File = $tarball; Size = $size }
}

# 清理环境变量与暂存
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
if (Test-Path $StageRoot) { Remove-Item -Recurse -Force $StageRoot }

Log '全部完成 ✅  产物：'
$built | ForEach-Object { Write-Host ("  {0,-6}  {1}  ({2})" -f $_.Arch, $_.File, $_.Size) }
