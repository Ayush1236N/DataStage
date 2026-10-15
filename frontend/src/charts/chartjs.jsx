/* Chart.js 4 renderer — covers 27 of the 37 chart types.
   Lazily imported (see charts/index.jsx) so the library never blocks first paint. */
import { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import {
  ArcElement,
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  LogarithmicScale,
  DoughnutController,
  PieController,
  PointElement,
  PolarAreaController,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Title,
  Tooltip,
} from 'chart.js';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import { SankeyController, Flow } from 'chartjs-chart-sankey';
import { WordCloudController, WordElement } from 'chartjs-chart-wordcloud';
import {
  BoxPlotController,
  BoxAndWiskers,
  ViolinController,
  Violin,
} from '@sgratzl/chartjs-chart-boxplot';
import { useTheme } from '../lib/theme';
import { fmtNum, truncate } from '../lib/format';

ChartJS.register(
  ArcElement, BarController, BarElement, BubbleController, CategoryScale, DoughnutController,
  Filler, Legend, LineController, LineElement, LinearScale, LogarithmicScale, PieController,
  PointElement, PolarAreaController, RadarController, RadialLinearScale, ScatterController,
  Title, Tooltip, MatrixController, MatrixElement, TreemapController, TreemapElement,
  SankeyController, Flow, WordCloudController, WordElement, BoxPlotController, BoxAndWiskers,
  ViolinController, Violin,
);

export const CHARTJS_TYPES = new Set([
  'bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar', 'pareto', 'waterfall', 'candlestick',
  'line', 'multi_line', 'area', 'stacked_area', 'step_line',
  'pie', 'donut', 'gauge', 'radar', 'polar_area',
  'scatter', 'bubble', 'regression', 'histogram', 'kde',
  'box', 'violin', 'heatmap', 'treemap', 'sankey', 'wordcloud',
]);

const alpha = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export default function ChartJsView({ slide, theme, options: uiOptions = {} }) {
  const t = useTheme();
  const cfg = useMemo(
    () => build(slide, { ...t, ...theme }, uiOptions),
    [slide, t.palette, t.mode, theme, uiOptions],
  );
  if (!cfg) return null;
  return (
    <Chart
      key={`${slide.id}-${t.palette}-${t.mode}-${uiOptions.grid}-${uiOptions.legend}`}
      type={cfg.type}
      data={cfg.data}
      options={cfg.options}
      aria-label={slide.title}
      redraw={false}
    />
  );
}

function build(slide, t, ui) {
  const { type, data } = slide;
  const c = t.colors;
  const chrome = t.chrome;
  const showGrid = ui.grid !== false;
  const showLegend = ui.legend !== false;
  const dur = t.reducedMotion ? 0 : 900;

  const base = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: dur, easing: 'easeOutQuart' },
    animations: { colors: false },
    interaction: { mode: 'nearest', intersect: false },
    layout: { padding: { top: 6, right: 12, bottom: 2, left: 2 } },
    plugins: {
      legend: {
        display: false,
        position: 'bottom',
        labels: {
          color: chrome.text,
          boxWidth: 9,
          boxHeight: 9,
          usePointStyle: true,
          font: { family: 'Satoshi, system-ui', size: 11 },
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: t.mode === 'dark' ? 'rgba(10,15,19,0.94)' : 'rgba(255,255,255,0.97)',
        borderColor: chrome.grid,
        borderWidth: 1,
        titleColor: chrome.strong,
        bodyColor: chrome.text,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        titleFont: { family: 'Satoshi, system-ui', size: 12, weight: '600' },
        bodyFont: { family: '"IBM Plex Mono", monospace', size: 11 },
      },
    },
    scales: {
      x: {
        grid: { display: showGrid, color: chrome.grid, drawTicks: false },
        border: { color: chrome.grid },
        ticks: {
          color: chrome.text,
          maxRotation: 40,
          autoSkip: true,
          maxTicksLimit: 12,
          font: { family: '"IBM Plex Mono", monospace', size: 10 },
          callback(v) {
            const raw = this.getLabelForValue(v);
            return truncate(raw, 12);
          },
        },
      },
      y: {
        grid: { display: showGrid, color: chrome.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: chrome.text,
          font: { family: '"IBM Plex Mono", monospace', size: 10 },
          maxTicksLimit: 7,
          callback: (v) => fmtNum(v),
        },
      },
    },
  };

  const ds = data.datasets || [];
  const multi = ds.length > 1;
  const legend = { ...base.plugins.legend, display: showLegend && multi };
  const withLegend = { ...base, plugins: { ...base.plugins, legend } };

  switch (type) {
    case 'bar':
    case 'horizontal_bar': {
      const horizontal = type === 'horizontal_bar';
      return {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: ds[0].label,
              data: ds[0].data,
              backgroundColor: data.labels.map((_, i) => alpha(c[i % c.length], 0.82)),
              hoverBackgroundColor: data.labels.map((_, i) => c[i % c.length]),
              borderRadius: 5,
              borderSkipped: false,
              maxBarThickness: horizontal ? 26 : 54,
            },
          ],
        },
        options: {
          ...base,
          indexAxis: horizontal ? 'y' : 'x',
          scales: horizontal
            ? {
                x: { ...base.scales.y, ticks: { ...base.scales.y.ticks, maxTicksLimit: 6 } },
                y: {
                  ...base.scales.x,
                  ticks: {
                    ...base.scales.x.ticks,
                    maxRotation: 0,
                    maxTicksLimit: 16,
                    callback(v) {
                      return truncate(this.getLabelForValue(v), 26);
                    },
                  },
                },
              }
            : base.scales,
        },
      };
    }
    case 'grouped_bar':
    case 'stacked_bar': {
      const stacked = type === 'stacked_bar';
      return {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: ds.map((s, i) => ({
            label: s.label,
            data: s.data,
            backgroundColor: alpha(c[i % c.length], stacked ? 0.85 : 0.9),
            hoverBackgroundColor: c[i % c.length],
            borderRadius: stacked ? 2 : 4,
            borderSkipped: false,
            maxBarThickness: 46,
          })),
        },
        options: {
          ...withLegend,
          plugins: { ...withLegend.plugins, legend: { ...legend, display: showLegend } },
          scales: {
            x: { ...base.scales.x, stacked },
            y: { ...base.scales.y, stacked },
          },
        },
      };
    }
    case 'pareto':
      return {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [
            {
              type: 'bar',
              label: ds[0].label,
              data: ds[0].data,
              backgroundColor: data.labels.map((_, i) => alpha(c[0], 0.85 - i * 0.045)),
              borderRadius: 4,
              order: 2,
              maxBarThickness: 46,
            },
            {
              type: 'line',
              label: 'cumulative %',
              data: data.cumulative,
              yAxisID: 'y1',
              borderColor: c[3],
              backgroundColor: c[3],
              pointRadius: 2.5,
              borderWidth: 2,
              tension: 0.25,
              order: 1,
            },
          ],
        },
        options: {
          ...withLegend,
          plugins: { ...withLegend.plugins, legend: { ...legend, display: showLegend } },
          scales: {
            x: base.scales.x,
            y: base.scales.y,
            y1: {
              position: 'right',
              min: 0,
              max: 105,
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: c[3],
                font: { family: '"IBM Plex Mono", monospace', size: 10 },
                callback: (v) => `${v}%`,
                maxTicksLimit: 6,
              },
            },
          },
        },
      };
    case 'waterfall':
      return {
        type: 'bar',
        data: {
          labels: data.steps.map((s) => s.label),
          datasets: [
            {
              label: 'contribution',
              data: data.steps.map((s) => [s.start, s.end]),
              backgroundColor: data.steps.map((s) =>
                s.total ? alpha(c[1], 0.9) : s.value >= 0 ? alpha(c[0], 0.85) : alpha('#F2718C', 0.85),
              ),
              borderRadius: 3,
              maxBarThickness: 44,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: (ctx) => {
                  const s = data.steps[ctx.dataIndex];
                  return `${s.label}: ${fmtNum(s.value)} (to ${fmtNum(s.end)})`;
                },
              },
            },
          },
        },
      };
    case 'candlestick':
      return {
        type: 'bar',
        data: {
          labels: data.candles.map((k) => k.t),
          datasets: [
            {
              label: 'range',
              data: data.candles.map((k) => [k.l, k.h]),
              backgroundColor: data.candles.map((k) => alpha(k.c >= k.o ? c[0] : '#F2718C', 0.28)),
              maxBarThickness: 3,
              borderRadius: 2,
            },
            {
              label: 'body',
              data: data.candles.map((k) => [Math.min(k.o, k.c), Math.max(k.o, k.c)]),
              backgroundColor: data.candles.map((k) => alpha(k.c >= k.o ? c[0] : '#F2718C', 0.92)),
              maxBarThickness: 16,
              borderRadius: 2,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: (ctx) => {
                  const k = data.candles[ctx.dataIndex];
                  return `O ${fmtNum(k.o)} · H ${fmtNum(k.h)} · L ${fmtNum(k.l)} · C ${fmtNum(k.c)}`;
                },
              },
            },
          },
        },
      };
    case 'line':
    case 'multi_line':
    case 'area':
    case 'stacked_area':
    case 'step_line': {
      const stacked = type === 'stacked_area';
      const fill = type === 'area' || stacked;
      return {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: ds.map((s, i) => ({
            label: s.label,
            data: s.data,
            borderColor: c[i % c.length],
            backgroundColor: fill ? gradient(c[i % c.length]) : alpha(c[i % c.length], 0.15),
            fill: fill ? (stacked ? (i === 0 ? 'origin' : '-1') : 'origin') : false,
            tension: type === 'step_line' ? 0 : 0.34,
            stepped: type === 'step_line' ? 'after' : false,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: c[i % c.length],
            spanGaps: true,
          })),
        },
        options: {
          ...withLegend,
          plugins: { ...withLegend.plugins, legend: { ...legend, display: showLegend && multi } },
          scales: { x: base.scales.x, y: { ...base.scales.y, stacked } },
        },
      };
    }
    case 'pie':
    case 'donut':
    case 'gauge': {
      const gauge = type === 'gauge';
      return {
        type: type === 'pie' ? 'pie' : 'doughnut',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: ds[0].label,
              data: ds[0].data.map((v) => Math.abs(v ?? 0)),
              backgroundColor: data.labels.map((_, i) => alpha(c[i % c.length], 0.88)),
              hoverBackgroundColor: data.labels.map((_, i) => c[i % c.length]),
              borderColor: chrome.surface,
              borderWidth: 2,
              hoverOffset: 8,
            },
          ],
        },
        options: {
          ...base,
          cutout: type === 'pie' ? 0 : gauge ? '72%' : '62%',
          rotation: gauge ? -90 : 0,
          circumference: gauge ? 180 : 360,
          scales: {},
          plugins: {
            ...base.plugins,
            legend: {
              ...base.plugins.legend,
              display: showLegend,
              position: 'right',
              labels: { ...base.plugins.legend.labels, padding: 10 },
            },
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: (ctx) => {
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                  return ` ${ctx.label}: ${fmtNum(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`;
                },
              },
            },
          },
        },
      };
    }
    case 'radar':
      return {
        type: 'radar',
        data: {
          labels: data.labels,
          datasets: ds.map((s, i) => ({
            label: s.label,
            data: s.data,
            borderColor: c[i % c.length],
            backgroundColor: alpha(c[i % c.length], 0.22),
            pointBackgroundColor: c[i % c.length],
            pointRadius: 2.5,
            borderWidth: 2,
          })),
        },
        options: {
          ...base,
          scales: {
            r: {
              angleLines: { color: chrome.grid },
              grid: { color: chrome.grid, circular: true },
              pointLabels: {
                color: chrome.text,
                font: { family: 'Satoshi, system-ui', size: 10 },
                callback: (l) => truncate(l, 14),
              },
              ticks: {
                display: false,
                backdropColor: 'transparent',
              },
            },
          },
          plugins: { ...base.plugins, legend: { ...legend, display: showLegend && multi } },
        },
      };
    case 'polar_area':
      return {
        type: 'polarArea',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: ds[0].label,
              data: ds[0].data.map((v) => Math.abs(v ?? 0)),
              backgroundColor: data.labels.map((_, i) => alpha(c[i % c.length], 0.72)),
              borderColor: chrome.surface,
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          ...base,
          scales: {
            r: {
              grid: { color: chrome.grid, circular: true },
              angleLines: { color: chrome.grid },
              ticks: { display: false, backdropColor: 'transparent' },
              pointLabels: { display: false },
            },
          },
          plugins: {
            ...base.plugins,
            legend: { ...base.plugins.legend, display: showLegend, position: 'right' },
          },
        },
      };
    case 'scatter':
    case 'regression': {
      const sets = [
        {
          type: 'scatter',
          label: `${data.yLabel} vs ${data.xLabel}`,
          data: data.points,
          backgroundColor: alpha(c[0], 0.5),
          borderColor: alpha(c[0], 0.8),
          pointRadius: 3,
          pointHoverRadius: 6,
        },
      ];
      if (type === 'regression') {
        sets.push({
          type: 'line',
          label: `fit · r² ${(data.r2 ?? 0).toFixed(2)}`,
          data: data.fit,
          borderColor: c[3],
          borderWidth: 2.4,
          pointRadius: 0,
          fill: false,
        });
      }
      return {
        type: 'scatter',
        data: { datasets: sets },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { ...base.plugins.legend, display: showLegend && type === 'regression' },
          },
          scales: {
            x: {
              ...base.scales.x,
              type: 'linear',
              title: axisTitle(data.xLabel, chrome),
              ticks: { ...base.scales.y.ticks, maxTicksLimit: 8 },
            },
            y: { ...base.scales.y, title: axisTitle(data.yLabel, chrome) },
          },
        },
      };
    }
    case 'bubble':
      return {
        type: 'bubble',
        data: {
          datasets: [
            {
              label: `${data.sizeLabel ?? 'size'}`,
              data: data.points,
              backgroundColor: alpha(c[2], 0.35),
              borderColor: alpha(c[2], 0.9),
              borderWidth: 1,
              hoverBackgroundColor: alpha(c[2], 0.6),
            },
          ],
        },
        options: {
          ...base,
          scales: {
            x: {
              ...base.scales.x,
              type: 'linear',
              title: axisTitle(data.xLabel, chrome),
              ticks: { ...base.scales.y.ticks, maxTicksLimit: 8 },
            },
            y: { ...base.scales.y, title: axisTitle(data.yLabel, chrome) },
          },
        },
      };
    case 'histogram':
      return {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [
            {
              type: 'bar',
              label: ds[0].label,
              data: ds[0].data,
              backgroundColor: alpha(c[0], 0.78),
              hoverBackgroundColor: c[0],
              borderRadius: 3,
              categoryPercentage: 0.98,
              barPercentage: 0.96,
              order: 2,
            },
            ...(data.kde
              ? [
                  {
                    type: 'line',
                    label: 'density',
                    data: data.kde.map((p, i) => ({
                      x: (i / (data.kde.length - 1)) * (data.labels.length - 1),
                      y: p.y,
                    })),
                    parsing: false,
                    borderColor: c[3],
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4,
                    order: 1,
                  },
                ]
              : []),
          ],
        },
        options: {
          ...withLegend,
          plugins: { ...withLegend.plugins, legend: { ...legend, display: showLegend } },
          scales: {
            x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 8 } },
            y: base.scales.y,
          },
        },
      };
    case 'kde':
      return {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: ds[0].label,
              data: ds[0].data,
              borderColor: c[0],
              backgroundColor: gradient(c[0]),
              fill: 'origin',
              tension: 0.4,
              borderWidth: 2,
              pointRadius: 0,
            },
          ],
        },
        options: {
          ...base,
          scales: {
            x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 8 } },
            y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: (v) => fmtNum(v) } },
          },
        },
      };
    case 'box':
    case 'violin':
      return {
        type: type === 'box' ? 'boxplot' : 'violin',
        data: {
          labels: data.groups.map((g) => truncate(g.label, 14)),
          datasets: [
            {
              label: 'distribution',
              data: data.groups.map((g) => g.values.filter((v) => v !== null)),
              backgroundColor: data.groups.map((_, i) => alpha(c[i % c.length], 0.45)),
              borderColor: data.groups.map((_, i) => c[i % c.length]),
              borderWidth: 1.4,
              outlierBackgroundColor: alpha('#F2718C', 0.7),
              outlierRadius: 2.5,
              itemRadius: 0,
              medianColor: chrome.strong,
              padding: 12,
            },
          ],
        },
        options: {
          ...base,
          scales: {
            x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxRotation: 30 } },
            y: base.scales.y,
          },
        },
      };
    case 'heatmap': {
      const n = data.labels.length;
      const cells = [];
      data.matrix.forEach((row, y) =>
        row.forEach((v, x) => cells.push({ x: data.labels[x], y: data.labels[y], v })),
      );
      return {
        type: 'matrix',
        data: {
          datasets: [
            {
              label: 'correlation',
              data: cells,
              backgroundColor: (ctx) => diverging(ctx.raw?.v ?? 0, c),
              borderColor: chrome.surface,
              borderWidth: 1,
              width: ({ chart }) => (chart.chartArea || {}).width / n - 2,
              height: ({ chart }) => (chart.chartArea || {}).height / n - 2,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                title: () => '',
                label: (ctx) => `${ctx.raw.y} × ${ctx.raw.x}: r = ${ctx.raw.v.toFixed(2)}`,
              },
            },
          },
          scales: {
            x: {
              type: 'category',
              labels: data.labels,
              offset: true,
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: chrome.text,
                maxRotation: 55,
                minRotation: 30,
                autoSkip: false,
                font: { family: '"IBM Plex Mono", monospace', size: 9 },
                callback: (v, i) => truncate(data.labels[i], 11),
              },
            },
            y: {
              type: 'category',
              labels: [...data.labels].reverse(),
              offset: true,
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: chrome.text,
                autoSkip: false,
                font: { family: '"IBM Plex Mono", monospace', size: 9 },
                callback: (v, i) => truncate([...data.labels].reverse()[i], 11),
              },
            },
          },
        },
      };
    }
    case 'treemap':
      return {
        type: 'treemap',
        data: {
          datasets: [
            {
              tree: data.nodes,
              key: 'value',
              labels: {
                display: true,
                align: 'left',
                position: 'top',
                color: t.mode === 'dark' ? '#08100d' : '#0b1014',
                font: { family: 'Satoshi, system-ui', size: 11, weight: '600' },
                formatter: (ctx) => [truncate(ctx.raw?._data?.label, 18), fmtNum(ctx.raw?.v)],
              },
              backgroundColor: (ctx) =>
                ctx.type === 'data' ? alpha(c[ctx.dataIndex % c.length], 0.88) : 'transparent',
              borderColor: chrome.surface,
              borderWidth: 2,
              spacing: 1,
            },
          ],
        },
        options: {
          ...base,
          scales: {},
          plugins: {
            ...base.plugins,
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                title: (items) => items[0]?.raw?._data?.label ?? '',
                label: (ctx) => `${fmtNum(ctx.raw?.v)}`,
              },
            },
          },
        },
      };
    case 'sankey':
      return {
        type: 'sankey',
        data: {
          datasets: [
            {
              label: 'flow',
              data: data.links,
              colorFrom: (ctx) => alpha(c[(ctx.dataIndex ?? 0) % c.length], 0.72),
              colorTo: (ctx) => alpha(c[((ctx.dataIndex ?? 0) + 3) % c.length], 0.42),
              colorMode: 'gradient',
              borderWidth: 0,
              nodeWidth: 10,
              padding: 12,
              labels: undefined,
              color: chrome.text,
              font: { family: 'Satoshi, system-ui', size: 11 },
            },
          ],
        },
        options: { ...base, scales: {} },
      };
    case 'wordcloud':
      return {
        type: 'wordCloud',
        data: {
          labels: data.words.map((w) => w.word),
          datasets: [
            {
              label: 'frequency',
              data: data.words.map((w) => w.count),
              color: data.words.map((_, i) => c[i % c.length]),
              family: 'Satoshi, system-ui',
              size: undefined,
              padding: 3,
              fit: true,
            },
          ],
        },
        options: {
          ...base,
          scales: {},
          plugins: {
            ...base.plugins,
            legend: { display: false },
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: { label: (ctx) => `${ctx.label}: ${data.words[ctx.dataIndex].count}` },
            },
          },
        },
      };
    default:
      return null;
  }
}

function axisTitle(text, chrome) {
  return {
    display: !!text,
    text: truncate(text, 30),
    color: chrome.text,
    font: { family: 'Satoshi, system-ui', size: 11 },
  };
}

function gradient(hex) {
  return (ctx) => {
    const { chart } = ctx;
    const { ctx: canvas, chartArea } = chart;
    if (!chartArea) return alpha(hex, 0.2);
    const g = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, alpha(hex, 0.42));
    g.addColorStop(1, alpha(hex, 0.02));
    return g;
  };
}

function diverging(v, c) {
  const hex = v >= 0 ? c[0] : '#F2718C';
  return alpha(hex, 0.14 + Math.min(Math.abs(v), 1) * 0.78);
}
