# DataStage — chart studio

Upload a spreadsheet, CSV, JSON or Word report. DataStage profiles every column server-side,
decides which of its **37 chart types** the data actually supports, writes an insight sentence for
each, and plays the whole thing back as an animated presentation deck. Everything can be exported
as PPTX, PDF, XLSX or per-slide PNG.

```
datastage/
├── backend/        FastAPI + pandas ingestion, profiling, aggregation, exports
├── frontend/       Vite + React + Tailwind client (Chart.js, D3, react-three-fiber)
├── samples/        Generated sample files (xlsx / csv / docx)
└── README.md
```

## Run it

```bash
# backend (port 8000)
cd backend
pip install -r requirements.txt
python app.py

# frontend
cd frontend
npm install
npm run dev        # dev server, proxies /api to :8000
npm run build      # production bundle in frontend/dist
```

The built bundle points at `__PORT_8000__` (a placeholder rewritten by the hosting proxy at deploy
time) and falls back to `http://localhost:8000` in local dev, so the same `dist/` works both in the
sandbox preview and locally.

## Architecture

**Backend** (`backend/`)

| File | Responsibility |
| --- | --- |
| `app.py` | FastAPI routes, dataset registry, pickle cache in `backend/.cache` |
| `profiling.py` | File parsing (xlsx/xls/csv/tsv/json/docx), type inference, per-column stats |
| `charting.py` | 37 chart builders + `CHART_META`, LTTB downsampling, server-side aggregation |
| `planner.py` | Picks chart types the data supports, orders slides, writes insight text |
| `exporters.py` | PPTX (python-pptx), PDF + PNG (matplotlib), XLSX (openpyxl) |
| `make_samples.py` | Generates the three sample files |
| `selftest.py` | Renders every chart type on every sample and validates exports |

Parsing details:
- `.xlsx` / `.xls` — every sheet is loaded via openpyxl; ragged headers and blank leading rows are trimmed.
- `.csv` / `.tsv` — delimiter sniffing, encoding fallbacks, numeric/date coercion per column.
- `.json` — records, dict-of-lists and nested payloads are normalised with `pandas.json_normalize`.
- `.docx` — `python-docx` extracts every table as its own sheet, plus a "Narrative metrics" sheet mined from `key: value` sentences in the prose.

**API**

```
GET  /api/health                    GET  /api/chart-types      GET  /api/samples
POST /api/upload                    POST /api/sample/{file}
POST /api/analyze                   POST /api/aggregate        POST /api/describe
GET  /api/rows/{dataset_id}         GET  /api/progress/{job}   (SSE)
GET  /api/export/{dataset_id}?sheet=…&format=pptx|pdf|xlsx
GET  /api/export/png/{dataset_id}/{slide_id}?sheet=…
```

`/api/aggregate` expects `{dataset_id, sheet, spec: {type, x, y, series, …}}` — all aggregation
happens in pandas, so the browser preview and the exported file are computed from the same numbers.

**Frontend** (`frontend/src/`)

- `views/Landing.jsx` — 3D hero (Three.js shader point cloud reacting to the cursor), dropzone, sample cards
- `views/Studio.jsx` — column profile cards with editable roles, searchable/paginated row table
- `views/Presentation.jsx` — full-deck playback: keyboard nav, autoplay, overview grid, per-slide data table, exports
- `views/Builder.jsx` — pick any chart type and map fields manually
- `charts/` — `chartjs.jsx` (28 types), `d3charts.jsx` (sunburst, parallel coords, funnel, calendar, radial bar), `three3d.jsx` (3D scatter/surface/bars), `kpi.jsx`, `index.jsx` (lazy dispatcher + error boundary + table fallback)

## Chart types (37, all verified against real data)

**KPI** kpi ·
**Trend** line, area, multi_line, stacked_area, step_line, candlestick, calendar ·
**Comparison** bar, horizontal_bar, grouped_bar, stacked_bar, pareto, waterfall, funnel ·
**Composition** pie, donut, gauge, treemap, sunburst, radar, polar_area, radial_bar, sankey ·
**Relationship** scatter, regression, bubble, heatmap, parallel ·
**Distribution** histogram, kde, box, violin ·
**Text** wordcloud ·
**3D** scatter3d, surface3d, bar3d

Sample decks: `sales.xlsx` → 36 slides, `survey.csv` → 37 slides, `report.docx` → 23 slides.

## Production behaviour

- Loading skeletons and empty states on every panel; per-chart error boundary falls back to a data table
- Route- and chart-level code splitting (`react-three-fiber` and D3 load only when a 3D/D3 slide appears)
- LTTB downsampling for long series, point capping for 3D and scatter, 60 MB upload cap
- Dark and light themes, four accent palettes, responsive from 375px up, full keyboard navigation (←/→/space/P/G/Esc), `prefers-reduced-motion` respected

## Samples

- `samples/sales.xlsx` — Transactions (2,600 × 12), Targets (120), Stores (12)
- `samples/survey.csv` — 1,200 × 14 mixed Likert/categorical/numeric
- `samples/report.docx` — 4 tables + narrative metrics

Regenerate with `python backend/make_samples.py`.

## Known limitations

- `pyarrow` is unavailable in this sandbox, so the dataset cache uses pickle instead of Parquet.
- The sandboxed preview iframe blocks `localStorage`/cookies, so theme choice and datasets are not persisted across reloads; downloads are served with `Content-Disposition` from the backend.
- The D3 calendar heatmap renders at its natural size (centered, smaller than the slide) rather than stretching.
- On the Pareto chart the right-hand percentage axis label sits close to the data-table toggle icon.
- On 3D slides the third axis label can pass behind the geometry depending on orbit angle.
- Stacked-bar x-axis category labels truncate at 12 characters.
- The `react-three-fiber` chunk is ~880 KB (lazy-loaded, only fetched for 3D slides).
- `.xls` support depends on the environment providing `xlrd`; `.xlsx` is the tested path.
