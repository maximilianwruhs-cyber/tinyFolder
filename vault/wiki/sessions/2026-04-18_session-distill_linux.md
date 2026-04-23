---
title: Session Distillation — Linux
type: topic
tags:
  - session-log
  - linux
  - distilled
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Session Distillation — Linux

*Distilled from 1 artifacts (19 KB) across multiple development sessions.*


## Source: linux_architecture_study.md (session 1ae46419)

# Architecting the Minimalist Linux Desktop — Deep Study Notes

> Study of NotebookLM `2050665d-2978-47d4-bec0-313d75032a04`
> 4 sources, ~128k chars total. All pasted text ("Eingefügter Text").

---

## Source Map

| # | Topic | Key Decision | Char Count |
|---|-------|-------------|-----------|
| 1 | Minimalist distro selection (Alpine vs. Void vs. Debian) | Which libc + init to live inside | 34,176 |
| 2 | Universal boot media engineering (BIOS/UEFI/Hybrid) | How to make one USB boot everywhere | 32,163 |
| 3 | Portable AI inference on arbitrary hardware | How to run LLMs without controlling the host | 31,188 |
| 4 | Live OS persistence models (OverlayFS vs. writable rootfs) | How to persist state on flash without destroying it | 31,055 |

---

## Source 1 — Minimalist Desktop Distro Analysis

### The Core Architectural Stack

| Layer | Debian (netinst) | Void Linux | Alpine Linux |
|-------|-----------------|------------|-------------|
| Package Manager | APT (dpkg, .deb) | XBPS (xbps-install) | APK (apk add) |
| Init System | systemd | runit | OpenRC |
| Userland | GNU Coreutils | GNU Coreutils | BusyBox |
| C Library | glibc | **glibc or musl** (user chooses) | musl |
| Philosophy | Universal compatibility | Independent pragmatism | Extreme security & size reduction |

### The libc Crucible: glibc vs. musl

The single most consequential low-level choice. musl (2011) is strict POSIX/ISO C, lightweight, excellent for static linking, reduced attack surface. glibc is the de facto standard — massive, GNU-extension-heavy, but universally assumed by the entire proprietary Linux software ecosystem.

**Where musl breaks the desktop:**
- **NVIDIA proprietary user-space** (control panels, OpenGL/Vulkan implementations) — hard-linked to glibc. Forces Nouveau on musl hosts.
- **Electron apps** (VSCode, Discord, Slack, Obsidian) — Chromium's memory allocator depends on glibc behaviors. Crashes or degrades on musl.
- **Python wheels** — `manylinux` standard assumes glibc. `pip install numpy` on Alpine triggers full source compilation. `musllinux` (PEP 600) exists but adoption lags.
- **Node.js native bindings** — precompiled against glibc. `libc6-compat` shim required on Alpine, polluting purity.
- **Rust** — must explicitly target `x86_64-unknown-linux-musl`; linking external C libs may require `musl-gcc` wrappers.

**Workarounds:** Flatpak (bundles its own glibc runtime — defeats minimalism), `gcompat`/`libc6-compat` (imperfect shims), glibc chroot via `voidnsrun`.

### Init Systems

**systemd (Debian):** Monolithic. Parallel startup, socket activation, cgroups, journald, logind for power management. Seamless lid-switch suspend, encrypted home dirs, D-Bus brokering. Trade-off: hundreds of MB more RAM at idle, opaque debugging.

**runit (Void):** Microscopic codebase. Services are directories in `/etc/sv/` with a `run` script. Enable = symlink to `/var/service/`. `sv up|down|status` is instantaneous. No syslog by default — install `socklog`. Per-user services require `runsvdir` or `turnstile`. Fast boot, negligible overhead.

**OpenRC (Alpine):** Dependency-based (`need net`, `after firewall`). Parallel execution. Shell scripts in `/etc/init.d/`. Transparent, scriptable. Not a supervisor by default (added via `supervise-daemon`).

### Power Management Without systemd

On Alpine: no `logind` → no automatic ACPI handling. Must manually:
1. Install `acpid2`
2. Write `/etc/acpi.map` mapping hex codes (`EV_SW 0x05 SW_LID 0 1`) to custom scripts
3. Script calls `zzz` or `powerctl` for suspend
4. Hook `swaylock` before/after suspend for Wayland compositors

### Hardware & Firmware

Debian 12+ shifted policy: `non-free-firmware` repo component ships by default. netinst auto-detects and installs firmware blobs (Intel Wi-Fi, AMD/NVIDIA). Alpine/Void require manual `linux-firmware`, `wpa_supplicant`, explicit kernel module loading via `/etc/modules-load.d/`.

### The Verdict

- **Debian netinst** = pragmatic. `--no-install-recommends` gives illu

*[...truncated for embedding efficiency]*
