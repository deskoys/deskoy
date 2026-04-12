import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
} from 'electron';
import { existsSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import Store from 'electron-store';
import { onCoverCloseAudio, onCoverOpenAudio } from './windows-session';
import dotenv from 'dotenv';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const COVER_EXCEL_WEBPACK_ENTRY: string;
declare const COVER_VSCODE_WEBPACK_ENTRY: string;
declare const COVER_DOCS_WEBPACK_ENTRY: string;
declare const COVER_JIRA_WEBPACK_ENTRY: string;
declare const COVER_BI_WEBPACK_ENTRY: string;
/** Injected at `npm run make` / `package` from env (see webpack.plugins.ts). */
declare const __DESKOY_BUILD_FEEDBACK_WEBHOOK__: string;
declare const __DESKOY_BUILD_BUG_WEBHOOK__: string;

/** Hardcoded until a server-side license API exists. Only this key is accepted (dev + packaged). */
const BUILTIN_LICENSE_KEY = '2345r';

function isBuiltinLicenseKey(key: string): boolean {
  return key.trim() === BUILTIN_LICENSE_KEY;
}

// Load `.env` / `.env.local` before reading Discord webhook env vars.
// Packaged apps are often started with cwd = System32 or the install folder; include userData,
// resources, and the folder containing the .exe so webhooks still resolve after NSIS install.
try {
  const roots: string[] = [];
  try {
    if (app.isPackaged) {
      roots.push(app.getPath('userData'));
      if (process.resourcesPath) roots.push(process.resourcesPath);
      roots.push(path.dirname(process.execPath));
    }
  } catch {
    // ignore
  }
  roots.push(
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  );
  for (const root of roots) {
    const pLocal = path.join(root, '.env.local');
    const pEnv = path.join(root, '.env');
    if (existsSync(pLocal)) {
      dotenv.config({ path: pLocal, override: true });
      break;
    }
    if (existsSync(pEnv)) {
      dotenv.config({ path: pEnv, override: false });
      break;
    }
  }
} catch {
  // ignore
}

// Discord webhooks — resolved lazily (env after dotenv, optional JSON file, then build-time constants).
// Env vars: DESKOY_DISCORD_FEEDBACK_WEBHOOK_URL or DESKOY_FEEDBACK_WEBHOOK_URL (and *_BUG_*).
// File: deskoy-webhooks.json with { "feedback": "https://discord.com/api/webhooks/...", "bug": "..." }
// in userData, resources, exe directory, or repo cwd (see readDeskoyWebhooksJson).
let discordFeedbackWebhookResolved = '';
let discordBugWebhookResolved = '';
let discordWebhooksResolved = false;

function readDeskoyWebhooksJson(): { feedback: string; bug: string } {
  const dirs: string[] = [];
  try {
    if (app.isPackaged) {
      dirs.push(app.getPath('userData'));
      if (process.resourcesPath) dirs.push(process.resourcesPath);
      dirs.push(path.dirname(process.execPath));
    }
  } catch {
    // ignore
  }
  dirs.push(
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  );
  const seen = new Set<string>();
  for (const dir of dirs) {
    const p = path.join(dir, 'deskoy-webhooks.json');
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, 'utf8')) as { feedback?: unknown; bug?: unknown };
      return {
        feedback: String(j.feedback ?? '').trim(),
        bug: String(j.bug ?? '').trim(),
      };
    } catch {
      // try next location
    }
  }
  return { feedback: '', bug: '' };
}

function resolveDiscordWebhooks(): void {
  if (discordWebhooksResolved) return;
  discordWebhooksResolved = true;

  const envFeedback =
    process.env.DESKOY_DISCORD_FEEDBACK_WEBHOOK_URL?.trim() ||
    process.env.DESKOY_FEEDBACK_WEBHOOK_URL?.trim() ||
    '';
  const envBug =
    process.env.DESKOY_DISCORD_BUG_WEBHOOK_URL?.trim() ||
    process.env.DESKOY_BUG_WEBHOOK_URL?.trim() ||
    '';

  const file = readDeskoyWebhooksJson();

  const buildFeedback =
    typeof __DESKOY_BUILD_FEEDBACK_WEBHOOK__ === 'string' ? __DESKOY_BUILD_FEEDBACK_WEBHOOK__.trim() : '';
  const buildBug = typeof __DESKOY_BUILD_BUG_WEBHOOK__ === 'string' ? __DESKOY_BUILD_BUG_WEBHOOK__.trim() : '';

  discordFeedbackWebhookResolved = envFeedback || file.feedback || buildFeedback;
  discordBugWebhookResolved = envBug || file.bug || buildBug;
}

function getDiscordFeedbackWebhook(): string {
  resolveDiscordWebhooks();
  return discordFeedbackWebhookResolved;
}

function getDiscordBugWebhook(): string {
  resolveDiscordWebhooks();
  return discordBugWebhookResolved;
}

// Production relay (server holds Discord webhook secrets). Default: api subdomain on deskoy.com.
// Override with DESKOY_FEEDBACK_RELAY_URL / DESKOY_BUG_RELAY_URL for staging or custom hosts.
const DESKOY_FEEDBACK_RELAY_URL =
  process.env.DESKOY_FEEDBACK_RELAY_URL?.trim() || 'https://api.deskoy.com/api/feedback';
const DESKOY_BUG_RELAY_URL =
  process.env.DESKOY_BUG_RELAY_URL?.trim() || 'https://api.deskoy.com/api/bug-report';

// NSIS installer only (no Squirrel Update.exe). Avoid electron-squirrel-startup: it calls app.quit()
// on Squirrel argv and spawns ..\Update.exe, which breaks or no-ops on NSIS installs.

if (process.platform === 'win32') {
  app.setAppUserModelId('com.deskoy.app');
}

