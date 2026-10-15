/* Chart dispatcher: code-splits the heavy libraries and provides a data-table
   fallback plus error isolation for every chart. */
import { Component, Suspense, lazy, useMemo, useState } from 'react';
import { ChartSkeleton, EmptyState, ErrorState, Icon } from '../components/ui';
import { fmtNum, truncate } from '../lib/format';

const ChartJsView = lazy(() => import('./chartjs.jsx'));
const D3View = lazy(() => import('./d3charts.jsx'));
const ThreeView = lazy(() => import('./three3d.jsx'));
const KpiView = lazy(() => import('./kpi.jsx'));

const CHARTJS_TYPES = new Set([
  'bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'pareto', 'waterfall', 'candlestick',
  'line', 'multi_line', 'area', 'stacked_area', 'step_line', 'pie', 'donut', 'gauge', 'radar',
  'polar_area', 'scatter', 'bubble', 'regression', 'histogram', 'kde', 'box', 'violin',
  'heatmap', 'treemap', 'sankey', 'wordcloud',
]);
const D3_TYPES = new Set(['sunburst', 'parallel', 'funnel', 'calendar', 'radial_bar']);
const THREE_TYPES = new Set(['scatter3d', 'surface3d', 'bar3d']);

export const ALL_CHART_TYPES = [...CHARTJS_TYPES, ...D3_TYPES, ...THREE_TYPES, 'kpi'];

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          error={`This chart could not be drawn: ${this.state.error.message}`}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export default function ChartView({ slide, options = {}, showTable = false }) {
  const [table, setTable] = useState(false);
  const asTable = showTable || table;
  if (!slide?.data) {
    return <EmptyState title="No data for this chart" hint="Pick different columns in the builder." />;
  }
  const kind = CHARTJS_TYPES.has(slide.type)
    ? 'chartjs'
    : D3_TYPES.has(slide.type)
      ? 'd3'
      : THREE_TYPES.has(slide.type)
        ? 'three'
        : slide.type === 'kpi'
          ? 'kpi'
          : null;

  if (!kind) return <EmptyState title={`Unsupported chart type: ${slide.type}`} />;

  return (
    // Absolute fill: Chart.js sizes its canvas from this element, so it needs a
    // definite height rather than a percentage that resolves to auto.
    <div className="absolute inset-0">
      <Boundary resetKey={slide.id}>
        {asTable ? (
          <DataTable slide={slide} />
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            {kind === 'chartjs' && <ChartJsView slide={slide} options={options} />}
            {kind === 'd3' && <D3View slide={slide} options={options} />}
            {kind === 'three' && <ThreeView slide={slide} />}
            {kind === 'kpi' && <KpiView slide={slide} />}
          </Suspense>
        )}
      </Boundary>
      {!showTable && (
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          className="btn-ghost absolute right-0 top-0 z-10 rounded-md p-1 text-faint/60 hover:text-accent"
          aria-label={table ? 'Show chart' : 'Show underlying data table'}
          title={table ? 'Show chart' : 'Show data table'}
        >
          <Icon name={table ? 'grid' : 'table'} size={15} />
        </button>
      )}
    </div>
  );
}

/* Accessible fallback: every chart payload flattened into a real table. */
export function DataTable({ slide }) {
  const rows = useMemo(() => flatten(slide), [slide]);
  if (!rows.length) return <EmptyState title="No tabular view for this chart" />;
  const [head, ...body] = rows;
  return (
    <div className="scroll-y h-full w-full">
      <table className="w-full border-collapse text-left text-[12px]">
        <caption className="sr-only">{slide.title}</caption>
        <thead className="sticky top-0 bg-panel/95 backdrop-blur">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="border-b border-line px-3 py-2 label whitespace-nowrap">
                {truncate(h, 22)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, 300).map((r, i) => (
            <tr key={i} className="hover:bg-line/25">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`border-b border-line/50 px-3 py-1.5 ${
                    typeof cell === 'number' ? 'num text-ink' : 'text-muted'
                  }`}
                >
                  {typeof cell === 'number' ? fmtNum(cell, { compact: false }) : truncate(cell, 28)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > 300 && (
        <p className="px-3 py-2 text-[11px] text-faint">Showing first 300 of {body.length} rows.</p>
      )}
    </div>
  );
}

function flatten(slide) {
  const d = slide.data || {};
  if (d.labels && d.datasets) {
    return [
      ['label', ...d.datasets.map((s) => s.label), ...(d.cumulative ? ['cumulative %'] : [])],
      ...d.labels.map((l, i) => [
        l,
        ...d.datasets.map((s) => s.data[i] ?? null),
        ...(d.cumulative ? [d.cumulative[i]] : []),
      ]),
    ];
  }
  if (d.cards) {
    return [
      ['metric', 'value', 'mean', 'min', 'max', 'change %'],
      ...d.cards.map((c) => [c.label, c.value, c.mean, c.min, c.max, c.delta]),
    ];
  }
  if (d.points) {
    return [
      [d.xLabel || 'x', d.yLabel || 'y', ...(d.points[0]?.r !== undefined ? ['size'] : []), ...(d.axes ? ['z'] : [])],
      ...d.points.map((p) => [p.x, p.y, ...(p.r !== undefined ? [p.r] : []), ...(d.axes ? [p.z] : [])]),
    ];
  }
  if (d.matrix) {
    return [['', ...d.labels], ...d.matrix.map((row, i) => [d.labels[i], ...row])];
  }
  if (d.groups && Array.isArray(d.groups)) {
    return [
      ['group', 'min', 'q1', 'median', 'q3', 'max', 'mean', 'outliers'],
      ...d.groups.map((g) => [g.label, g.min, g.q1, g.median, g.q3, g.max, g.mean, g.outliers.length]),
    ];
  }
  if (d.nodes) {
    return [['label', 'value'], ...d.nodes.map((n) => [n.label, n.value])];
  }
  if (d.stages) return [['stage', 'value', '% of top'], ...d.stages.map((s) => [s.label, s.value, s.pct])];
  if (d.steps) return [['step', 'delta', 'running total'], ...d.steps.map((s) => [s.label, s.value, s.end])];
  if (d.links) return [['from', 'to', 'flow'], ...d.links.map((l) => [l.from.trim(), l.to, l.flow])];
  if (d.words) return [['term', 'count'], ...d.words.map((w) => [w.word, w.count])];
  if (d.days) return [['date', 'value'], ...d.days.map((x) => [x.date, x.value])];
  if (d.candles)
    return [['period', 'open', 'high', 'low', 'close'], ...d.candles.map((k) => [k.t, k.o, k.h, k.l, k.c])];
  if (d.rows && d.dims)
    return [d.dims.map((x) => x.name), ...d.rows.map((r) => r)];
  if (d.values && d.rows && d.cols)
    return [['', ...d.cols], ...d.rows.map((r, i) => [r, ...d.values[i]])];
  if (d.z) return [['row', ...d.z[0].map((_, i) => `c${i + 1}`)], ...d.z.map((r, i) => [`r${i + 1}`, ...r])];
  return [];
}
