/** "12:34" or "1:02:03" -> seconds. Returns null for invalid input. */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(":").map(Number);
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/** seconds -> "12:34" or "1:02:03". */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
