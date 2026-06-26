# M-BOX

<p align="right"><a href="README.md">简体中文</a> · <b>English</b></p>

> A lightweight **transparent proxy gateway** — a dedicated side-router proxy box with a modern web panel, ready to use out of the box.

[![Telegram](https://img.shields.io/badge/Telegram-Group-2CA5E0?logo=telegram&logoColor=white)](https://t.me/m_boxpro)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Built on the [mihomo](https://github.com/MetaCubeX/mihomo) (Clash.Meta) kernel. A single Go daemon bundles "kernel process management + config generation + REST/WebSocket API + static panel" into one binary; the frontend is a real-time React + Vite panel. Install it on a Linux host as a **side-router** behind your main router to transparently proxy selected devices — no client needed on the devices, just point their gateway/DNS at it.

## Screenshots

| Dashboard | Rules & Config |
| :---: | :---: |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Rules](docs/screenshots/rules.png) |
| **Proxies** | **Settings** |
| ![Proxies](docs/screenshots/proxies.png) | ![Settings](docs/screenshots/settings.png) |

---

## 1. How it works

```
                ┌──────────────────────── M-BOX host ────────────────────────┐
   LAN devices   │                                                            │
 (gateway/DNS →  │   ┌── mbox daemon (single Go binary) ─────────────────┐    │
   M-BOX IP)     │   │  · manages the mihomo subprocess (start/reload)   │    │
      │          │   │  · reads/writes config.yaml (single source) +     │    │
      ▼          │   │    hot reload                                      │    │
  all traffic ───┼──▶│  · REST /api/* + WebSocket /ws/* (panel backend)  │    │
                 │   │  · serves the React panel (default :8088)          │    │
                 │   └───────────────┬───────────────────────────────────┘    │
                 │                   │ control (127.0.0.1:9090)                 │
                 │   ┌───────────────▼─────────── mihomo kernel ─────────┐    │
                 │   │  TUN(mbox-tun) + auto-route + auto-redirect        │    │
   egress ◀──────┼───│  fake-ip DNS(:53) + routing rules (GEOIP/GEOSITE)  │───▶│──▶ Internet / proxy nodes
                 │   └────────────────────────────────────────────────────┘    │
                 └────────────────────────────────────────────────────────────┘
```

Core mechanisms:

1. **Transparent proxy (no client app)**: mihomo creates an `mbox-tun` L3 interface with `auto-route` + `auto-redirect` (kernel nftables, faster than tproxy) + `strict-route` (anti-leak), taking over forwarded device traffic. Devices only need their gateway and DNS pointed at the M-BOX IP.
2. **DNS anti-pollution**: `fake-ip` mode + upstream encrypted DoH + `dns-hijack any:53`, eliminating DNS pollution/leaks and blocking ads at resolution time.
3. **Single source of truth**: every page (proxies, rules, DNS, TUN, subscriptions…) reads/writes the corresponding fragment of the same `config.yaml`; changes hot-reload instantly — no separate database to drift out of sync.
4. **Self-healing process**: the daemon binds the kernel lifecycle via `Pdeathsig` and reaps stray mihomo instances on startup, preventing multiple instances from fighting over TUN/ports.
5. **Multi-core**: Go uses all CPU cores by default; combined with NIC multi-queue, load spreads across cores under concurrency.

## 2. Features

- **Dashboard**: real-time up/down traffic (WebSocket), connections, mem/CPU/disk/load, rule hits, traffic split, local & proxy egress IP.
- **Proxies**: node list, group switching, batch latency test, **one-click auto-best** (composite score of latency/jitter/loss/multiplier).
- **Subscriptions**: add/remove/edit, auto-inject `proxy-providers` into groups, periodic auto-update.
- **Rules & Config** (3-in-1): rule editing + rule-sets (visually mapped to real config rules) + raw config editor / one-click recommended policy / backup-restore / import-export.
- **Proxy settings**: ports, auth, run mode, IPv6, performance (unified-delay / tcp-concurrent …), sniffer, GEO data update.
- **Device policy**: route specific devices (by IP/MAC) through proxy or direct.
- **Kernel management**: mihomo version check and **online one-click update**.
- **Logs**: mihomo kernel logs + M-BOX backend logs, live stream, level filter, search.
- **Settings**: theme (dark/light), system tuning (BBR / autostart / IP forwarding), service control, one-click diagnostics.
- **Modern UI**: macOS Liquid Glass style panel, dark/light themes.

## 3. Installation

### Requirements

- A **Linux host** with internet (Debian 12 recommended), **root**, kernel with **TUN** support.
- Bare metal / VM / cloud / container all work (this guide is platform-agnostic).
- Architectures: `amd64` / `arm64`.

> Tip: give it a **static IP** when used as a side-router.

### Method A: offline package (recommended, no go/npm needed)

Download the package for your architecture from [Releases](https://github.com/ike-sh/M-BOX/releases) (kernel / geo data / frontend / default config all bundled, fully offline):

```bash
tar -xzf mbox-v0.1.0-linux-amd64.tar.gz
cd mbox-v0.1.0-linux-amd64
sudo bash install.sh
# custom panel port (default 8088):
# sudo MBOX_PORT=8088 bash install.sh
```

### Method B: build from source

Requires `go` and `node/npm` on the host (the script builds backend & frontend on the fly):

```bash
git clone https://github.com/ike-sh/M-BOX.git
cd M-BOX
sudo bash scripts/install.sh
# install with a subscription:
# sudo MBOX_SUB_URL="https://your-subscription" bash scripts/install.sh
```

### After install

1. **Open the panel**: `http://<host-ip>:8088`.
2. **Add nodes**: paste an airport subscription under "Subscriptions", or add manually under "Proxies".
3. **Onboard devices**: in your main router / DHCP, point the **gateway** and **DNS** of the devices you want proxied at the M-BOX IP.
4. **Verify**: devices can reach the internet; check no DNS leak at <https://browserleaks.com/dns>; "Settings → Diagnostics" all pass.

### Common commands

```bash
systemctl status  mbox-daemon
journalctl -u     mbox-daemon -f
systemctl restart mbox-daemon
systemctl stop    mbox-daemon
sudo mbox-uninstall              # uninstall & restore (registered by the offline package)
# also remove config: sudo PURGE=1 mbox-uninstall
```

### Key options (env / flags)

| flag | env | default | description |
| --- | --- | --- | --- |
| `-listen` | `MBOX_LISTEN` | `0.0.0.0:8088` | panel listen address |
| `-workdir` | `MBOX_WORKDIR` | `/etc/mbox` | working dir (config.yaml / geo / web) |
| `-mihomo` | `MBOX_MIHOMO_BIN` | `mihomo` | mihomo binary path |
| `-controller` | `MBOX_CONTROLLER` | `127.0.0.1:9090` | mihomo external-controller |
| `-manage` | `MBOX_MANAGE` | `1` | whether the daemon manages the mihomo subprocess |

## 4. Security notes

- mihomo's external-controller and the local proxy port bind to `127.0.0.1` by default.
- The panel has no auth by default (intended for LAN use); **never expose the panel/API port to the public internet** — use Tailscale / WireGuard for remote access.

## 5. Community & feedback

- **Telegram group**: <https://t.me/m_boxpro> — installation, configuration and usage questions welcome.
- **GitHub Issues**: report bugs or request features via [Issues](https://github.com/ike-sh/M-BOX/issues).

## Credits

- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) — proxy kernel
- [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) — GeoIP / GeoSite data

## License

Released under the [MIT License](LICENSE).
