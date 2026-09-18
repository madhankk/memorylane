# Phase 10 desktop shell decision

Measured on Windows x64 on 2026-09-18 after the required and optional feature payloads were extracted from core. Both shells use the same prepared Node/server runtime.

## Results

| Measurement | Electron | Go native tray |
| --- | ---: | ---: |
| Shell executable / Electron support payload | 364.4 MiB | 3.32 MiB |
| Runtime | 141.3 MiB | 141.3 MiB |
| Unpacked application | 505.7 MiB | 144.6 MiB |
| Compressed Go application ZIP | — | 52.6 MiB |
| Idle processes | 3 | 1 |
| Idle working set | 178.5 MiB | 12.0 MiB |
| Idle private bytes | 100.9 MiB | 44.9 MiB |
| Tray-ready time | 145 ms | 92 ms |

The native package removes 361.1 MiB unpacked, or 71.4% of the extracted application. Its compressed application payload is comfortably below the 200 MiB core installer goal before installer metadata and signing. The comparison ZIP is 55,168,789 bytes with SHA-256 `C252ED4C9198AB64C0097735A0B6068B0731F5DFFD61858951DFFCCAF10D3138`.

The measurements are reproducible through the opt-in `MEMORYLANE_TRAY_READY_FILE` marker in both shells. `MEMORYLANE_TRAY_NO_AUTOSTART=1` keeps the Go measurement to the shell itself. Memory is the total working set/private bytes after the tray has settled, before starting the MemoryLane server.

## Capability comparison

| Concern | Electron shell | Go proof of concept |
| --- | --- | --- |
| UI | Chromium status window plus tray | Native tray; opens the existing browser UI |
| Process supervision | Starts/stops bundled Node | Starts/stops bundled Node process tree |
| Local security | Random per-launch desktop token | Same random per-launch desktop token |
| Windows tray | Shipped | Working proof of concept |
| macOS tray | Shipped Electron implementation | Compiles as a pure-Go arm64 binary; runtime test still requires a Mac |
| Signing | Existing Azure Trusted Signing and Developer ID hooks | Sign the single Go executable with the same Windows certificate; sign the `.app`, Node runtime, and native modules on macOS |
| Core updates | Electron/Squirrel implementation | Signed Ed25519 manifest, verified download, and platform installer launch |
| Launch at login | Electron API | Windows HKCU Run and macOS LaunchAgent integration |

The tray dependency is pure Go and builds with `CGO_ENABLED=0`, so release builders do not need a C toolchain or Rust. The macOS binary compiled successfully from Windows; notification/tray behavior, codesigning, notarization, and Login Items still need validation on a Mac.

## Decision

The Go native tray is the production desktop shell. It now owns core updates, launch-at-login, signing, notarization, and packaging; the Electron application and dependencies have been removed.

The proof of concept is in `tray-go/`. The Windows comparison package is `tray-go/release-phase10/MemoryLane-win32-x64`, and its ZIP is ready for inspection beside it.
