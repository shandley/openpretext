/**
 * Html — putting data into HTML strings safely.
 *
 * Many panels are built as template strings and assigned to `innerHTML`.
 * Anything in them that comes from outside the code (contig names from a
 * .pretext file, track names from a BedGraph file, scaffold names and colours
 * from a session or AGP file, operation descriptions that quote any of these)
 * must go through one of these functions, in element content and in
 * attributes alike. Numbers and strings written in this codebase need not.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
};

/** Escape text for element content or a quoted attribute value. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ENTITIES[ch]);
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)$/;
const NAMED_COLOR = /^[a-zA-Z]{1,30}$/;

/**
 * A colour that is safe to place in a `style` attribute: a hex colour, an
 * rgb()/hsl() call of plain numbers, or a bare colour name. Anything else
 * (which could close the attribute or add declarations) becomes `fallback`.
 */
export function cssColor(value: unknown, fallback = '#888888'): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || NAMED_COLOR.test(v) ? v : fallback;
}
