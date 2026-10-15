export function fmtNum(v, opts = {}) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const a = Math.abs(n);
  const { compact = true, digits } = opts;
  if (compact) {
    if (a >= 1e9) return `${trim(n / 1e9)}B`;
    if (a >= 1e6) return `${trim(n / 1e6)}M`;
    if (a >= 1e4) return `${Math.round(n).toLocaleString()}`;
  }
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
  });
}

const trim = (n) => Number(n.toFixed(2)).toString();

export function fmtCell(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtNum(v, { compact: false });
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

export function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export const truncate = (s, n = 22) =>
  String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? '');

export const TYPE_META = {
  numeric: { label: 'num', tone: 'text-accent border-accent/40' },
  categorical: { label: 'cat', tone: 'text-accent2 border-accent2/40' },
  datetime: { label: 'date', tone: 'text-[#B98CF7] border-[#B98CF7]/40' },
  boolean: { label: 'bool', tone: 'text-[#E5D15E] border-[#E5D15E]/40' },
  text: { label: 'text', tone: 'text-muted border-line' },
};