// Prevent multiple Deskoy instances from being launched (e.g. from repeated taskbar/desktop clicks).
// If a second instance is attempted, focus the existing settings window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // `forceShowSettingsWindow` will create/restore/focus the settings window.
    forceShowSettingsWindow();
  });
}

/** Written by NSIS on true fresh installs — see build/installer.nsh */
async function consumeFreshInstallMarker(): Promise<boolean> {
  if (!app.isPackaged) return false;
  const marker = path.join(process.resourcesPath, 'deskoy-fresh-install.marker');
  if (!existsSync(marker)) return false;
  try {
    await fs.unlink(marker);
  } catch {
    // Unlink can fail if the file is read-only; still treat as first run for UX.
  }
  return true;
}

type CoverKind = 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
type CoverMode = CoverKind | 'url' | 'file';

type DeskoySettings = {
  /** Electron globalShortcut accelerator; empty until the user sets one (default for new installs). */
  hotkey: string;
  coverMode: CoverMode;
  cover: CoverKind;
  coverUrl: string;
  coverFilePath: string;
  whitelist: string[];
  /** Windows: mute default playback when cover opens; restore when it closes. Manual hotkey only — not used for auto-protect (blocked) covers. */
  audioMute: boolean;
  /** When true, the global hotkey toggles the cover. When false, the hotkey does nothing. */
  enabled: boolean;
  /** When true, URL/file below overrides Cover mode. When false, Cover mode always wins. */
  useCustomCover: boolean;
  /** Auto-open cover when a blocked app is active. */
  autoCoverBlocked: boolean;
  /** Process names considered "blocked apps" (case-insensitive substring match). */
  blockedApps: string[];
  /** Window title keywords to block (best-effort for URLs/files; case-insensitive substring match). */
  blockedTitleKeywords: string[];
  theme: 'dark' | 'light' | 'system';
};

type StoredLicense = {
  key: string;
  lastValidated: number;
};

type LicenseValidity =
  | { status: 'missing' }
  | { status: 'valid'; key: string; lastValidated: number }
  | { status: 'invalid'; reason?: string };

// electron-store's exported types vary by version; keep runtime strong, typing flexible.
const store = new Store() as any;

const FEEDBACK_BUG_COOLDOWN_MS = 5 * 60 * 60 * 1000;

function rateLimitTimestampKey(kind: 'feedback' | 'bug'): string {
  return `rateLimit.${kind}.lastSentAt`;
}

function canSendAfterCooldown(kind: 'feedback' | 'bug'): boolean {
  const raw = store.get(rateLimitTimestampKey(kind));
  const last = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return Date.now() - last >= FEEDBACK_BUG_COOLDOWN_MS;
}

function markSentRateLimit(kind: 'feedback' | 'bug') {
  store.set(rateLimitTimestampKey(kind), Date.now());
}

function defaultSettings(): DeskoySettings {
  return {
    hotkey: '',
    coverMode: 'excel',
    cover: 'excel',
    coverUrl: '',
    coverFilePath: '',
    whitelist: ['Teams', 'Slack', 'Outlook'],
    audioMute: false,
    enabled: false,
    useCustomCover: false,
    autoCoverBlocked: false,
    blockedApps: ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Outlook', 'Discord'],
    blockedTitleKeywords: [
      'password',
      'bank',
      'invoice',
      'tax',
      'accounts.google.com',
      'mail.google.com',
      'discord.com/channels',
    ],
    theme: 'dark',
  };
}

function getSettings(): DeskoySettings {
  type LegacyRaw = Partial<DeskoySettings> & {
    autostart?: boolean;
    closeEverythingOnTrigger?: boolean;
  };
  const raw = store.get('settings', defaultSettings()) as LegacyRaw;
  const { autostart: _omitA, closeEverythingOnTrigger: _omitC, ...rest } = raw;
  void _omitA;
  void _omitC;
  const useCustomCover =
    typeof rest.useCustomCover === 'boolean'
      ? rest.useCustomCover
      : rest.coverMode === 'url' || rest.coverMode === 'file';
  const d = defaultSettings();
  return {
    ...d,
    ...rest,
    enabled: rest.enabled ?? false,
    useCustomCover,
    audioMute: typeof rest.audioMute === 'boolean' ? rest.audioMute : d.audioMute,
    hotkey: typeof rest.hotkey === 'string' ? rest.hotkey : d.hotkey,
  };
}

function setSettings(patch: Partial<DeskoySettings>) {
  type LegacyPatch = Partial<DeskoySettings> & {
    autostart?: boolean;
    closeEverythingOnTrigger?: boolean;
  };
  const { autostart: _omitA, closeEverythingOnTrigger: _omitC, ...rest } = patch as LegacyPatch;
  void _omitA;
  void _omitC;
  const next = { ...getSettings(), ...rest };
  store.set('settings', next);
  return next;
}

let licenseCache: { at: number; value: LicenseValidity } | null = null;
const LICENSE_CACHE_TTL_MS = 15_000;

/** Stored activation key for relay / Discord (truncated). Omitted when not activated. */
function getStoredLicenseKeyForReport(): string | undefined {
  const stored = store.get('license') as StoredLicense | undefined;
  const k = typeof stored?.key === 'string' ? stored.key.trim() : '';
  if (!k) return undefined;
  return k.length > 256 ? k.slice(0, 256) : k;
}

async function getLicenseValidity(): Promise<LicenseValidity> {
  const cached = licenseCache;
  if (cached && Date.now() - cached.at < LICENSE_CACHE_TTL_MS) return cached.value;

  const stored = store.get('license') as StoredLicense | undefined;
  if (!stored?.key) {
    const v: LicenseValidity = { status: 'missing' };
    licenseCache = { at: Date.now(), value: v };
    return v;
  }

  if (isBuiltinLicenseKey(stored.key)) {
    const v: LicenseValidity = {
      status: 'valid',
      key: BUILTIN_LICENSE_KEY,
      lastValidated: stored.lastValidated,
    };
    licenseCache = { at: Date.now(), value: v };
    return v;
  }

  const v: LicenseValidity = { status: 'invalid', reason: 'Invalid license key' };
  licenseCache = { at: Date.now(), value: v };
  return v;
}

