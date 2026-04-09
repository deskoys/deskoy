import { contextBridge, ipcRenderer, shell } from 'electron';

async function openExternalSafe(url: string): Promise<{ ok: boolean }> {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return { ok: false };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type CoverKind = 'excel' | 'vscode' | 'docs' | 'jira' | 'bi' | 'black';
export type CoverMode = CoverKind | 'url' | 'file';

export type DeskoySettings = {
  hotkey: string;
  coverMode: CoverMode;
  cover: CoverKind;
  coverUrl: string;
  coverFilePath: string;
  whitelist: string[];
  audioMute: boolean;
  enabled: boolean;
  useCustomCover: boolean;
  autoCoverBlocked: boolean;
  blockedApps: string[];
  blockedTitleKeywords: string[];
  theme: 'dark' | 'light' | 'system';
};

export type LicenseState =
  | { status: 'missing' }
  | { status: 'valid'; key: string; lastValidated: number }
  | { status: 'invalid'; reason?: string };

export type FeedbackPayload = {
  message: string;
  email?: string;
  diagnostics?: unknown;
};

export type BugReportPayload = {
  message: string;
  email?: string;
  steps?: string;
  screenshot?: string; // data URL (base64)
  diagnostics?: unknown;
};

contextBridge.exposeInMainWorld('deskoy', {
  openExternal: (url: string) => openExternalSafe(url),
  getAppVersion: () =>
    ipcRenderer.invoke('deskoy:getAppVersion') as Promise<{ version: string; name: string }>,
  getState: () => ipcRenderer.invoke('deskoy:getState'),
  toggle: () => ipcRenderer.invoke('deskoy:toggle'),
  getSettings: () => ipcRenderer.invoke('deskoy:getSettings'),
  getActiveWindowInfo: () => ipcRenderer.invoke('deskoy:getActiveWindowInfo'),
  saveSettings: (settings: Partial<DeskoySettings>) =>
    ipcRenderer.invoke('deskoy:saveSettings', settings),
  pickCoverFile: () => ipcRenderer.invoke('deskoy:pickCoverFile'),
  getLicenseState: () => ipcRenderer.invoke('deskoy:getLicenseState'),
  validateLicense: (key: string) => ipcRenderer.invoke('deskoy:validateLicense', key),
  clearLicense: () => ipcRenderer.invoke('deskoy:clearLicense'),
  sendFeedback: (payload: FeedbackPayload) => ipcRenderer.invoke('deskoy:sendFeedback', payload),
  sendBugReport: (payload: BugReportPayload) => ipcRenderer.invoke('deskoy:sendBugReport', payload),
  windowMinimize: () => ipcRenderer.invoke('deskoy:windowMinimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('deskoy:windowToggleMaximize'),
  windowClose: () => ipcRenderer.invoke('deskoy:windowClose'),
  onStateChanged: (cb: (state: { active: boolean }) => void) => {
    const handler = (_: unknown, payload: { active: boolean }) => cb(payload);
    ipcRenderer.on('deskoy:stateChanged', handler);
    return () => ipcRenderer.removeListener('deskoy:stateChanged', handler);
  },
  onWindowMaximizedChanged: (cb: (state: { maximized: boolean }) => void) => {
    const handler = (_: unknown, payload: { maximized: boolean }) => cb(payload);
    ipcRenderer.on('deskoy:windowMaximizedChanged', handler);
    return () => ipcRenderer.removeListener('deskoy:windowMaximizedChanged', handler);
  },
  onCoverFallback: (cb: (info: { reason: string }) => void) => {
    const handler = (_: unknown, payload: { reason: string }) => cb(payload);
    ipcRenderer.on('deskoy:coverFallback', handler);
    return () => ipcRenderer.removeListener('deskoy:coverFallback', handler);
  },
});

