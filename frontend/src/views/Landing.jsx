import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { fmtBytes } from '../lib/format';
import { useTheme } from '../lib/theme';
import { ErrorState, Icon, ProgressRail, Spinner } from '../components/ui';

const Hero3D = lazy(() => import('../components/Hero3D'));

const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.tsv,.json,.docx';
const CHART_NAMES = [
  'bar', 'grouped bar', 'stacked bar', 'horizontal bar', 'line', 'multi-line', 'area',
  'stacked area', 'step line', 'pie', 'donut', 'gauge', 'radar', 'polar area', 'radial bar',
  'scatter', 'bubble', 'regression', 'histogram', 'density', 'box', 'violin', 'correlation heatmap',
  'treemap', 'sunburst', 'funnel', 'waterfall', 'sankey', 'parallel coordinates', 'candlestick',
  'pareto', 'KPI sparklines', 'word cloud', 'calendar heatmap', '3D scatter', '3D surface', '3D bars',
];

export default function Landing({ onDataset, error, setError }) {
  const theme = useTheme();
  const [samples, setSamples] = useState([]);
  const [pending, setPending] = useState(null);
  const [pct, setPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api
      .samples()
      .then((r) => setSamples(r.samples))
      .catch(() => setSamples([]));
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setPct(0);
    setPending(file.name);
    try {
      const ds = await api.upload(file, setPct);
      onDataset(ds);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  const handleSample = async (name) => {
    setError(null);
    setPending(name);
    setPct(60);
    try {
      const ds = await api.sample(name);
      onDataset(ds);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="relative flex flex-1 flex-col">
      <section className="relative isolate flex min-h-[640px] flex-1 flex-col justify-center overflow-hidden">
        <Suspense fallback={<div className="absolute inset-0 grid-bg opacity-60" />}>
          <Hero3D />
        </Suspense>

        <div className="relative z-10 mx-auto grid w-full max-w-[1180px] grid-cols-[minmax(0,1fr)] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-14">
          <div>
            <motion.p
              className="label"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.5 }}
            >
              upload → profile → present
            </motion.p>
            <motion.h1
              className="mt-3 max-w-[16ch] text-[clamp(2.4rem,6vw,4.1rem)] font-black leading-[0.95]"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              Your data,
              <br />
              <span className="text-accent">already presented.</span>
            </motion.h1>
            <motion.p
              className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: theme.reducedMotion ? 0 : 0.15, duration: 0.6 }}
            >
              Drop a spreadsheet, CSV, JSON or Word report. DataStage profiles every column,
              chooses the charts your data actually supports, writes the insight for each one, and
              plays the whole deck back — {CHART_NAMES.length} chart types including live 3D scatter
              and surface plots.
            </motion.p>

            <motion.div
              className="mt-7 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: theme.reducedMotion ? 0 : 0.25, duration: 0.5 }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => inputRef.current?.click()}
                data-testid="button-upload-hero"
              >
                <Icon name="upload" size={16} /> Upload a file
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleSample('sales.xlsx')}
                disabled={!!pending}
                data-testid="button-try-sample"
              >
                <Icon name="sparkle" size={16} /> Try a sample
              </button>
            </motion.div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-faint">
              <span>xlsx · xls · csv · tsv · json · docx</span>
              <span>50 MB cap</span>
              <span>server-side aggregation</span>
              <span>PPTX / PDF / XLSX export</span>
            </div>
          </div>

          <motion.div
            className="panel relative p-5"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: theme.reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Upload a data file by dropping it here or pressing Enter to browse"
              className={`flex min-h-[188px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center transition-all duration-300 ease-smooth ${
                dragging
                  ? 'border-accent bg-accent/[0.07] shadow-glow'
                  : 'border-line bg-surface/50 hover:border-accent/50'
              }`}
              data-testid="dropzone"
            >
              {pending ? (
                <div className="w-full max-w-[280px]">
                  <div className="mb-3 flex items-center justify-center gap-2 text-[13px] text-ink">
                    <Spinner /> Parsing {pending}
                  </div>
                  <ProgressRail
                    pct={pct}
                    stage={pct < 100 ? 'transferring' : 'profiling columns'}
                    detail="Type inference and column statistics run server-side"
                  />
                  <div className="mt-4 space-y-2" aria-hidden="true">
                    <div className="skeleton h-2.5 w-full" />
                    <div className="skeleton h-2.5 w-4/5" />
                    <div className="skeleton h-2.5 w-2/3" />
                  </div>
                </div>
              ) : (
                <>
                  <span className="rounded-xl border border-line bg-panel p-3 text-accent">
                    <Icon name="upload" size={22} />
                  </span>
                  <p className="text-[14px] font-semibold text-ink">Drop your data file here</p>
                  <p className="max-w-[34ch] text-[12px] leading-relaxed text-muted">
                    Multi-sheet workbooks, ragged CSVs and Word tables are all handled. Nothing
                    leaves this sandbox.
                  </p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                data-testid="input-file"
              />
            </div>

            {error && (
              <div className="mt-4">
                <ErrorState error={error} compact />
              </div>
            )}

            <div className="mt-5">
              <p className="label">or start from a sample</p>
              <ul className="mt-3 space-y-2">
                {samples.length === 0
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <li key={i} className="skeleton h-[52px] w-full" />
                    ))
                  : samples.map((s) => (
                      <li key={s.file}>
                        <button
                          type="button"
                          onClick={() => handleSample(s.file)}
                          disabled={!!pending}
                          className="group flex w-full items-center gap-3 rounded-lg border border-line bg-surface/60 p-3 text-left transition-colors hover:border-accent/50 hover:bg-surface disabled:opacity-50"
                          data-testid={`button-sample-${s.file}`}
                        >
                          <span className="chip shrink-0 border-accent/30 text-accent">{s.ext}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink">
                              {s.title}
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {s.description}
                            </span>
                          </span>
                          <span className="num shrink-0 text-[10px] text-faint">
                            {fmtBytes(s.size)}
                          </span>
                          <span className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                            <Icon name="arrowRight" size={15} />
                          </span>
                        </button>
                      </li>
                    ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="border-y border-line/70 bg-surface/40 py-4">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-5 sm:px-8">
          <p className="label">every chart in the library</p>
          <div className="flex flex-wrap gap-1.5">
            {CHART_NAMES.map((name) => (
              <span
                key={name}
                className="rounded-md border border-line/80 bg-panel/60 px-2 py-1 text-[11px] text-muted"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1180px] gap-6 px-5 py-14 sm:px-8 md:grid-cols-3">
        {[
          {
            k: '01',
            t: 'Parse anything tabular',
            d: 'pandas + openpyxl for workbooks and delimited text, python-docx for Word tables and numeric statements buried in prose. Ragged rows, title rows and merged headers are recovered instead of crashing.',
          },
          {
            k: '02',
            t: 'Plan, then aggregate',
            d: 'Columns are typed as numeric, categorical, datetime, boolean or text. The planner scores what each pair of columns can support, then every series is grouped, binned or LTTB-downsampled on the server.',
          },
          {
            k: '03',
            t: 'Present and export',
            d: 'One chart per slide with keyboard and scroll navigation, auto-play, generated insight text, and a deck export to PPTX, PDF or XLSX rendered from the same specs.',
          },
        ].map((c) => (
          <article key={c.k} className="panel p-5">
            <span className="num text-[11px] text-accent">{c.k}</span>
            <h3 className="mt-2 text-[15px] font-bold">{c.t}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{c.d}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