let tray: Tray | null = null;
/** When true, the settings window may close for real (tray Quit / app.quit). Otherwise close only hides. */
let isQuitting = false;
let settingsWindow: BrowserWindow | null = null;
let coverWindow: BrowserWindow | null = null;
/** True while the decoy cover window is visible (independent of `settings.enabled`). */
let coverOpen = false;
let coverBusy = false;
let coverSession:
  | null
  | {
      reason: 'manual' | 'blocked';
      trigger?: { hwnd: number; pid: number; processName: string; title: string };
      at: number;
      cleanupAttempted?: boolean;
    } = null;
/** Timestamp when the current cover session became visible. Used to enforce minimum display time. */
let coverOpenAt = 0;
/** Minimum ms the cover must stay visible before an auto-dismiss from the blocked-window poll. */
const COVER_MIN_VISIBLE_MS = 600;
let lastBlockedCoverAt = 0;
const BLOCKED_COVER_COOLDOWN_MS = 6000;
let autoCoverTimer: NodeJS.Timeout | null = null;
let autoCoverTickRunning = false;
/** Polls until the blocked target window is closed/minimized so the cover can dismiss. */
let blockedCoverPollTimer: NodeJS.Timeout | null = null;
let closeCoverSessionInFlight: Promise<void> | null = null;

function clearBlockedCoverPollTimer() {
  if (blockedCoverPollTimer) {
    // Handles both setInterval (Windows poll) and setTimeout (non-Windows fallback).
    clearInterval(blockedCoverPollTimer);
    clearTimeout(blockedCoverPollTimer as unknown as ReturnType<typeof setTimeout>);
    blockedCoverPollTimer = null;
  }
}

function loadAppIconPng() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [
        path.join(process.cwd(), 'assets', 'icon.png'),
        path.join(app.getAppPath(), 'assets', 'icon.png'),
      ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      /* try next */
    }
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAjcB4vJ9F6sAAAAASUVORK5CYII=',
  );
}

function sendState() {
  const armed = getSettings().enabled;
  settingsWindow?.webContents.send('deskoy:stateChanged', { active: armed });
}

function createSettingsWindow(show = true) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (show) settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 900,
    minHeight: 600,
    // Always start hidden: showing only in `ready-to-show` avoids an empty frame while the bundle paints.
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Deskoy',
    icon: loadAppIconPng(),
    backgroundColor: '#111113',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      backgroundThrottling: false,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  void settingsWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  settingsWindow.once('ready-to-show', () => {
    if (show) {
      settingsWindow?.show();
      settingsWindow?.focus();
      if (process.platform === 'win32') settingsWindow?.moveTop();
    }
  });

  settingsWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    settingsWindow?.hide();
  });
}

function forceShowSettingsWindow() {
  createSettingsWindow(true);
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
  settingsWindow.moveTop();
}

function createTray() {
  tray = new Tray(loadAppIconPng());
  tray.setToolTip('Deskoy');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Settings', click: () => createSettingsWindow(true) },
    { type: 'separator' },
    { label: 'Toggle Deskoy', click: () => void toggleDeskoyArmed() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => createSettingsWindow(true));
}

function coverEntry(kind: CoverKind) {
  if (kind === 'vscode') return COVER_VSCODE_WEBPACK_ENTRY;
  if (kind === 'docs') return COVER_DOCS_WEBPACK_ENTRY;
  if (kind === 'jira') return COVER_JIRA_WEBPACK_ENTRY;
  if (kind === 'bi') return COVER_BI_WEBPACK_ENTRY;
  if (kind === 'black') return 'about:blank';
  return COVER_EXCEL_WEBPACK_ENTRY;
}

function isCoverKind(mode: CoverMode): mode is CoverKind {
  return (
    mode === 'excel' ||
    mode === 'vscode' ||
    mode === 'docs' ||
    mode === 'jira' ||
    mode === 'bi' ||
    mode === 'black'
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

async function loadLocalCoverHtml(win: BrowserWindow, filename: string): Promise<boolean> {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'cover', filename),
        path.join(app.getAppPath(), 'cover', filename),
      ]
    : [
        path.join(process.cwd(), 'src', 'cover', filename),
        path.join(app.getAppPath(), 'src', 'cover', filename),
      ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      await win.loadFile(candidate);
      return true;
    } catch {
      // try next location
    }
  }
  return false;
}

