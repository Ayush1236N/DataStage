/* D3-driven SVG charts: sunburst, parallel coordinates, funnel, calendar heatmap,
   radial bar. Lazily imported. All animate on entry and respect reduced motion. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { arc as d3arc } from 'd3-shape';
import { scaleLinear, scaleSequential } from 'd3-scale';
import { interpolateRgbBasis } from 'd3-interpolate';
import { useTheme } from '../lib/theme';
import { fmtNum, truncate } from '../lib/format';

export const D3_TYPES = new Set(['sunburst', 'parallel', 'funnel', 'calendar', 'radial_bar']);

function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(200, width), h: Math.max(160, height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export default function D3View({ slide, options = {} }) {
  const t = useTheme();
  const [ref, { w, h }] = useSize();
  const ready = w > 0 && h > 0;
  const props = { slide, w, h, t, options };
  return (
    <div ref={ref} className="h-full w-full">
      {ready && (
        <>
          {slide.type === 'sunburst' && <Sunburst {...props} />}
          {slide.type === 'parallel' && <Parallel {...props} />}
          {slide.type === 'funnel' && <Funnel {...props} />}
          {slide.type === 'calendar' && <Calendar {...props} />}
          {slide.type === 'radial_bar' && <RadialBar {...props} />}
        </>
      )}
    </div>
  );
}

const ease = [0.22, 1, 0.36, 1];
const spring = (i, reduced) =>
  reduced
    ? { duration: 0 }
    : { duration: 0.75, ease, delay: Math.min(i * 0.045, 0.6) };

/* ── Sunburst ───────────────────────────────────────────────────────────── */
function Sunburst({ slide, w, h, t }) {
  const nodes = slide.data.nodes;
  const size = Math.min(w, h - 8);
  const r = size / 2;
  const total = nodes.reduce((a, n) => a + (n.value || 0), 0) || 1;
  const [hover, setHover] = useState(null);
  const inner = d3arc().innerRadius(r * 0.28).outerRadius(r * 0.62).padAngle(0.008).cornerRadius(2);
  const outer = d3arc().innerRadius(r * 0.64).outerRadius(r * 0.95).padAngle(0.005).cornerRadius(2);

  let angle = -Math.PI / 2;
  const rings = nodes.map((n, i) => {
    const span = ((n.value || 0) / total) * Math.PI * 2;
    const seg = { node: n, start: angle, end: angle + span, color: t.colors[i % t.colors.length], i };
    let childAngle = angle;
    seg.children = (n.children || []).map((ch, j) => {
      const cspan = ((ch.value || 0) / total) * Math.PI * 2;
      const c = { node: ch, start: childAngle, end: childAngle + cspan, j };
      childAngle += cspan;
      return c;
    });
    angle += span;
    return seg;
  });

  const focus = hover ?? { label: slide.spec?.x ?? 'Total', value: total };
  return (
    <div className="flex h-full items-center justify-center">
      <svg width={size} height={size} role="img" aria-label={slide.title}>
        <g transform={`translate(${size / 2},${size / 2})`}>
          {rings.map((seg) => (
            <g key={seg.node.label}>
              <motion.path
                d={inner({ startAngle: seg.start, endAngle: seg.end })}
                fill={seg.color}
                fillOpacity={hover && hover.label !== seg.node.label ? 0.32 : 0.9}
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={spring(seg.i, t.reducedMotion)}
                onMouseEnter={() => setHover({ label: seg.node.label, value: seg.node.value })}
                onMouseLeave={() => setHover(null)}
                tabIndex={0}
                onFocus={() => setHover({ label: seg.node.label, value: seg.node.value })}
                onBlur={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${seg.node.label}: ${fmtNum(seg.node.value)}`}</title>
              </motion.path>
              {seg.children.map((c) => (
                <motion.path
                  key={`${seg.node.label}-${c.node.label}`}
                  d={outer({ startAngle: c.start, endAngle: c.end })}
                  fill={seg.color}
                  fillOpacity={0.42}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={spring(seg.i + c.j + 2, t.reducedMotion)}
                  onMouseEnter={() => setHover({ label: `${seg.node.label} · ${c.node.label}`, value: c.node.value })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${seg.node.label} → ${c.node.label}: ${fmtNum(c.node.value)}`}</title>
                </motion.path>
              ))}
            </g>
          ))}
          <text textAnchor="middle" y={-4} className="fill-current text-[11px] text-muted">
            {truncate(focus.label, 18)}
          </text>
          <text
            textAnchor="middle"
            y={16}
            className="num fill-current text-[15px] font-medium text-ink"
          >
            {fmtNum(focus.value)}
          </text>
        </g>
      </svg>
    </div>
  );
}

