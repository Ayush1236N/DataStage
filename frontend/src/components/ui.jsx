import { motion } from 'framer-motion';

/* Custom mark: four instrument bars with a plotted node — reads at 20px and 200px. */
export function Logo({ size = 26, withWordmark = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        role="img"
        aria-label="DataStage logo"
      >
        <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="7.5" stroke="currentColor" strokeOpacity="0.22" />
        <g stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" className="text-accent">
          <path d="M7 24V15" />
          <path d="M13 24V9.5" />
          <path d="M19 24v-5.5" />
          <path d="M25 24V12.5" />
        </g>
        <circle cx="19" cy="12.4" r="2.5" fill="currentColor" className="text-accent" />
      </svg>
      {withWordmark && (
        <span className="text-[15px] font-bold tracking-tight">
          Data<span className="text-accent">Stage</span>
        </span>
      )}
    </span>
  );
}

export function Spinner({ size = 16, label = 'Loading' }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <svg width={size} height={size} viewBox="0 0 24 24" className="spin-slow text-accent">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" fill="none" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function ChartSkeleton({ rows = 7 }) {
  return (
    <div className="flex h-full w-full flex-col justify-end gap-3 p-6" aria-hidden="true">
      <div className="skeleton h-3 w-40" />
      <div className="flex h-full items-end gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="skeleton flex-1"
            style={{ height: `${28 + ((i * 37) % 62)}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      <div className="skeleton h-2.5 w-full" />
    </div>
  );
}

export function EmptyState({ title, hint, icon = 'chart', action }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 p-8 text-center">
      <svg width="40" height="40" viewBox="0 0 32 32" fill="none" className="text-faint" aria-hidden="true">
        {icon === 'chart' ? (
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M5 27h22" strokeOpacity="0.5" />
            <path d="M9 27V17M16 27v-6M23 27V12" />
            <circle cx="23" cy="8" r="2" strokeOpacity="0.6" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 4h11l6 6v18H8z" />
            <path d="M19 4v6h6" strokeOpacity="0.6" />
          </g>
        )}
      </svg>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-[13px] leading-relaxed text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }) {
  const message = typeof error === 'string' ? error : error?.message || 'Something went wrong.';
  return (
    <div
      role="alert"
      className={`flex flex-col items-start gap-2 rounded-lg border border-warn/40 bg-warn/[0.07] p-4 ${
        compact ? '' : 'h-full justify-center'
      }`}
    >
      <span className="chip border-warn/40 text-warn">error</span>
      <p className="text-[13px] leading-relaxed text-ink">{message}</p>
      {onRetry && (
        <button type="button" className="btn mt-1 py-1.5 text-xs" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Toggle({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`relative rounded-[6px] px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              active ? 'text-bg' : 'text-muted hover:text-ink'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`toggle-${label}`}
                className="absolute inset-0 rounded-[6px] bg-accent"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, unit }) {
  return (
    <div className="min-w-0">
      <p className="label truncate">{label}</p>
      <p className="num mt-1 truncate text-[17px] font-medium text-ink">
        {value}
        {unit && <span className="ml-1 text-[11px] text-faint">{unit}</span>}
      </p>
    </div>
  );
}

export function ProgressRail({ pct, detail, stage }) {
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label truncate">{stage}</span>
        <span className="num text-xs text-accent">{Math.round(pct)}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.5 }}
        />
      </div>
      {detail && <p className="mt-2 truncate text-xs text-muted">{detail}</p>}
    </div>
  );
}

export function Icon({ name, size = 16 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  const s = { stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    play: <path d="M8 5.5v13l11-6.5z" {...s} />,
    pause: <g {...s}><path d="M9 5v14M15 5v14" /></g>,
    prev: <path d="M15 6l-6 6 6 6" {...s} />,
    next: <path d="M9 6l6 6-6 6" {...s} />,
    close: <g {...s}><path d="M6 6l12 12M18 6L6 18" /></g>,
    download: <g {...s}><path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" /></g>,
    sun: <g {...s}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></g>,
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" {...s} />,
    grid: <g {...s}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></g>,
    sliders: <g {...s}><path d="M5 7h14M5 12h9M5 17h5" /><circle cx="17" cy="12" r="2" /><circle cx="12" cy="17" r="2" /></g>,
    upload: <g {...s}><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19.5h14" /></g>,
    table: <g {...s}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M10 10v9" /></g>,
    expand: <g {...s}><path d="M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5" /></g>,
    sparkle: <g {...s}><path d="M12 4l1.8 4.7L18.5 10l-4.7 1.7L12 16.5l-1.8-4.8L5.5 10l4.7-1.3z" /><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></g>,
    arrowRight: <path d="M5 12h13m0 0-5-5m5 5-5 5" {...s} />,
    check: <path d="M5 12.5l4.5 4.5L19 7" {...s} />,
    refresh: <g {...s}><path d="M19 12a7 7 0 1 1-2.3-5.2" /><path d="M19 4v4h-4" /></g>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}