async function loadFileCover(win: BrowserWindow, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const fileUrl = new URL(`file://${filePath.replace(/\\/g, '/')}`);

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cover</title>
<style>
  html,body{height:100%;margin:0;background:#000;}
  .wrap{height:100%;display:flex;align-items:center;justify-content:center;}
  img{max-width:100%;max-height:100%;object-fit:contain;}
</style></head>
<body><div class="wrap"><img src="${fileUrl.toString()}" /></div></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    return;
  }

  if (ext === '.pdf') {
    await win.loadURL(fileUrl.toString());
    return;
  }

  if (['.txt', '.md', '.log', '.csv', '.json'].includes(ext)) {
    const raw = await fs.readFile(filePath, 'utf8');
    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cover</title>
<style>
  html,body{height:100%;margin:0;background:#0b0b0e;color:#e5e7eb;font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
  .pad{padding:24px;}
  pre{white-space:pre-wrap;word-break:break-word;line-height:1.45;font-size:13px;}
</style></head>
<body><div class="pad"><pre>${escapeHtml(raw.slice(0, 250_000))}</pre></div></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    return;
  }

  // Fallback: try to let Chromium render it if possible.
  await win.loadURL(fileUrl.toString());
}

async function openCoverFromSettings(settings: DeskoySettings) {
  if (coverWindow && !coverWindow.isDestroyed()) return;
  coverWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false, // Don't show until content is painted — prevents black-frame flash.
    icon: loadAppIconPng(),
    backgroundColor: '#000000',
    webPreferences: {
      devTools: false,
    },
  });
  coverWindow.setMenuBarVisibility(false);

  // Show only after the first meaningful paint so the cover appears fully rendered.
  coverWindow.once('ready-to-show', () => {
    if (coverWindow && !coverWindow.isDestroyed()) {
      coverOpenAt = Date.now();
      coverWindow.show();
      coverWindow.focus();
    }
  });

  // Escape hatch: never allow a "stuck" full-screen cover.
  coverWindow.webContents.on('before-input-event', (_event, input) => {
    if (!coverOpen) return;
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape') {
      void closeCoverSession();
      return;
    }
  });
  try {
    if (settings.coverMode === 'url') {
      const url = (settings.coverUrl || '').trim();
      if (!url) throw new Error('missing_url');
      await coverWindow.loadURL(url);
      return;
    }
    if (settings.coverMode === 'file') {
      const fp = (settings.coverFilePath || '').trim();
      if (!fp) throw new Error('missing_file');
      await loadFileCover(coverWindow, fp);
      return;
    }
    if (settings.coverMode === 'black') {
      await coverWindow.loadURL('about:blank');
      return;
    }
    // Prefer explicit mode when it is a built-in decoy kind.
    // This keeps newer options working even if older saved `cover` values are stale.
    const kind: CoverKind = isCoverKind(settings.coverMode) ? settings.coverMode : settings.cover;
    if (kind === 'jira') {
      const loaded = await loadLocalCoverHtml(coverWindow, 'jira.html');
      if (loaded) return;
    }
    if (kind === 'bi') {
      const loaded = await loadLocalCoverHtml(coverWindow, 'bi.html');
      if (loaded) return;
    }
    await coverWindow.loadURL(coverEntry(kind));
  } catch {
    // If cover fails to load, fall back to Excel so the hotkey never "does nothing".
    // If even the fallback fails, destroy the window so it doesn't get stuck non-null.
    try {
      await coverWindow.loadURL(coverEntry('excel'));
    } catch {
      if (coverWindow && !coverWindow.isDestroyed()) coverWindow.destroy();
      coverWindow = null;
    }
  }
}

function closeCover() {
  if (coverWindow && !coverWindow.isDestroyed()) coverWindow.destroy();
  coverWindow = null;
}

async function closeCoverSession(): Promise<void> {
  if (closeCoverSessionInFlight) return closeCoverSessionInFlight;

  // Acquire the lock synchronously before any await so concurrent callers hit the guard above.
  closeCoverSessionInFlight = (async () => {
    // Now that we hold the lock, stop the poll timer.
    clearBlockedCoverPollTimer();
    try {
      closeCover();
      coverOpen = false;
      coverBusy = false;
      coverOpenAt = 0;
      coverSession = null;
      await onCoverCloseAudio();
    } finally {
      closeCoverSessionInFlight = null;
    }
  })();

  return closeCoverSessionInFlight;
}

async function toggleCoverViaHotkey(): Promise<void> {
  if (!getSettings().enabled) return;
  const lic = await getLicenseValidity();
  if (lic.status !== 'valid') {
    createSettingsWindow(true);
    return;
  }

  if (!coverOpen) {
    const s = getSettings();
    // Set flags BEFORE awaiting so rapid hotkey presses don't open a second cover window.
    coverOpen = true;
    coverBusy = true;
    coverSession = { reason: 'manual', at: Date.now() };
    try {
      // Cover + mute in parallel; mute used to run two serial pwsh processes before the window.
      await Promise.all([openCoverFromSettings(s), onCoverOpenAudio(s.audioMute)]);
    } finally {
      coverBusy = false;
    }
    return;
  }

  await closeCoverSession();
}

async function closeBlockedWindow(trg: { hwnd: number; pid: number }): Promise<void> {
  // Uses Add-Type -MemberDefinition (inline P/Invoke) — no C# heredoc compilation penalty.
  const ps = `
$sig = @'
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@
$t = Add-Type -MemberDefinition $sig -Name 'CloseWin' -Namespace W -PassThru -ErrorAction SilentlyContinue
$hwnd = [IntPtr]::new(${trg.hwnd})
if (-not $t::IsWindow($hwnd)) { exit 0 }
$p = 0
[void]$t::GetWindowThreadProcessId($hwnd, [ref]$p)
# Minimize immediately so window leaves screen this frame regardless of what follows.
if (-not $t::IsIconic($hwnd)) { [void]$t::ShowWindow($hwnd, 6) }
# If PID changed the handle was recycled — skip close, minimize was enough.
if (${trg.pid} -gt 0 -and $p -ne ${trg.pid}) { exit 0 }
# SendMessage WM_CLOSE: synchronous — waits for the app's message loop to process it.
[void]$t::SendMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
# If still alive (app ignored WM_CLOSE), ensure it stays minimized.
if ($t::IsWindow($hwnd)) { if (-not $t::IsIconic($hwnd)) { [void]$t::ShowWindow($hwnd, 6) } }
`.trim();
  await new Promise<void>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 1500, maxBuffer: 1024 * 32 },
      () => resolve(),
    );
  });
}

