# Deskoy

Deskoy is a Windows desktop **decoy utility**: press a hotkey and your screen is replaced by a believable “cover” window (Excel / VS Code / Google Docs / Jira Board / BI dashboard / blank), or an optional custom source (URL or local file).

See [`LICENSE`](LICENSE) for licensing information.

Deskoy is **actively maintained**: we release updates on a regular cadence, respond to user feedback, and keep compatibility and documentation current where it matters for day-to-day use.

## Download

Download Deskoy at [deskoy.com/download](https://www.deskoy.com/download).

## What it does (product behavior)

- Hotkey toggles a full-screen cover window on/off (manual mode)
- Built-in cover presets (Excel / VS Code / Google Docs / Jira / BI / blank)
- Optional **Custom Cover Override**:
  - URL cover (best-effort; some sites won’t render due to auth/CSP/proxies)
  - Local file cover (HTML/images are the most reliable)
- **Fallback behavior**: if override is enabled but its source is empty, Deskoy falls back to the selected built-in preset
- Optional “Mute audio on cover” (only applies when the cover is opened via hotkey **and** you’re using a built-in preset; it does not run for URL/file override flows)

## Safety / disclaimer

Deskoy is a decoy tool for reducing casual exposure (e.g. shoulder-surfing or screen-share “oops” moments). It is **not** a security product and does not protect against malware, screen recording, remote admin tools, or a determined attacker with access to your device.

## Codebase notes (for developers)

- **App**: Electron + TypeScript (`src/`, `forge.config.ts`, webpack configs)
- **Feedback / bug reports**: use a separate server-side relay.

## Docs

User documentation lives at [Deskoy docs](https://www.deskoy.com/docs).
