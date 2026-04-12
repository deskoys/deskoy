export const MAX_MESSAGE_LEN = 8000;
export const MAX_LICENSE_KEY_LEN = 256;
export const MAX_STEPS_LEN = 12000;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_DIAGNOSTICS_JSON_LEN = 6000;

export function isValidEmail(email: string): boolean {
  if (!email) return true;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeRelayLicenseKey(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  return s.length <= MAX_LICENSE_KEY_LEN ? s : `${s.slice(0, MAX_LICENSE_KEY_LEN - 1)}…`;
}