// Checks HWND state without Add-Type compilation — pure PowerShell, ~3-5x faster per call.
async function isBlockedWindowGoneOrMinimized(trgHwnd: number, trgPid: number): Promise<boolean> {
  const psCheck = `
$hwnd = [IntPtr]::new(${trgHwnd})
$sig = '[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'
$t = Add-Type -MemberDefinition $sig -Name 'WinCheck${trgHwnd}' -Namespace W -PassThru -ErrorAction SilentlyContinue
if (-not $t::IsWindow($hwnd)) { Write-Output "gone"; exit 0 }
$p = 0
[void]$t::GetWindowThreadProcessId($hwnd, [ref]$p)
if (${trgPid} -gt 0 -and $p -ne ${trgPid}) { Write-Output "gone"; exit 0 }
if ($t::IsIconic($hwnd)) { Write-Output "min"; exit 0 }
Write-Output "alive"
`.trim();
  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCheck],
      { windowsHide: true, timeout: 600, maxBuffer: 1024 * 8 },
      (_err, stdout) => {
        const state = String(stdout ?? '').trim();
        resolve(state === 'gone' || state === 'min');
      },
    );
  });
}

async function openCoverIfAllowed(
  reason: 'blocked',
  triggerInfo: { hwnd: number; pid: number; processName: string; title: string; className: string } | null,
): Promise<void> {
  const s = getSettings();
  if (!s.enabled) return;
  if (coverOpen || coverBusy) return;
  const lic = await getLicenseValidity();
  if (lic.status !== 'valid') return;
  // Debounce repeated triggers.
  const now = Date.now();
  if (now - lastBlockedCoverAt < BLOCKED_COVER_COOLDOWN_MS) return;
  lastBlockedCoverAt = now;

  const hasHwnd = process.platform === 'win32' && !!triggerInfo?.hwnd;

  // Set state flags immediately so any re-entrant watcher ticks bail out.
  coverSession = {
    reason: 'blocked',
    at: Date.now(),
    trigger: triggerInfo ?? undefined,
    cleanupAttempted: true,
  };
  coverBusy = true;
  coverOpen = true;

  try {
    // --- Open cover and close the blocked window IN PARALLEL ---
    // Cover appears immediately (feels instant to the user).
    // Blocked window close/minimize races alongside — it disappears under the cover
    // within ~300ms, invisible to anyone watching.
    await Promise.all([
      openCoverFromSettings(s),
      // Never mute system audio during auto-protect: volume key / endpoint changes can steal focus
      // or confuse foreground detection so auto-protect retriggers or glitches. Mute is manual hotkey only.
      onCoverOpenAudio(false),
      hasHwnd && triggerInfo ? closeBlockedWindow(triggerInfo) : Promise.resolve(),
    ]);
  } finally {
    coverBusy = false;
  }

  // --- Poll until blocked window is confirmed gone/minimized, then auto-dismiss cover ---
  clearBlockedCoverPollTimer();
  if (hasHwnd && triggerInfo) {
    const trgHwnd = triggerInfo.hwnd;
    const trgPid = triggerInfo.pid;
    // Stagger the first check slightly — window needs a moment after SendMessage returns.
    let pollActive = false;
    blockedCoverPollTimer = setInterval(() => {
      if (!coverOpen || coverSession?.reason !== 'blocked') {
        clearBlockedCoverPollTimer();
        return;
      }
      // Skip tick if previous check hasn't returned yet (PowerShell is slower than 150ms sometimes).
      if (pollActive) return;
      pollActive = true;
      void isBlockedWindowGoneOrMinimized(trgHwnd, trgPid).then(async (goneOrMin) => {
        pollActive = false;
        if (!coverOpen || coverSession?.reason !== 'blocked') return;
        if (goneOrMin) {
          // Enforce minimum visible time so the cover never flashes in and out
          // before it has fully rendered (e.g. if the blocked window closed very fast).
          const visibleMs = Date.now() - coverOpenAt;
          const remaining = COVER_MIN_VISIBLE_MS - visibleMs;
          if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
          clearBlockedCoverPollTimer();
          await closeCoverSession();
        }
      });
    }, 150);
  } else {
    // Non-Windows or no HWND: auto-dismiss after a short grace period so cover never gets stuck.
    blockedCoverPollTimer = setTimeout(async () => {
      blockedCoverPollTimer = null;
      if (coverOpen && coverSession?.reason === 'blocked') {
        await closeCoverSession();
      }
    }, 3000) as unknown as NodeJS.Timeout;
  }
}

async function toggleDeskoyArmed(): Promise<{
  ok: boolean;
  active: boolean;
  error?: string;
}> {
  const prev = getSettings();
  const cur = prev.enabled;
  const next = !cur;

  if (next) {
    const lic = await getLicenseValidity();
    if (lic.status !== 'valid') {
      createSettingsWindow(true);
      return { ok: false, active: false, error: 'license_required' };
    }
  }

  if (!next && coverOpen) {
    await closeCoverSession();
  }
  const nextSettings = setSettings({ enabled: next });
  const ok = await registerHotkeys(nextSettings);
  if (!ok) {
    const rolledBack = setSettings({ enabled: false });
    await registerHotkeys(rolledBack);
    sendState();
    createSettingsWindow(true);
    return { ok: false, active: false, error: 'hotkey_unavailable' };
  }
  sendState();
  return { ok: true, active: next };
}

/** The hotkey combination currently registered by Deskoy, or null if none. */
let registeredHotkey: string | null = null;

async function registerHotkeys(settings: DeskoySettings): Promise<boolean> {
  // Unregister only the hotkey we previously registered — don't clobber unrelated shortcuts.
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  if (!settings.enabled) return true;
  const lic = await getLicenseValidity();
  if (lic.status !== 'valid') return true;
  const combo = (settings.hotkey ?? '').trim();
  if (!combo) return true;
  const ok = globalShortcut.register(combo, () => void toggleCoverViaHotkey());
  if (ok) registeredHotkey = combo;
  return ok;
}

