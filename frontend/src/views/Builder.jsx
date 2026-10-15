import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import ChartView from '../charts';
import { api } from '../lib/api';
import { fmtNum, truncate } from '../lib/format';
import { ChartSkeleton, EmptyState, ErrorState, Icon, Spinner } from '../components/ui';

/* Which spec fields each chart type needs, and what column kinds are valid.
   kinds: num | cat | date | text | any. */
const F = {
  x: (kinds, required = true, label = 'X / category') => ({ key: 'x', kinds, required, label }),
  y: (kinds, required = false, label = 'Y / measure') => ({ key: 'y', kinds, required, label }),
  z: () => ({ key: 'z', kinds: ['num'], required: true, label: 'Z / height' }),
  series: (kinds = ['cat'], label = 'Series / group') => ({ key: 'series', kinds, required: false, label }),
  size: () => ({ key: 'size', kinds: ['num'], required: false, label: 'Bubble size' }),
  value: () => ({ key: 'value', kinds: ['num'], required: false, label: 'Flow value' }),
  ys: (label = 'Measures') => ({ key: 'ys', kinds: ['num'], required: true, multi: true, label }),
};

const CAT_LIKE = ['cat'];
const SPECS = {
  kpi: { fields: [F.ys('Headline metrics')] },
  bar: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  horizontal_bar: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  grouped_bar: { fields: [F.x(CAT_LIKE), F.y(['num']), F.series()], agg: true },
  stacked_bar: { fields: [F.x(CAT_LIKE), F.y(['num']), F.series()], agg: true },
  pareto: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  waterfall: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  funnel: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  pie: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  donut: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  gauge: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  treemap: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  sunburst: { fields: [F.x(CAT_LIKE), F.y(['num']), F.series()], agg: true },
  radar: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  polar_area: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  radial_bar: { fields: [F.x(CAT_LIKE), F.y(['num'])], agg: true },
  sankey: { fields: [F.x(CAT_LIKE, true, 'From'), F.series(CAT_LIKE, 'To'), F.value()] },
  bar3d: { fields: [F.x(CAT_LIKE), F.y(['num']), F.series()], agg: true },
  line: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'])], agg: true },
  area: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'])], agg: true },
  step_line: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'])], agg: true },
  multi_line: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'], true), F.series()], agg: true },
  stacked_area: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'], true), F.series()], agg: true },
  candlestick: { fields: [F.x(['date'], true, 'Time axis'), F.y(['num'], true)] },
  calendar: { fields: [F.x(['date'], true, 'Date'), F.y(['num'])] },
  scatter: { fields: [F.x(['num']), F.y(['num'], true)] },
  regression: { fields: [F.x(['num']), F.y(['num'], true)] },
  bubble: { fields: [F.x(['num']), F.y(['num'], true), F.size(), F.series()] },
  histogram: { fields: [F.x(['num'], true, 'Measure')], bins: true },
  kde: { fields: [F.x(['num'], true, 'Measure')] },
  box: { fields: [F.x(CAT_LIKE, false, 'Group by'), F.y(['num'], true)] },
  violin: { fields: [F.x(CAT_LIKE, false, 'Group by'), F.y(['num'], true)] },
  heatmap: { fields: [F.ys('Correlated measures')] },
  parallel: { fields: [F.ys('Dimensions (3+)'), F.series()] },
  wordcloud: { fields: [F.x(['text', 'cat'], true, 'Text column')] },
  scatter3d: { fields: [F.x(['num']), F.y(['num'], true), F.z(), F.series()] },
  surface3d: { fields: [F.x(['num']), F.y(['num'], true), F.z()] },
};

