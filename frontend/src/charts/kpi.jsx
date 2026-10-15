/* KPI sparkline cards — light-weight inline SVG, no chart library needed. */
import { motion } from 'framer-motion';
import { useTheme } from '../lib/theme';
import { fmtNum, truncate } from '../lib/format';

export default function KpiView({ slide }) {
  const t = useTheme();
  const cards = slide.data.cards;
  return (
    <div
      className="grid h-full w-full content-center gap-3 p-1"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
        gridAutoRows: cards.length <= 4 ? 'minmax(0, 320px)' : 'minmax(0, 200px)',
      }}
    >
      {cards.map((card, i) => (
        <motion.article
          key={card.label}
          className="flex min-w-0 flex-col justify-between rounded-xl border border-line bg-surface/70 p-4"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: t.reducedMotion ? 0 : 0.6,
            ease: [0.22, 1, 0.36, 1],
            delay: t.reducedMotion ? 0 : i * 0.09,
          }}
        >
          <header className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 truncate text-[12px] font-medium text-muted" title={card.label}>
              {truncate(card.label, 22)}
            </h4>
            {card.delta !== null && card.delta !== undefined && (
              <span
                className={`num shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${
                  card.delta >= 0 ? 'bg-accent/12 text-accent' : 'bg-warn/12 text-warn'
                }`}
              >
                {card.delta >= 0 ? '▲' : '▼'} {Math.abs(card.delta).toFixed(1)}%
              </span>
            )}
          </header>
          <p className="num mt-3 truncate text-[26px] font-medium leading-none text-ink">
            {fmtNum(card.value)}
          </p>
          <Spark values={card.spark} color={t.colors[i % t.colors.length]} reduced={t.reducedMotion} />
          <footer className="mt-2 flex justify-between gap-2 text-[10px] text-faint">
            <span className="num truncate">min {fmtNum(card.min)}</span>
            <span className="num truncate">avg {fmtNum(card.mean)}</span>
            <span className="num truncate">max {fmtNum(card.max)}</span>
          </footer>
        </motion.article>
      ))}
    </div>
  );
}

function Spark({ values = [], color, reduced }) {
  const pts = (values || []).filter((v) => v !== null && v !== undefined);
  if (pts.length < 2) return <div className="mt-3 h-10" />;
  const w = 200;
  const h = 40;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo || 1)) * (h - 4) - 2;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sp-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#sp-${color.replace('#', '')})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.8 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: reduced ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