function getActiveWindowInfo(): Promise<
  | { hwnd: number; pid: number; processName: string; title: string; className: string }
  | null
> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  // Use Add-Type -MemberDefinition (inline P/Invoke) instead of the full C# heredoc form.
  // The heredoc form invokes the .NET C# compiler on every call (~400-800ms per tick).
  // The -MemberDefinition form is significantly faster as it skips full compilation.
  const script = `
$sig = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
'@
$t = Add-Type -MemberDefinition $sig -Name 'FgWin' -Namespace W -PassThru -ErrorAction SilentlyContinue
$hwnd = $t::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 2 }
$pid = 0
[void]$t::GetWindowThreadProcessId($hwnd, [ref]$pid)
try { $name = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch { exit 3 }
$len = $t::GetWindowTextLength($hwnd); if ($len -lt 0) { $len = 0 }
$sb = New-Object System.Text.StringBuilder ($len + 32)
[void]$t::GetWindowText($hwnd, $sb, $sb.Capacity)
$caption = $sb.ToString()
$csb = New-Object System.Text.StringBuilder 256
[void]$t::GetClassName($hwnd, $csb, $csb.Capacity)
$cls = $csb.ToString()
if (-not $caption) { try { $caption = (Get-Process -Id $pid -ErrorAction Stop).MainWindowTitle } catch {} }
Write-Output ($hwnd.ToInt64().ToString() + "||" + $pid.ToString() + "||" + $name + "||" + $caption + "||" + $cls)
`.trim();
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 1800, maxBuffer: 1024 * 64 },
      (err, stdout) => {
        if (err) return resolve(null);
        const raw = String(stdout ?? '').trim();
        const parts = raw.split('||');
        if (parts.length < 3) return resolve(null);
        const hwndRaw = parts[0] ?? '';
        const pidRaw = parts[1] ?? '';
        const processName = parts[2] ?? '';
        if (!processName) return resolve(null);
        // Title can contain our delimiter; className is always last.
        const className = parts.length >= 5 ? (parts[parts.length - 1] ?? '') : '';
        const title = parts.length >= 5 ? parts.slice(3, -1).join('||') : (parts[3] ?? '');

        const hwnd = Number.parseInt(String(hwndRaw).trim(), 10);
        const pid = Number.parseInt(String(pidRaw).trim(), 10);
        resolve({
          hwnd: Number.isFinite(hwnd) ? hwnd : 0,
          pid: Number.isFinite(pid) ? pid : 0,
          processName: processName.trim(),
          title: (title ?? '').trim(),
          className: (className ?? '').trim(),
        });
      },
    );
  });
}

function matchesAny(processName: string, list: string[]) {
  const p = processName.toLowerCase();
  return list.some((x) => p.includes(String(x).toLowerCase()));
}

function isDeskoyWindow(info: { processName: string; title: string }) {
  const p = (info.processName || '').toLowerCase();
  // Match only on process name — title matching is too greedy (e.g. a file about Deskoy).
  return p.includes('deskoy');
}

