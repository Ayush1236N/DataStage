import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from './lib/api';
import { useTheme } from './lib/theme';
import { Icon, Logo, Spinner, Toggle } from './components/ui';
import Landing from './views/Landing';
import Studio from './views/Studio';

const Presentation = lazy(() => import('./views/Presentation'));
const Builder = lazy(() => import('./views/Builder'));

const VIEWS = [
  { value: 'studio', label: 'Data studio' },
  { value: 'present', label: 'Presentation' },
  { value: 'builder', label: 'Chart builder' },
];

export default function App() {
  const theme = useTheme();
  const [view, setView] = useState('landing');
  const [dataset, setDataset] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [plans, setPlans] = useState({}); // sheet -> slides
  const [typeOverrides, setTypeOverrides] = useState({}); // sheet -> {col: type}
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [apiUp, setApiUp] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then(() => alive && setApiUp(true))
      .catch(() => alive && setApiUp(false));
    return () => {
      alive = false;
    };
  }, []);

  const onDataset = useCallback((ds) => {
    setDataset(ds);
    setPlans({});
    setTypeOverrides({});
    setSheet(ds.sheets[0]?.name ?? null);
    setError(null);
    setView('studio');
  }, []);

  const activeSheet = useMemo(
    () => dataset?.sheets.find((s) => s.name === sheet) ?? dataset?.sheets[0] ?? null,
    [dataset, sheet],
  );

  const generate = useCallback(
    async (onProgress) => {
      if (!dataset || !activeSheet) return;
      setBusy('analyze');
      setError(null);
      try {
        await api.progress(dataset.dataset_id, activeSheet.name, onProgress).catch(() => {
          /* progress stream is best-effort; the analyze call below is the source of truth */
        });
        const res = await api.analyze({
          dataset_id: dataset.dataset_id,
          sheet: activeSheet.name,
          types: typeOverrides[activeSheet.name] || {},
        });
        setPlans((p) => ({ ...p, [activeSheet.name]: res.slides }));
        setView('present');
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [dataset, activeSheet, typeOverrides],
  );

  const slides = activeSheet ? plans[activeSheet.name] : null;

  const setSheetTypes = useCallback(
    (name, next) => setTypeOverrides((prev) => ({ ...prev, [name]: next })),
    [],
  );

  const reset = () => {
    setDataset(null);
    setPlans({});
    setView('landing');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-bg"
      >
        Skip to content
      </a>

      {view !== 'present' && (
        <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/85 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={reset}
              className="btn-ghost -ml-2 rounded-lg px-2 py-1"
              aria-label="DataStage home"
            >
              <Logo />
            </button>
            <span className="hidden text-[11px] text-faint sm:inline">
              auto-presentation chart studio
            </span>

            <div className="ml-auto flex items-center gap-2">
              {dataset && (
                <div className="hidden md:block">
                  <Toggle label="view" options={VIEWS} value={view} onChange={setView} />
                </div>
              )}
              <button
                type="button"
                onClick={theme.toggle}
                className="btn-ghost rounded-lg p-2"
                aria-label={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} theme`}
                title={`${theme.mode === 'dark' ? 'Light' : 'Dark'} theme`}
              >
                <Icon name={theme.mode === 'dark' ? 'sun' : 'moon'} size={17} />
              </button>
              {dataset && (
                <button type="button" onClick={reset} className="btn hidden py-1.5 text-xs sm:inline-flex">
                  <Icon name="upload" size={14} /> New file
                </button>
              )}
            </div>
          </div>
          {dataset && (
            <div className="mx-auto flex w-full max-w-[1680px] items-center gap-2 overflow-x-auto px-4 pb-2 md:hidden sm:px-6">
              <Toggle label="view-mobile" options={VIEWS} value={view} onChange={setView} />
            </div>
          )}
        </header>
      )}

      <main id="main" className="flex flex-1 flex-col">
        {apiUp === false && (
          <div className="border-b border-warn/40 bg-warn/[0.08] px-4 py-2 text-center text-[12px] text-ink">
            The DataStage API is not reachable. Start the backend with{' '}
            <code className="num text-accent">python backend/app.py</code> and reload.
          </div>
        )}

        <AnimatePresence mode="wait">
          {view === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.4 }}
              className="flex flex-1 flex-col"
            >
              <Landing onDataset={onDataset} error={error} setError={setError} />
            </motion.div>
          )}

          {view === 'studio' && dataset && (
            <motion.div
              key="studio"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-1 flex-col"
            >
              <Studio
                dataset={dataset}
                sheet={activeSheet}
                onSheet={setSheet}
                overrides={typeOverrides[activeSheet?.name] || {}}
                onOverrides={(next) => setSheetTypes(activeSheet.name, next)}
                onGenerate={generate}
                busy={busy}
                error={error}
                hasPlan={!!slides}
                onPresent={() => setView('present')}
                onBuild={() => setView('builder')}
              />
            </motion.div>
          )}

          {view === 'present' && dataset && (
            <motion.div
              key="present"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.3 }}
              className="flex flex-1 flex-col"
            >
              <Suspense fallback={<CenterSpinner label="Loading presentation" />}>
                <Presentation
                  dataset={dataset}
                  sheet={activeSheet}
                  slides={slides}
                  onExit={() => setView('studio')}
                  onGenerate={generate}
                  busy={busy}
                  error={error}
                />
              </Suspense>
            </motion.div>
          )}

          {view === 'builder' && dataset && (
            <motion.div
              key="builder"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-1 flex-col"
            >
              <Suspense fallback={<CenterSpinner label="Loading chart builder" />}>
                <Builder dataset={dataset} sheet={activeSheet} onSheet={setSheet} />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {view !== 'present' && (
        <footer className="border-t border-line/70 px-4 py-5 sm:px-6">
          <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
            <span>
              DataStage · FastAPI + React · 37 chart types · parsing via pandas, openpyxl and
              python-docx
            </span>
            <span className="num">
              {dataset
                ? `${dataset.name} · ${dataset.sheets.length} sheet${dataset.sheets.length > 1 ? 's' : ''}`
                : 'no dataset loaded'}
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}

function CenterSpinner({ label }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-3 p-16 text-sm text-muted">
      <Spinner /> {label}…
    </div>
  );
}