const GROUPS = [
  ['Comparison', ['bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'pareto', 'waterfall', 'radar', 'polar_area', 'radial_bar', 'gauge']],
  ['Trend', ['line', 'area', 'step_line', 'multi_line', 'stacked_area', 'candlestick', 'calendar']],
  ['Composition', ['pie', 'donut', 'treemap', 'sunburst', 'funnel', 'sankey']],
  ['Relationship', ['scatter', 'regression', 'bubble', 'heatmap', 'parallel']],
  ['Distribution', ['histogram', 'kde', 'box', 'violin']],
  ['Dimensional', ['scatter3d', 'surface3d', 'bar3d']],
  ['Other', ['kpi', 'wordcloud']],
];

const AGGS = ['sum', 'mean', 'median', 'max', 'min', 'count'];
const KIND_OF = { numeric: 'num', categorical: 'cat', boolean: 'cat', datetime: 'date', text: 'text' };

export default function Builder({ dataset, sheet, onSheet }) {
  const [type, setType] = useState('bar');
  const [spec, setSpec] = useState({});
  const [agg, setAgg] = useState('sum');
  const [bins, setBins] = useState(24);
  const [filter, setFilter] = useState({ column: '', op: 'contains', value: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState([]);

  const cols = sheet?.columns ?? [];
  const byKind = useMemo(() => {
    const acc = { num: [], cat: [], date: [], text: [] };
    cols.forEach((c) => acc[KIND_OF[c.type]]?.push(c.name));
    return acc;
  }, [cols]);

  useEffect(() => {
    api.chartTypes().then((r) => setMeta(r.types)).catch(() => setMeta([]));
  }, []);

  const conf = SPECS[type];

  // Auto-fill sensible defaults whenever the chart type or sheet changes.
  useEffect(() => {
    const next = {};
    (conf?.fields ?? []).forEach((f) => {
      const pool = f.kinds.flatMap((k) => byKind[k] || []);
      if (f.multi) next[f.key] = pool.slice(0, f.key === 'ys' ? 4 : 3);
      else {
        const taken = Object.values(next).filter((v) => typeof v === 'string');
        next[f.key] = pool.find((c) => !taken.includes(c)) ?? pool[0] ?? null;
      }
    });
    setSpec(next);
  }, [type, sheet?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = (conf?.fields ?? []).filter(
    (f) => f.required && (f.multi ? !(spec[f.key] || []).length : !spec[f.key]),
  );

  const run = useCallback(async () => {
    if (missing.length) return;
    setLoading(true);
    setError(null);
    const body = {
      dataset_id: dataset.dataset_id,
      sheet: sheet?.name,
      spec: {
        type,
        ...Object.fromEntries(Object.entries(spec).filter(([, v]) => v && (!Array.isArray(v) || v.length))),
        ...(conf?.agg ? { agg } : {}),
        ...(conf?.bins ? { bins: Number(bins) } : {}),
      },
      filters:
        filter.column && filter.value !== ''
          ? [{ column: filter.column, op: filter.op, value: filter.value }]
          : [],
    };
    try {
      const res = await api.aggregate(body);
      setResult({ ...res, id: `builder-${type}-${Date.now()}` });
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [dataset.dataset_id, sheet?.name, type, spec, agg, bins, filter, conf, missing.length]);

  useEffect(() => {
    const t = setTimeout(run, 120);
    return () => clearTimeout(t);
  }, [run]);

  const typeName = (id) => meta.find((m) => m.id === id)?.name ?? id;
  const typeDesc = (id) => meta.find((m) => m.id === id)?.description ?? '';

  if (!sheet) return <EmptyState title="Load a file first" />;

  return (
    <div className="mx-auto grid w-full max-w-[1680px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <section className="panel flex min-h-0 flex-col gap-4 p-4" aria-label="Chart configuration">
        <header>
          <p className="label">chart builder</p>
          <h1 className="mt-1 text-[18px] font-bold">Compose a chart</h1>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Every series is aggregated on the server, so the preview is the same data the exports
            use.
          </p>
        </header>

        {dataset.sheets.length > 1 && (
          <div>
            <label className="label" htmlFor="builder-sheet">
              sheet
            </label>
            <select
              id="builder-sheet"
              className="field mt-1.5 w-full"
              value={sheet.name}
              onChange={(e) => onSheet(e.target.value)}
            >
              {dataset.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.rows.toLocaleString()} rows)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="scroll-y -mr-1 max-h-[300px] pr-1">
          {GROUPS.map(([group, ids]) => (
            <div key={group} className="mb-3">
              <p className="label">{group}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ids.map((id) => {
                  const on = id === type;
                  const buildable = (SPECS[id].fields ?? []).every(
                    (f) => !f.required || f.kinds.some((k) => (byKind[k] || []).length),
                  );
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!buildable}
                      onClick={() => setType(id)}
                      title={buildable ? typeDesc(id) : 'This sheet has no columns of the required type'}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                        on
                          ? 'border-accent bg-accent/[0.12] text-accent'
                          : 'border-line bg-surface/50 text-muted hover:border-accent/40 hover:text-ink'
                      }`}
                      data-testid={`chart-type-${id}`}
                    >
                      {typeName(id)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-line/70 pt-3">
          {(conf?.fields ?? []).map((f) => {
            const pool = f.kinds.flatMap((k) => byKind[k] || []);
            if (!pool.length) {
              return (
                <p key={f.key} className="text-[11px] text-warn">
                  {f.label}: no {f.kinds.join('/')} column in this sheet.
                </p>
              );
            }
            if (f.multi) {
              const chosen = spec[f.key] || [];
              return (
                <fieldset key={f.key}>
                  <legend className="label">
                    {f.label} · {chosen.length} selected
                  </legend>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {pool.map((c) => {
                      const on = chosen.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setSpec((s) => ({
                              ...s,
                              [f.key]: on ? chosen.filter((x) => x !== c) : [...chosen, c],
                            }))
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            on ? 'border-accent bg-accent/[0.12] text-accent' : 'border-line text-muted hover:text-ink'
                          }`}
                          title={c}
                        >
                          {truncate(c, 18)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            }
            return (
              <div key={f.key}>
                <label className="label" htmlFor={`field-${f.key}`}>
                  {f.label}
                  {!f.required && <span className="text-faint"> · optional</span>}
                </label>
                <select
                  id={`field-${f.key}`}
                  className="field mt-1.5 w-full"
                  value={spec[f.key] ?? ''}
                  onChange={(e) => setSpec((s) => ({ ...s, [f.key]: e.target.value || null }))}
                  data-testid={`select-${f.key}`}
                >
                  {!f.required && <option value="">— none —</option>}
                  {pool.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {conf?.agg && (
            <div>
              <label className="label" htmlFor="field-agg">
                aggregation
              </label>
              <select
                id="field-agg"
                className="field mt-1.5 w-full"
                value={agg}
                onChange={(e) => setAgg(e.target.value)}
              >
                {AGGS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}

          {conf?.bins && (
            <div>
              <label className="label" htmlFor="field-bins">
                bins · {bins}
              </label>
              <input
                id="field-bins"
                type="range"
                min="5"
                max="60"
                value={bins}
                onChange={(e) => setBins(e.target.value)}
                className="mt-2 w-full accent-accent"
              />
            </div>
          )}

          <fieldset className="rounded-lg border border-line/80 p-2.5">
            <legend className="label px-1">filter (optional)</legend>
            <div className="flex gap-1.5">
              <select
                aria-label="Filter column"
                className="field min-w-0 flex-1 py-1 text-[11px]"
                value={filter.column}
                onChange={(e) => setFilter((f) => ({ ...f, column: e.target.value }))}
              >
                <option value="">— none —</option>
                {cols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter operator"
                className="field w-[78px] py-1 text-[11px]"
                value={filter.op}
                onChange={(e) => setFilter((f) => ({ ...f, op: e.target.value }))}
              >
                {['contains', '>', '>=', '<', '<=', '=='].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <input
                aria-label="Filter value"
                className="field w-[80px] py-1 text-[11px]"
                value={filter.value}
                placeholder="value"
                onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))}
              />
            </div>
          </fieldset>
        </div>
      </section>

      <section className="panel flex min-h-[560px] flex-col p-4 sm:p-5" aria-label="Chart preview">
        <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className="label truncate">{typeName(type)}</p>
            <h2 className="mt-1 truncate text-[17px] font-bold sm:text-[20px]">
              {result?.title ?? typeDesc(type)}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {result && (
              <span className="num text-[11px] text-faint">{fmtNum(result.rows)} rows</span>
            )}
            <button
              type="button"
              className="btn py-1.5 text-[11px]"
              onClick={run}
              disabled={loading || missing.length > 0}
            >
              {loading ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Refresh
            </button>
          </div>
        </header>

        <div className="relative mt-4 min-h-[320px] flex-1">
          {missing.length ? (
            <EmptyState
              title={`Choose a ${missing.map((m) => m.label.toLowerCase()).join(' and ')}`}
              hint="Required fields are missing for this chart type."
              icon="sliders"
            />
          ) : error ? (
            <ErrorState error={error} onRetry={run} />
          ) : loading && !result ? (
            <ChartSkeleton />
          ) : result ? (
            <motion.div
              key={result.id}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <ChartView slide={{ ...result, id: result.id }} />
            </motion.div>
          ) : (
            <ChartSkeleton />
          )}
        </div>

        {result && (
          <footer className="mt-4 space-y-2 border-t border-line/70 pt-3">
            <p className="text-[12.5px] leading-relaxed text-muted">
              <span className="mr-1.5 font-semibold text-accent">Insight</span>
              {result.insight || result.rationale}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(result.spec).map(([k, v]) => (
                <span key={k} className="chip border-line text-faint">
                  <span className="text-muted">{k}</span>&nbsp;
                  <span className="num text-ink">{Array.isArray(v) ? v.join(', ') : String(v)}</span>
                </span>
              ))}
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