/* ── Parallel coordinates ───────────────────────────────────────────────── */
function Parallel({ slide, w, h, t, options }) {
  const { dims, rows, groups } = slide.data;
  const hasLegend = Boolean(groups && groups.length) && options.legend !== false;
  const pad = { top: 18, right: 26, bottom: hasLegend ? 58 : 34, left: 26 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const x = (i) => (dims.length === 1 ? iw / 2 : (i / (dims.length - 1)) * iw);
  const scales = dims.map((d) => scaleLinear().domain([d.min, d.max]).range([ih, 0]));
  const groupNames = useMemo(() => [...new Set(groups || [])], [groups]);
  const paths = rows.map((row, ri) => ({
    d: row.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${scales[i](v ?? dims[i].min)}`).join(' '),
    color: groups
      ? t.colors[groupNames.indexOf(groups[ri]) % t.colors.length]
      : t.colors[ri % 3 === 0 ? 0 : ri % 3],
  }));

  return (
    <svg width={w} height={h} role="img" aria-label={slide.title}>
      <g transform={`translate(${pad.left},${pad.top})`}>
        {paths.slice(0, 400).map((p, i) => (
          <motion.path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={1}
            strokeOpacity={0.32}
            initial={{ pathLength: t.reducedMotion ? 1 : 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: t.reducedMotion ? 0 : 1, ease, delay: Math.min(i * 0.002, 0.5) }}
          />
        ))}
        {dims.map((d, i) => (
          <g key={d.name} transform={`translate(${x(i)},0)`}>
            <line y1={0} y2={ih} stroke="currentColor" className="text-line" strokeWidth={1} />
            {[0, 0.5, 1].map((f) => (
              <g key={f} transform={`translate(0,${ih * (1 - f)})`}>
                <line x1={-3} x2={3} stroke="currentColor" className="text-faint" />
                <text
                  x={-6}
                  y={3}
                  textAnchor="end"
                  className="num fill-current text-[9px] text-faint"
                >
                  {fmtNum(d.min + (d.max - d.min) * f)}
                </text>
              </g>
            ))}
            <text
              y={ih + 20}
              textAnchor={i === 0 ? 'start' : i === dims.length - 1 ? 'end' : 'middle'}
              className="fill-current text-[10px] font-medium text-muted"
            >
              {truncate(d.name, 14)}
            </text>
          </g>
        ))}
      </g>
      {hasLegend && (
        <g transform={`translate(${pad.left},${h - 10})`}>
          {groupNames.slice(0, 6).map((g, i) => (
            <g key={g} transform={`translate(${i * 92},0)`}>
              <circle r={3.5} cy={-4} fill={t.colors[i % t.colors.length]} />
              <text x={8} className="fill-current text-[10px] text-muted">
                {truncate(g, 11)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/* ── Funnel ─────────────────────────────────────────────────────────────── */
function Funnel({ slide, w, h, t }) {
  const stages = slide.data.stages;
  const pad = 12;
  const rowH = Math.min(64, (h - pad * 2) / Math.max(stages.length, 1));
  const max = Math.max(...stages.map((s) => s.value)) || 1;
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-2">
      {stages.map((s, i) => {
        const width = 22 + (s.value / max) * 78;
        return (
          <div key={s.label} className="flex items-center gap-3" style={{ height: rowH }}>
            <span className="w-[26%] shrink-0 truncate text-right text-[12px] text-muted" title={s.label}>
              {truncate(s.label, 18)}
            </span>
            <div className="relative h-full flex-1">
              <motion.div
                className="absolute inset-y-1 left-0 flex items-center justify-between rounded-md px-3"
                style={{
                  background: `linear-gradient(90deg, ${t.colors[i % t.colors.length]}dd, ${
                    t.colors[i % t.colors.length]
                  }66)`,
                }}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${width}%`, opacity: 1 }}
                transition={spring(i, t.reducedMotion)}
              >
                <span className="num truncate text-[12px] font-semibold text-bg">{fmtNum(s.value)}</span>
                <span className="num ml-2 shrink-0 text-[11px] text-bg/75">{s.pct.toFixed(0)}%</span>
              </motion.div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Calendar heatmap ───────────────────────────────────────────────────── */
function Calendar({ slide, w, h, t }) {
  const days = slide.data.days;
  const weeks = Math.ceil(days.length / 7);
  const cell = Math.max(6, Math.min(16, Math.floor((w - 46) / Math.max(weeks, 1)) - 2));
  const gap = Math.max(1.5, cell * 0.14);
  const max = Math.max(...days.map((d) => d.value || 0)) || 1;
  const color = scaleSequential(
    interpolateRgbBasis([t.mode === 'dark' ? '#16232a' : '#e8ece9', t.colors[1], t.colors[0]]),
  ).domain([0, max]);
  const startDow = new Date(days[0].date).getUTCDay();
  const monthTicks = [];
  days.forEach((d, i) => {
    if (d.date.endsWith('-01')) monthTicks.push({ i: Math.floor((i + startDow) / 7), date: d.date });
  });

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <svg
        width={weeks * (cell + gap) + 40}
        height={7 * (cell + gap) + 34}
        role="img"
        aria-label={slide.title}
      >
        <g transform="translate(34,20)">
          {monthTicks.map((m) => (
            <text
              key={m.date}
              x={m.i * (cell + gap)}
              y={-6}
              className="fill-current text-[9px] text-faint"
            >
              {new Date(m.date).toLocaleDateString(undefined, { month: 'short' })}
            </text>
          ))}
          {['M', 'W', 'F'].map((d, i) => (
            <text
              key={d}
              x={-8}
              y={(i * 2 + 1) * (cell + gap) + cell * 0.8}
              textAnchor="end"
              className="fill-current text-[9px] text-faint"
            >
              {d}
            </text>
          ))}
          {days.map((d, i) => {
            const idx = i + startDow;
            return (
              <motion.rect
                key={d.date}
                x={Math.floor(idx / 7) * (cell + gap)}
                y={(idx % 7) * (cell + gap)}
                width={cell}
                height={cell}
                rx={Math.max(1.5, cell * 0.2)}
                fill={d.value ? color(d.value) : t.mode === 'dark' ? '#131c22' : '#eceeec'}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: t.reducedMotion ? 0 : 0.4,
                  ease,
                  delay: t.reducedMotion ? 0 : Math.min(i * 0.0022, 0.9),
                }}
              >
                <title>{`${d.date}: ${fmtNum(d.value)}`}</title>
              </motion.rect>
            );
          })}
          <g transform={`translate(0,${7 * (cell + gap) + 12})`}>
            <text className="fill-current text-[9px] text-faint">less</text>
            {[0.15, 0.4, 0.65, 0.9].map((f, i) => (
              <rect
                key={f}
                x={26 + i * (cell + 3)}
                y={-8}
                width={cell}
                height={cell}
                rx={2}
                fill={color(max * f)}
              />
            ))}
            <text x={26 + 4 * (cell + 3) + 4} className="fill-current text-[9px] text-faint">
              more
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

/* ── Radial bar ─────────────────────────────────────────────────────────── */
function RadialBar({ slide, w, h, t }) {
  const labels = slide.data.labels;
  const values = slide.data.datasets[0].data.map((v) => Math.abs(v ?? 0));
  const size = Math.min(w, h - 6);
  const r = size / 2;
  const max = Math.max(...values) || 1;
  const band = (r * 0.66) / Math.max(labels.length, 1);
  const [hover, setHover] = useState(null);
  return (
    <div className="flex h-full items-center justify-center">
      <svg width={size} height={size} role="img" aria-label={slide.title}>
        <g transform={`translate(${r},${r})`}>
          {labels.map((label, i) => {
            const inner = r * 0.3 + i * band;
            const outer = inner + band * 0.74;
            const frac = values[i] / max;
            const track = d3arc()({
              innerRadius: inner,
              outerRadius: outer,
              startAngle: 0,
              endAngle: Math.PI * 1.6,
            });
            const path = d3arc()({
              innerRadius: inner,
              outerRadius: outer,
              startAngle: 0,
              endAngle: Math.PI * 1.6 * frac,
              cornerRadius: band * 0.35,
            });
            return (
              <g
                key={label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                transform="rotate(-100)"
              >
                <path d={track} fill="currentColor" className="text-line" fillOpacity={0.4} />
                <motion.path
                  d={path}
                  fill={t.colors[i % t.colors.length]}
                  fillOpacity={hover === null || hover === i ? 0.92 : 0.4}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring(i, t.reducedMotion)}
                >
                  <title>{`${label}: ${fmtNum(values[i])}`}</title>
                </motion.path>
              </g>
            );
          })}
          <text textAnchor="middle" y={-2} className="fill-current text-[10px] text-muted">
            {truncate(hover === null ? 'top value' : labels[hover], 16)}
          </text>
          <text textAnchor="middle" y={16} className="num fill-current text-[14px] text-ink">
            {fmtNum(hover === null ? max : values[hover])}
          </text>
        </g>
      </svg>
    </div>
  );
}