function isBlockedApp(info: { processName: string; title: string }, settings: DeskoySettings) {
  if (isDeskoyWindow(info)) return false;
  if (matchesAny(info.processName, settings.blockedApps)) return true;
  const t = (info.title || '').toLowerCase();
  const raw = settings.blockedTitleKeywords ?? [];
  const needles = raw
    .flatMap((k) => {
      const s0 = String(k ?? '').trim();
      if (!s0) return [];
      const unquoted = s0.replace(/^["']([\s\S]*)["']$/, '$1').trim();
      const s = unquoted.toLowerCase();
      const out = new Set<string>();
      out.add(s);
      // If user pasted a path, also match the basename (Explorer/app titles rarely include full path).
      if (s.includes('\\') || s.includes('/')) {
        const parts = s.split(/[\\/]+/g).filter(Boolean);
        const base = parts.length ? parts[parts.length - 1] : '';
        if (base) out.add(base);
      }
      // If user pasted a URL, also match without protocol/trailing slash.
      if (s.startsWith('http://') || s.startsWith('https://')) {
        const noProto = s.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (noProto) out.add(noProto);
      }
      // If user pasted a domain-ish string (youtube.com, accounts.google.com/...), also match
      // common title tokens because Windows browser titles usually don't include the literal domain.
      // Examples:
      // - youtube.com -> youtube
      // - accounts.google.com -> accounts, google
      // - discord.com/channels -> discord
      const domainLike = (() => {
        const noProto = s.replace(/^https?:\/\//, '');
        const host = noProto.split('/')[0] ?? '';
        return host.includes('.') ? host : '';
      })();
      if (domainLike) {
        const hostParts = domainLike.split('.').filter(Boolean);
        const partsNoWww = hostParts[0] === 'www' ? hostParts.slice(1) : hostParts;
        for (const part of partsNoWww) {
          if (part.length >= 3) out.add(part);
        }
        // Add likely "brand" token (second-level domain when possible).
        if (partsNoWww.length >= 2) {
          const sld = partsNoWww[partsNoWww.length - 2];
          if (sld && sld.length >= 3) out.add(sld);
        }
      }
      return [...out];
    })
    .filter((x) => x.length > 0);
  return needles.some((needle) => t.includes(needle));
}

function startAutoCoverWatcher() {
  if (autoCoverTimer) return;
  autoCoverTimer = setInterval(async () => {
    if (autoCoverTickRunning) return;
    autoCoverTickRunning = true;
    const s = getSettings();
    try {
      if (!s.enabled) return;
      if (!s.autoCoverBlocked) return;
      if (coverOpen || coverBusy) return;
      const lic = await getLicenseValidity();
      if (lic.status !== 'valid') return;
      const info = await getActiveWindowInfo();
      if (!info) return;
      if (isDeskoyWindow(info)) return;
      if (s.autoCoverBlocked && isBlockedApp(info, s)) {
        // Pass info directly — avoids a redundant getActiveWindowInfo() spawn inside openCoverIfAllowed.
        await openCoverIfAllowed('blocked', info);
      }
    } finally {
      autoCoverTickRunning = false;
    }
  }, 150);
}

function stopAutoCoverWatcher() {
  if (!autoCoverTimer) return;
  clearInterval(autoCoverTimer);
  autoCoverTimer = null;
}

app.on('ready', () => {
  // Demo-only behavior: always show license flow on restart.
  // Production builds keep the stored license/session.
  if (!app.isPackaged) {
    store.delete('license');
  }

  createTray();
  void (async () => {
    const freshInstall = await consumeFreshInstallMarker();
    if (freshInstall) {
      // NSIS drops this marker only on a true new install — wipe local store so no dev/repack
      // machine state or stale userData leaks in; user enters license on first run.
      store.clear();
      licenseCache = null;
    }
    const lic = await getLicenseValidity();
    const shouldShowOnLaunch = freshInstall || lic.status !== 'valid';
    createSettingsWindow(shouldShowOnLaunch);
    if (shouldShowOnLaunch) {
      if (getSettings().enabled) {
        setSettings({ enabled: false });
        sendState();
      }
    }
    const ok = await registerHotkeys(getSettings());
    if (!ok) createSettingsWindow(true);
    startAutoCoverWatcher();
  })();
});

app.on('window-all-closed', () => {
  // tray-only app; ignore
});

app.on('activate', () => {
  createSettingsWindow(true);
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAutoCoverWatcher();
  clearBlockedCoverPollTimer();
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  closeCover();
  void onCoverCloseAudio();
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
});

app.on('will-quit', () => {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
});

ipcMain.handle('deskoy:openExternal', async (_evt, url: unknown) => {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return { ok: false as const };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false as const };
    await shell.openExternal(parsed.toString());
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
});

ipcMain.handle('deskoy:getAppVersion', async () => ({
  version: app.getVersion(),
  name: app.getName(),
}));

ipcMain.handle('deskoy:getState', async () => ({
  active: getSettings().enabled,
  maximized:
    !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isMaximized(),
}));
ipcMain.handle('deskoy:toggle', async () => toggleDeskoyArmed());
ipcMain.handle('deskoy:getSettings', async () => getSettings());
ipcMain.handle('deskoy:getActiveWindowInfo', async () => getActiveWindowInfo());
ipcMain.handle('deskoy:saveSettings', async (_evt, patch: Partial<DeskoySettings>) => {
  try {
    const prev = getSettings();
    if (patch.enabled) {
      const lic = await getLicenseValidity();
      if (lic.status !== 'valid') return { ok: false, error: 'license_required' };
    }
    const next = setSettings(patch);
    const ok = await registerHotkeys(next);
    if (!ok) {
      store.set('settings', prev);
      await registerHotkeys(prev);
      return { ok: false, error: 'hotkey_unavailable' };
    }
    // Watcher runs continuously but only triggers when enabled + toggles set.
    // Stop it only if the app is quitting.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown_error' };
  }
});

function normalizeWebhookUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    // Ensure it's an *execute webhook* URL, not the "get webhook" endpoint.
    // Required shape: https://discord.com/api/webhooks/<id>/<token>
    const hostOk =
      u.hostname === 'discord.com' || u.hostname === 'canary.discord.com' || u.hostname === 'ptb.discord.com';
    if (!hostOk) return '';
    const parts = u.pathname.split('/').filter(Boolean); // ["api","webhooks","<id>","<token>"]
    if (parts.length < 4) return '';
    if (parts[0] !== 'api' || parts[1] !== 'webhooks') return '';
    if (!/^\d+$/.test(parts[2] ?? '')) return '';
    if (!(parts[3] ?? '').length) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function decodeDataUrlImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) return null;
  const mime = m[1].trim().toLowerCase();
  const b64 = m[2].trim();
  if (!mime.startsWith('image/')) return null;
  try {
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}

async function postDiscordWebhook(args: {
  webhookUrl: string;
  username: string;
  content: string;
  file?: { filename: string; mime: string; buffer: Buffer };
}): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = normalizeWebhookUrl(args.webhookUrl);
  if (!webhookUrl) return { ok: false, error: 'missing_webhook' };
  const payload = { username: args.username, content: args.content };
  try {
    if (args.file) {
      const FormDataCtor = (globalThis as any).FormData as (new () => FormData) | undefined;
      const BlobCtor = (globalThis as any).Blob as (new (parts?: unknown[], opts?: { type?: string }) => Blob) | undefined;
      if (!FormDataCtor || !BlobCtor) return { ok: false, error: 'formdata_unavailable' };

      const form = new FormDataCtor();
      form.set('payload_json', JSON.stringify(payload));
      // IMPORTANT: use the runtime's global Blob (undici/web) for FormData compatibility.
      const blob = new BlobCtor([args.file.buffer], { type: args.file.mime });
      form.set('files[0]', blob, args.file.filename);
      const resp = await fetch(webhookUrl, { method: 'POST', body: form });
      if (!resp.ok) {
        return {
          ok: false,
          error: `discord_http_${resp.status}`,
        };
      }
      return { ok: true };
    }
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `discord_http_${resp.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

async function postDeskoyRelay(args: {
  url: string;
  body: unknown;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DeskoyDesktop/1 (Electron)',
      },
      body: JSON.stringify(args.body),
    });
    if (!resp.ok) return { ok: false, error: `relay_http_${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

/** Packaged builds use the relay only unless DESKOY_ALLOW_DIRECT_WEBHOOK_FALLBACK=1. Unpackaged dev may fall back to env webhooks. */
function allowDirectDiscordWebhookFallback(): boolean {
  if (!app.isPackaged) return true;
  return process.env.DESKOY_ALLOW_DIRECT_WEBHOOK_FALLBACK === '1';
}

ipcMain.handle(
  'deskoy:sendFeedback',
  async (_evt, payload: { message: string; email?: string; diagnostics?: unknown }) => {
    if (!canSendAfterCooldown('feedback')) return { ok: false, error: 'rate_limited' };
    const message = (payload?.message ?? '').toString().trim();
    if (!message) return { ok: false, error: 'missing_message' };
    const email = (payload?.email ?? '').toString().trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid_email' };
    const diagnostics = payload?.diagnostics;
    const licenseKey = getStoredLicenseKeyForReport();

    const relayRes = await postDeskoyRelay({
      url: DESKOY_FEEDBACK_RELAY_URL,
      body: {
        type: 'feedback',
        message,
        email: email || undefined,
        diagnostics,
        licenseKey: licenseKey || undefined,
      },
    });
    if (relayRes.ok) {
      markSentRateLimit('feedback');
      return relayRes;
    }

    if (!allowDirectDiscordWebhookFallback()) return relayRes;

    const feedbackWebhook = getDiscordFeedbackWebhook();
    if (!normalizeWebhookUrl(feedbackWebhook)) return relayRes;

    const content =
      `**New Feedback**\n` +
      (licenseKey ? `**License:** \`${licenseKey}\`\n` : '**License:** *(none)*\n') +
      (email ? `**Email:** ${email}\n` : '') +
      `\n${message}\n` +
      (diagnostics
        ? `\n**Diagnostics**\n\`\`\`json\n${JSON.stringify(diagnostics, null, 2)}\n\`\`\`\n`
        : '');
    const res = await postDiscordWebhook({
      webhookUrl: feedbackWebhook,
      username: 'Deskoy Feedback',
      content,
    });
    if (res.ok) markSentRateLimit('feedback');
    return res;
  },
);

ipcMain.handle(
  'deskoy:sendBugReport',
  async (
    _evt,
    payload: { message: string; email?: string; steps?: string; screenshot?: string; diagnostics?: unknown },
  ) => {
    if (!canSendAfterCooldown('bug')) return { ok: false, error: 'rate_limited' };
    const message = (payload?.message ?? '').toString().trim();
    if (!message) return { ok: false, error: 'missing_message' };
    const email = (payload?.email ?? '').toString().trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid_email' };
    const steps = (payload?.steps ?? '').toString().trim();
    const diagnostics = payload?.diagnostics;
    const licenseKey = getStoredLicenseKeyForReport();

    const relayRes = await postDeskoyRelay({
      url: DESKOY_BUG_RELAY_URL,
      body: {
        type: 'bug',
        message,
        email: email || undefined,
        steps: steps || undefined,
        screenshot: payload?.screenshot || undefined,
        diagnostics,
        licenseKey: licenseKey || undefined,
      },
    });
    if (relayRes.ok) {
      markSentRateLimit('bug');
      return relayRes;
    }

    if (!allowDirectDiscordWebhookFallback()) return relayRes;

    const bugWebhook = getDiscordBugWebhook();
    if (!normalizeWebhookUrl(bugWebhook)) return relayRes;

    const content =
      `**New Bug Report**\n` +
      (licenseKey ? `**License:** \`${licenseKey}\`\n` : '**License:** *(none)*\n') +
      (email ? `**Email:** ${email}\n` : '') +
      `\n**What happened**\n${message}\n` +
      (steps ? `\n**Steps to reproduce**\n${steps}\n` : '') +
      (diagnostics
        ? `\n**Diagnostics**\n\`\`\`json\n${JSON.stringify(diagnostics, null, 2)}\n\`\`\`\n`
        : '');

    const file = payload?.screenshot ? decodeDataUrlImage(payload.screenshot) : null;
    const res = await postDiscordWebhook({
      webhookUrl: bugWebhook,
      username: 'Deskoy Bug Report',
      content,
      file: file
        ? {
            filename: 'screenshot.png',
            mime: file.mime,
            buffer: file.buffer,
          }
        : undefined,
    });
    if (res.ok) markSentRateLimit('bug');
    return res;
  },
);

ipcMain.handle('deskoy:pickCoverFile', async () => {
  const parent = settingsWindow ?? undefined;
  const res = await dialog.showOpenDialog(parent, {
    properties: ['openFile'],
    filters: [
      { name: 'Cover files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'log', 'json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: true, path: '' };
  const fp = res.filePaths[0];
  setSettings({ coverFilePath: fp, coverMode: 'file' });
  return { ok: true, path: fp };
});

ipcMain.handle('deskoy:getLicenseState', async () => {
  const v = await getLicenseValidity();
  return v;
});

ipcMain.handle('deskoy:validateLicense', async (_evt, key: string) => {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return { ok: true, valid: false, reason: 'missing_key' };

  if (isBuiltinLicenseKey(trimmed)) {
    store.set('license', { key: BUILTIN_LICENSE_KEY, lastValidated: Date.now() });
    licenseCache = null;
    return { ok: true, valid: true };
  }

  return { ok: true, valid: false, reason: 'Invalid license key' };
});

ipcMain.handle('deskoy:clearLicense', async () => {
  store.delete('license');
  licenseCache = null;
  return { ok: true };
});

ipcMain.handle('deskoy:windowMinimize', async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.minimize();
  }
  return { ok: true };
});

ipcMain.handle('deskoy:windowToggleMaximize', async () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return { ok: false, isMaximized: false };
  }
  if (settingsWindow.isMaximized()) {
    settingsWindow.unmaximize();
  } else {
    settingsWindow.maximize();
  }
  return { ok: true, isMaximized: settingsWindow.isMaximized() };
});

ipcMain.handle('deskoy:windowClose', async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.hide();
  }
  return { ok: true };
});
