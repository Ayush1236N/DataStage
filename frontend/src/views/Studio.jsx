import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api, downloadUrl } from '../lib/api';
import { fmtCell, fmtNum, truncate, TYPE_META } from '../lib/format';
import { useTheme } from '../lib/theme';
import { EmptyState, ErrorState, Icon, ProgressRail, Spinner, Stat } from '../components/ui';

const PAGE = 100;
const TYPES = ['numeric', 'categorical', 'datetime', 'boolean', 'text'];

export default function Studio({
  dataset,
  sheet,
  onSheet,
  overrides,
  onOverrides,
  onGenerate,
  busy,
  error,
  hasPlan,
  onPresent,
  onBuild,
}) {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState(null);
  const [rowsErr, setRowsErr] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ col: null, desc: false });
  const [stage, setStage] = useState(null);

  const summary = dataset.summary?.[sheet?.name];

  useEffect(() => {
    setPage(0);
    setQuery('');
    setSort({ col: null, desc: false });
  }, [sheet?.name]);

  useEffect(() => {
    if (!sheet) return;
    let alive = true;
    setRows(null);
    setRowsErr(null);
    const params = { sheet: sheet.name, offset: page * PAGE, limit: PAGE };
    if (query) params.q = query;
    if (sort.col) {
      params.sort = sort.col;
      params.desc = sort.desc ? 'true' : 'false';
    }
    const timer = setTimeout(() => {
      api
        .rows(dataset.dataset_id, params)
        .then((r) => alive && setRows(r))
        .catch((e) => alive && setRowsErr(e.message));
    }, query ? 260 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dataset.dataset_id, sheet, page, query, sort]);

  const run = useCallback(() => {
    setStage({ stage: 'reading', pct: 4, detail: 'Starting pipeline' });
    onGenerate((ev) => setStage(ev)).finally(() => setStage(null));
  }, [onGenerate]);

  const cols = sheet?.columns ?? [];
  const effType = (c) => overrides[c.name] || c.type;
  const totalPages = rows ? Math.max(1, Math.ceil(rows.total / PAGE)) : 1;

  const typeCounts = useMemo(() => {
    const acc = {};
    cols.forEach((c) => {
      const t = effType(c);
      acc[t] = (acc[t] || 0) + 1;
    });
    return acc;
  }, [cols, overrides]);

  if (!sheet) return <EmptyState title="No sheets found in this file" />;

  return (
    <div className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label">data studio</p>
          <h1 className="mt-1 truncate text-[22px] font-bold sm:text-[26px]" title={dataset.name}>
            {dataset.name}
          </h1>
          <p className="mt-1 text-[12px] text-muted">
            Review the parse, correct any column type, then build the deck.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPlan && (
            <button type="button" className="btn py-2 text-xs" onClick={onPresent}>
              <Icon name="play" size={14} /> Open deck
            </button>
          )}
          <button type="button" className="btn py-2 text-xs" onClick={onBuild}>
            <Icon name="sliders" size={14} /> Chart builder
          </button>
          <button
            type="button"
            className="btn btn-primary py-2 text-xs"
            onClick={run}
            disabled={busy === 'analyze'}
            data-testid="button-generate"
          >
            {busy === 'analyze' ? <Spinner size={14} /> : <Icon name="sparkle" size={14} />}
            {busy === 'analyze' ? 'Building charts…' : hasPlan ? 'Rebuild deck' : 'Generate charts'}
          </button>
        </div>
      </div>

      {dataset.sheets.length > 1 && (
        <div
          className="mt-5 flex gap-1.5 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Sheets in this workbook"
        >
          {dataset.sheets.map((s) => {
            const on = s.name === sheet.name;
            return (
              <button
                key={s.name}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => onSheet(s.name)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                  on
                    ? 'border-accent/60 bg-accent/[0.08] text-ink'
                    : 'border-line bg-surface/50 text-muted hover:border-accent/40 hover:text-ink'
                }`}
                data-testid={`tab-sheet-${s.name}`}
              >
                <span className="block max-w-[190px] truncate text-[13px] font-medium">{s.name}</span>
                <span className="num block text-[10px] text-faint">
                  {s.rows.toLocaleString()} rows · {s.columns.length} cols
                </span>
              </button>
            );
          })}
        </div>
      )}

      {stage && (
        <motion.div
          className="panel mt-5 p-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <ProgressRail pct={stage.pct} stage={stage.stage} detail={stage.detail} />
        </motion.div>
      )}
      {error && !stage && (
        <div className="mt-5">
          <ErrorState error={error} onRetry={run} />
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="rows" value={fmtNum(summary?.rows ?? sheet.rows)} />
        <Stat label="columns" value={fmtNum(summary?.columns ?? cols.length)} />
        <Stat label="numeric" value={fmtNum(typeCounts.numeric ?? 0)} />
        <Stat label="categorical" value={fmtNum(typeCounts.categorical ?? 0)} />
        <Stat label="datetime" value={fmtNum(typeCounts.datetime ?? 0)} />
        <Stat
          label="completeness"
          value={summary ? `${(summary.completeness * 100).toFixed(1)}` : '—'}
          unit="%"
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="panel flex min-h-0 flex-col p-4" aria-label="Column profile">
          <header className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Columns</h2>
            <span className="num text-[11px] text-faint">{cols.length}</span>
          </header>
          <ul className="scroll-y mt-3 max-h-[520px] space-y-1.5 pr-1">
            {cols.map((c) => {
              const t = effType(c);
              const meta = TYPE_META[t] ?? TYPE_META.text;
              return (
                <li key={c.name} className="rounded-lg border border-line bg-surface/50 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`chip shrink-0 ${meta.tone}`}>{meta.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title={c.name}>
                      {c.name}
                    </span>
                    <label className="sr-only" htmlFor={`type-${c.name}`}>
                      Column type for {c.name}
                    </label>
                    <select
                      id={`type-${c.name}`}
                      value={t}
                      onChange={(e) => {
                        const next = { ...overrides };
                        if (e.target.value === c.type) delete next[c.name];
                        else next[c.name] = e.target.value;
                        onOverrides(next);
                      }}
                      className="field w-[92px] shrink-0 py-1 text-[11px]"
                    >
                      {TYPES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-faint">
                    <span>{c.unique.toLocaleString()} unique</span>
                    {c.nulls > 0 && <span className="text-warn">{c.nulls.toLocaleString()} null</span>}
                    {c.mean !== undefined && <span>μ {fmtNum(c.mean)}</span>}
                    {c.min !== undefined && typeof c.min === 'number' && (
                      <span>
                        {fmtNum(c.min)} → {fmtNum(c.max)}
                      </span>
                    )}
                    {typeof c.min === 'string' && <span>{c.min.slice(0, 10)} → {String(c.max).slice(0, 10)}</span>}
                  </p>
                  {c.top && (
                    <p className="mt-1 truncate text-[10.5px] text-muted" title={c.top.map((x) => x.value).join(', ')}>
                      {c.top.slice(0, 3).map((x) => `${truncate(x.value, 14)} (${x.count})`).join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel flex min-h-0 flex-col overflow-hidden p-4" aria-label="Row preview">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-semibold">Rows</h2>
            <span className="num text-[11px] text-faint">
              {rows ? `${(page * PAGE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE, rows.total).toLocaleString()} of ${rows.total.toLocaleString()}` : '…'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className="sr-only" htmlFor="row-search">
                Search rows
              </label>
              <input
                id="row-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search all cells…"
                className="field w-[150px] py-1.5 text-[12px] sm:w-[210px]"
                data-testid="input-search"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-ghost rounded-md border border-line p-1.5 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  aria-label="Previous page"
                >
                  <Icon name="prev" size={14} />
                </button>
                <button
                  type="button"
                  className="btn-ghost rounded-md border border-line p-1.5 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  aria-label="Next page"
                >
                  <Icon name="next" size={14} />
                </button>
              </div>
            </div>
          </header>

          <div className="scroll-y mt-3 max-h-[520px] min-h-[240px] rounded-lg border border-line/70">
            {rowsErr ? (
              <ErrorState error={rowsErr} />
            ) : !rows ? (
              <div className="space-y-2 p-3" aria-busy="true">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="skeleton h-6 w-full" />
                ))}
              </div>
            ) : rows.rows.length === 0 ? (
              <EmptyState
                title="No rows match that search"
                hint="Clear the search box to see the full sheet."
                action={
                  <button type="button" className="btn py-1.5 text-xs" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                }
              />
            ) : (
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
                  <tr>
                    <th scope="col" className="w-10 border-b border-line px-2 py-2 label">
                      #
                    </th>
                    {rows.columns.map((c) => (
                      <th key={c} scope="col" className="border-b border-line px-2 py-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSort((s) => ({ col: c, desc: s.col === c ? !s.desc : false }))
                          }
                          className="label flex items-center gap-1 hover:text-accent"
                          title={`Sort by ${c}`}
                        >
                          <span className="max-w-[140px] truncate">{c}</span>
                          {sort.col === c && <span className="text-accent">{sort.desc ? '↓' : '↑'}</span>}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-line/25">
                      <td className="num border-b border-line/40 px-2 py-1.5 text-[10px] text-faint">
                        {page * PAGE + i + 1}
                      </td>
                      {r.map((cell, j) => (
                        <td
                          key={j}
                          className={`max-w-[240px] truncate border-b border-line/40 px-2 py-1.5 ${
                            typeof cell === 'number' ? 'num text-ink' : 'text-muted'
                          }`}
                          title={String(cell ?? '')}
                        >
                          {fmtCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <footer className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-faint">Export this sheet</span>
            {[
              ['pptx', 'PPTX deck'],
              ['pdf', 'PDF'],
              ['xlsx', 'XLSX'],
            ].map(([fmt, label]) => (
              <button
                key={fmt}
                type="button"
                className="btn py-1.5 text-[11px]"
                onClick={() => downloadUrl(api.exportUrl(dataset.dataset_id, sheet.name, fmt))}
                data-testid={`button-export-${fmt}`}
              >
                <Icon name="download" size={13} /> {label}
              </button>
            ))}
            <span className="num ml-auto text-[10.5px] text-faint">
              rendered server-side from the same chart specs
            </span>
          </footer>
        </section>
      </div>
    </div>
  );
}
