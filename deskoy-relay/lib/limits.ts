export const MAX_MESSAGE_LEN = 8000;
export const MAX_STEPS_LEN = 12000;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_DIAGNOSTICS_JSON_LEN = 6000;

export function isValidEmail(email: string): boolean {
  if (!email) return true;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
