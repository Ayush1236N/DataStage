import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChartView from '../charts';
import { api, downloadUrl } from '../lib/api';
import { fmtNum } from '../lib/format';
import { useTheme } from '../lib/theme';
import { EmptyState, ErrorState, Icon, Logo, Spinner } from '../components/ui';

const AUTOPLAY_MS = 7000;

export default function Presentation({ dataset, sheet, slides, onExit, onGenerate, busy, error }) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overview, setOverview] = useState(false);
  const [dir, setDir] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const wheelLock = useRef(0);
  const touchStart = useRef(null);
  const count = slides?.length ?? 0;

  const go = useCallback(
    (next) => {
      if (!count) return;
      setDir(next > index ? 1 : -1);
      setIndex(((next % count) + count) % count);
      setElapsed(0);
    },
    [count, index],
  );

  useEffect(() => {
    setIndex(0);
  }, [sheet?.name, slides]);

  // keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
        e.preventDefault();
        go(index + 1);
      } else if (k === 'ArrowLeft' || k === 'PageUp') {
        e.preventDefault();
        go(index - 1);
      } else if (k === 'Home') go(0);
      else if (k === 'End') go(count - 1);
      else if (k === 'Escape') {
        if (overview) setOverview(false);
        else onExit();
      } else if (k.toLowerCase() === 'p') setPlaying((p) => !p);
      else if (k.toLowerCase() === 'g') setOverview((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, count, onExit, overview]);

  // autoplay
  useEffect(() => {
    if (!playing || !count) return;
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - started), 120);
    const timer = setTimeout(() => go(index + 1), AUTOPLAY_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [playing, index, count, go]);

  const slide = slides?.[index];

  const onWheel = (e) => {
    if (overview) return;
    if (Math.abs(e.deltaY) < 22) return;
    const now = Date.now();
    if (now - wheelLock.current < 620) return;
    wheelLock.current = now;
    go(index + (e.deltaY > 0 ? 1 : -1));
  };

  const kpiSlide = useMemo(() => slides?.find((s) => s.type === 'kpi'), [slides]);

  if (!slides) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-24 text-center">
        {error ? (
          <ErrorState error={error} onRetry={() => onGenerate(() => {})} />
        ) : (
          <>
            <EmptyState
              title="No deck yet for this sheet"
              hint={`Build the presentation for “${sheet?.name}” and DataStage will pick the charts, write each insight, and play them back.`}
              icon="sparkle"
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onGenerate(() => {})}
                  disabled={busy === 'analyze'}
                >
                  {busy === 'analyze' ? <Spinner size={14} /> : <Icon name="sparkle" size={15} />}
                  {busy === 'analyze' ? 'Building…' : 'Generate charts'}
                </button>
              }
            />
            <button type="button" className="btn py-1.5 text-xs" onClick={onExit}>
              Back to data studio
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-1 flex-col bg-bg"
      onWheel={onWheel}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStart.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current;
        if (Math.abs(dx) > 55) go(index + (dx < 0 ? 1 : -1));
        touchStart.current = null;
      }}
    >
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line/80 px-3 py-2 sm:px-5">
        <Logo size={22} withWordmark={false} />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-ink">{dataset.name}</p>
          <p className="num truncate text-[10px] text-faint">
            {sheet?.name} · {count} slides
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5"
            onClick={() => setOverview((o) => !o)}
            aria-pressed={overview}
            aria-label="Toggle slide overview (G)"
            title="Slide overview (G)"
            data-testid="button-overview"
          >
            <Icon name="grid" size={15} />
          </button>
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5"
            onClick={() => downloadUrl(api.pngUrl(dataset.dataset_id, slide.id, sheet?.name))}
            aria-label="Download this chart as PNG"
            title="Download PNG"
          >
            <Icon name="download" size={15} />
          </button>
          <button
            type="button"
            className="btn py-1.5 text-[11px]"
            onClick={() => downloadUrl(api.exportUrl(dataset.dataset_id, sheet?.name, 'pptx'))}
            data-testid="button-export-deck"
          >
            <Icon name="download" size={13} /> Deck
          </button>
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5"
            onClick={theme.toggle}
            aria-label="Toggle theme"
          >
            <Icon name={theme.mode === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
          <button
            type="button"
            className="btn py-1.5 text-[11px]"
            onClick={onExit}
            data-testid="button-exit-present"
          >
            <Icon name="close" size={13} /> Exit
          </button>
        </div>
      </header>

      {/* progress rail */}
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <span className="num shrink-0 text-[11px] text-accent">
          {String(index + 1).padStart(2, '0')}
          <span className="text-faint">/{String(count).padStart(2, '0')}</span>
        </span>
        <div className="flex min-w-0 flex-1 gap-[3px]" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}: ${s.name}`}
              onClick={() => go(i)}
              className="group relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line transition-colors hover:bg-accent/50"
            >
              <span
                className={`absolute inset-0 origin-left rounded-full transition-transform duration-300 ${
                  i < index ? 'bg-accent/45' : i === index ? 'bg-accent' : 'bg-transparent'
                }`}
                style={
                  i === index && playing && !theme.reducedMotion
                    ? { transform: `scaleX(${Math.min(elapsed / AUTOPLAY_MS, 1)})` }
                    : undefined
                }
              />
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
          >
            <Icon name="prev" size={14} />
          </button>
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5 text-accent"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause autoplay' : 'Start autoplay'}
            data-testid="button-play"
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
          <button
            type="button"
            className="btn-ghost rounded-md border border-line p-1.5"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            data-testid="button-next"
          >
            <Icon name="next" size={14} />
          </button>
        </div>
      </div>

      {/* stage */}
      {overview ? (
        <Overview slides={slides} index={index} onPick={(i) => { go(i); setOverview(false); }} />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-4 sm:px-5">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.section
              key={slide.id}
              custom={dir}
              initial={{ opacity: 0, x: theme.reducedMotion ? 0 : dir * 46 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: theme.reducedMotion ? 0 : dir * -46 }}
              transition={{ duration: theme.reducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="panel flex min-h-[420px] flex-1 flex-col p-4 sm:p-5"
              aria-live="polite"
              data-testid={`slide-${slide.type}`}
            >
              <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="label truncate">{slide.name}</p>
                  <h2
                    className="mt-1 truncate text-[17px] font-bold leading-tight sm:text-[21px]"
                    title={slide.title}
                  >
                    {slide.title}
                  </h2>
                </div>
                <span className="chip shrink-0 border-accent/30 text-accent">{slide.type}</span>
              </header>

              <div className="relative mt-4 min-h-[260px] flex-1">
                <ChartView slide={slide} />
              </div>

              <footer className="mt-4 border-t border-line/70 pt-3">
                <p className="text-[12.5px] leading-relaxed text-muted sm:text-[13.5px]">
                  <span className="mr-1.5 font-semibold text-accent">Insight</span>
                  {slide.insight || slide.rationale}
                </p>
                {kpiSlide && slide.type !== 'kpi' && (
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                    {kpiSlide.data.cards.slice(0, 4).map((c) => (
                      <li key={c.label} className="min-w-0">
                        <span className="label block truncate max-w-[150px]">{c.label}</span>
                        <span className="num text-[13px] text-ink">{fmtNum(c.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </footer>
            </motion.section>
          </AnimatePresence>

          <p className="mt-2 hidden text-center text-[10.5px] text-faint sm:block">
            ← → or space to navigate · P autoplay · G overview · Esc exits
          </p>
        </div>
      )}
    </div>
  );
}

function Overview({ slides, index, onPick }) {
  return (
    <div className="scroll-y flex-1 px-3 pb-6 sm:px-5">
      <ul className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
        {slides.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(i)}
              className={`flex h-full w-full flex-col rounded-xl border p-3 text-left transition-colors ${
                i === index
                  ? 'border-accent/60 bg-accent/[0.07]'
                  : 'border-line bg-surface/50 hover:border-accent/40'
              }`}
              data-testid={`overview-slide-${i}`}
            >
              <span className="num text-[10px] text-faint">{String(i + 1).padStart(2, '0')}</span>
              <span className="mt-1 line-clamp-2 text-[13px] font-semibold text-ink">{s.title}</span>
              <span className="mt-1 text-[11px] text-accent">{s.name}</span>
              <span className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted">
                {s.insight || s.rationale}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
