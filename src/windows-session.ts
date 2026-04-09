import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function powershellExe(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

async function runPwshEncoded(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const r = await execFileAsync(
      powershellExe(),
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return {
      stdout: (r.stdout ?? '').toString().trim(),
      stderr: (r.stderr ?? '').toString().trim(),
      code: 0,
    };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; code?: number };
    return {
      stdout: (err.stdout ?? Buffer.from('')).toString().trim(),
      stderr: (err.stderr ?? Buffer.from('')).toString().trim(),
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

function runPwshEncodedSync(script: string): void {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: 'ignore' },
  );
}

type PendingAudioRestore = null | { kind: 'com-off'; roles: number[] } | 'vk-toggle';

let pendingAudioRestore: PendingAudioRestore = null;

const PS_FUN_GET_EPV = `
function Get-DeskoyEpv {
  param($dev)
  $iid = [guid]'5CDF2C82-841E-4546-972D-1941B58A96C4'
  $epv = $null
  try {
    $epv = $dev.Activate([ref]$iid, 23, [IntPtr]::Zero)
  } catch {
    try {
      $epv = $dev.Activate($iid, 23, [IntPtr]::Zero)
    } catch {
      $epv = $dev.Activate([ref]$iid, 1, [IntPtr]::Zero)
    }
  }
  return $epv
}
`.trim();

/** One PowerShell run: mute unmuted default endpoints, or report skip / no devices (avoids a second cold pwsh). */
function audioMuteOnDesktopScript(): string {
  return `
${PS_FUN_GET_EPV}
$ErrorActionPreference = 'SilentlyContinue'
$t = [Type]::GetTypeFromCLSID([guid]'BCDE0615-CB8A-4B4F-8BFE-0C6D2DBE6B66')
if ($null -eq $t) { exit 1 }
$de = [Activator]::CreateInstance($t)
$touched = New-Object System.Collections.Generic.List[int]
$sawAny = $false
foreach ($role in 0, 1) {
  try {
    $dev = $de.GetDefaultAudioEndpoint(0, $role)
    $epv = Get-DeskoyEpv $dev
    if ($null -eq $epv) { continue }
    $sawAny = $true
    if (-not $epv.GetMute()) {
      $ge = [guid]::Empty
      $epv.SetMute($true, [ref]$ge)
      [void]$touched.Add($role)
    }
  } catch { }
}
if ($touched.Count -gt 0) {
  Write-Output ('TOUCHED:' + ($touched -join ','))
  exit 0
}
if ($sawAny) {
  Write-Output 'SKIP_ALREADY_MUTED'
  exit 0
}
Write-Output 'NO_ENDPOINTS'
exit 0
`.trim();
}

function audioMuteOffDesktopScript(roles: number[]): string {
  if (roles.length === 0) {
    return `$ErrorActionPreference = 'SilentlyContinue'; exit 0`;
  }
  const roleList = roles.join(',');
  return `
${PS_FUN_GET_EPV}
$ErrorActionPreference = 'SilentlyContinue'
$t = [Type]::GetTypeFromCLSID([guid]'BCDE0615-CB8A-4B4F-8BFE-0C6D2DBE6B66')
if ($null -eq $t) { exit 1 }
$de = [Activator]::CreateInstance($t)
foreach ($role in @(${roleList})) {
  try {
    $dev = $de.GetDefaultAudioEndpoint(0, [int]$role)
    $epv = Get-DeskoyEpv $dev
    if ($null -eq $epv) { continue }
    $ge = [guid]::Empty
    $epv.SetMute($false, [ref]$ge)
  } catch { }
}
exit 0
`.trim();
}

function parseTouchedRoles(stdout: string): number[] {
  const m = stdout.match(/TOUCHED:([\d,]*)/);
  if (!m?.[1]) return [];
  return m[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

function toggleVolumeMuteVk(): void {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DeskoyK {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr ex);
  public static void MuteKey() {
    keybd_event((byte)0xAD, 0, 0, UIntPtr.Zero);
    keybd_event((byte)0xAD, 0, 2, UIntPtr.Zero);
  }
}
'@
[DeskoyK]::MuteKey()
`.trim();
  try {
    runPwshEncodedSync(script);
  } catch {
    /* ignore */
  }
}

/** Mute Windows desktop output (default console + multimedia) when the cover opens. */
export async function onCoverOpenAudio(wantMute: boolean): Promise<void> {
  pendingAudioRestore = null;
  if (!wantMute || process.platform !== 'win32') return;

  const r = await runPwshEncoded(audioMuteOnDesktopScript());
  if (r.code === 0 && r.stdout.includes('SKIP_ALREADY_MUTED')) {
    pendingAudioRestore = null;
    return;
  }
  const touched = parseTouchedRoles(r.stdout);
  if (r.code === 0 && touched.length > 0) {
    pendingAudioRestore = { kind: 'com-off', roles: touched };
    return;
  }

  toggleVolumeMuteVk();
  pendingAudioRestore = 'vk-toggle';
}

export async function onCoverCloseAudio(): Promise<void> {
  if (process.platform !== 'win32') return;
  const pending = pendingAudioRestore;
  pendingAudioRestore = null;
  if (pending && typeof pending === 'object' && pending.kind === 'com-off' && pending.roles.length > 0) {
    await runPwshEncoded(audioMuteOffDesktopScript(pending.roles));
    return;
  }
  if (pending === 'vk-toggle') {
    toggleVolumeMuteVk();
  }
}
