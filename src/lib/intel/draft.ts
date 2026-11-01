/** Message text rules shared with the nudge system: short, plain, no links, no control characters. */
export const MAX_DRAFT_CHARS = 140;
export function cleanDraft(input: unknown): string | null {
  const t = String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > MAX_DRAFT_CHARS || /https?:|www\.|\.com\b|\.in\b/i.test(t)) return null;
  return t;
}
