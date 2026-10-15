"""The auto-presentation planner: pick the chart sequence a dataset actually supports."""
from __future__ import annotations

import numpy as np
import pandas as pd

from charting import CHART_META, ChartError, build
from profiling import BOOL, CAT, DATE, NUM, TEXT, _safe

# presentation order — a deck should open with headlines, then trend, then breakdowns
ORDER = [
    "kpi", "line", "area", "multi_line", "stacked_area", "step_line", "candlestick", "calendar",
    "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "pareto", "waterfall", "funnel",
    "pie", "donut", "gauge", "treemap", "sunburst", "radar", "polar_area", "radial_bar", "sankey",
    "scatter", "regression", "bubble", "heatmap", "parallel",
    "histogram", "kde", "box", "violin", "wordcloud",
    "scatter3d", "surface3d", "bar3d",
]


def _cols(types: dict[str, str], kind: str) -> list[str]:
    return [c for c, t in types.items() if t == kind]


def _score_cat(df: pd.DataFrame, col: str) -> float:
    n = df[col].nunique(dropna=True)
    if n < 2:
        return -1
    return 1.0 / (1 + abs(n - 7) / 7) * (1 - df[col].isna().mean())


def _score_num(df: pd.DataFrame, col: str) -> float:
    s = pd.to_numeric(df[col], errors="coerce")
    if s.notna().sum() < 3 or s.nunique() < 3:
        return -1
    return float(s.notna().mean()) + (0.2 if s.std() else 0)


def candidate_specs(df: pd.DataFrame, types: dict[str, str]) -> list[dict]:
    nums = sorted(_cols(types, NUM), key=lambda c: -_score_num(df, c))
    nums = [c for c in nums if _score_num(df, c) > 0]
    cats = sorted(_cols(types, CAT) + _cols(types, BOOL), key=lambda c: -_score_cat(df, c))
    cats = [c for c in cats if _score_cat(df, c) > 0]
    dates = _cols(types, DATE)
    texts = _cols(types, TEXT)
    specs: list[dict] = []

    def add(t, **kw):
        specs.append({"type": t, **kw})

    if nums:
        add("kpi", ys=nums[:4])

    # datetime + numeric
    if dates and nums:
        d, y = dates[0], nums[0]
        add("line", x=d, y=y, agg="sum")
        add("area", x=d, y=nums[1] if len(nums) > 1 else y, agg="sum")
        add("step_line", x=d, y=y, agg="mean")
        add("candlestick", x=d, y=y)
        add("calendar", x=d, y=y)
        if cats:
            add("multi_line", x=d, y=y, series=cats[0], agg="sum")
            add("stacked_area", x=d, y=y, series=cats[0], agg="sum")
    elif dates:
        add("calendar", x=dates[0])

    # categorical + numeric
    if cats:
        c0 = cats[0]
        y0 = nums[0] if nums else None
        add("bar", x=c0, y=y0, agg="sum" if y0 else "count")
        add("horizontal_bar", x=cats[1] if len(cats) > 1 else c0, y=y0, agg="sum" if y0 else "count")
        add("pareto", x=c0, y=y0, agg="sum" if y0 else "count")
        add("pie", x=c0, y=y0, agg="sum" if y0 else "count")
        add("donut", x=cats[1] if len(cats) > 1 else c0, y=y0, agg="sum" if y0 else "count")
        add("gauge", x=c0, y=y0, agg="sum" if y0 else "count")
        add("treemap", x=c0, y=y0, agg="sum" if y0 else "count")
        add("radar", x=c0, y=y0, agg="mean" if y0 else "count")
        add("polar_area", x=c0, y=y0, agg="sum" if y0 else "count")
        add("radial_bar", x=c0, y=y0, agg="sum" if y0 else "count")
        add("funnel", x=c0, y=y0, agg="sum" if y0 else "count")
        add("waterfall", x=c0, y=y0, agg="sum" if y0 else "count")
        if len(cats) > 1:
            add("grouped_bar", x=c0, y=y0, series=cats[1], agg="sum" if y0 else "count")
            add("stacked_bar", x=cats[1], y=y0, series=c0, agg="sum" if y0 else "count")
            add("sunburst", x=cats[1], series=c0, y=y0, agg="sum" if y0 else "count")
            add("sankey", x=c0, series=cats[1], value=y0)
            add("bar3d", x=c0, series=cats[1], y=y0, agg="sum" if y0 else "count")
        else:
            add("sunburst", x=c0, y=y0, agg="sum" if y0 else "count")
            add("bar3d", x=c0, y=y0, agg="sum" if y0 else "count")
        if nums:
            add("box", x=c0, y=nums[0])
            add("violin", x=c0, y=nums[0])

    # numeric pairs
    if len(nums) >= 2:
        x, y = _best_pair(df, nums)
        add("scatter", x=x, y=y)
        add("regression", x=x, y=y)
        add("bubble", x=x, y=y, size=nums[2] if len(nums) > 2 else None,
            series=cats[0] if cats else None)
    if len(nums) >= 3:
        a, b, c = nums[0], nums[1], nums[2]
        add("scatter3d", x=a, y=b, z=c, series=cats[0] if cats else None)
        add("surface3d", x=a, y=b, z=c)
    if len(nums) >= 2:
        add("heatmap", ys=nums[:10])
    if len(nums) >= 3:
        add("parallel", ys=nums[:6], series=cats[0] if cats else None)
    if nums:
        add("histogram", x=nums[0])
        add("kde", x=nums[0])
        if not cats:
            add("box", ys=nums[:6])
            add("violin", ys=nums[:6])
    if texts:
        add("wordcloud", x=texts[0])
    elif cats and df[cats[0]].astype(str).str.len().mean() > 6:
        add("wordcloud", x=cats[0])

    rank = {t: i for i, t in enumerate(ORDER)}
    specs.sort(key=lambda s: rank.get(s["type"], 99))
    return specs


def _best_pair(df: pd.DataFrame, nums: list[str]) -> tuple[str, str]:
    best, score = (nums[0], nums[1]), -1.0
    sub = pd.DataFrame({c: pd.to_numeric(df[c], errors="coerce") for c in nums[:8]})
    corr = sub.corr(numeric_only=True).abs().fillna(0)
    for i, a in enumerate(corr.columns):
        for b in corr.columns[i + 1:]:
            v = float(corr.loc[a, b])
            if v > score and v < 0.999:
                best, score = (a, b), v
    return best


# --------------------------------------------------------------------------- #
# insights
# --------------------------------------------------------------------------- #
def _fmt(v) -> str:
    if v is None:
        return "n/a"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    a = abs(v)
    if a >= 1e9:
        return f"{v/1e9:,.2f}B"
    if a >= 1e6:
        return f"{v/1e6:,.2f}M"
    if a >= 1e4:
        return f"{v:,.0f}"
    if a >= 1:
        return f"{v:,.2f}".rstrip("0").rstrip(".")
    return f"{v:.3g}"


def insight(spec: dict, data: dict) -> str:
    t = spec["type"]
    try:
        if t == "kpi":
            c = data["cards"][0]
            trend = "" if c.get("delta") is None else (
                f" and is trending {'up' if c['delta'] >= 0 else 'down'} {abs(c['delta']):.1f}%"
            )
            return f"{c['label']} totals {_fmt(c['value'])} with an average of {_fmt(c['mean'])}{trend}."
        if t in ("line", "area", "step_line"):
            d = data["datasets"][0]["data"]
            vals = [v for v in d if v is not None]
            if len(vals) >= 2:
                first, last = vals[0], vals[-1]
                chg = (last - first) / abs(first) * 100 if first else 0
                peak_i = int(np.argmax(vals))
                return (f"{data['datasets'][0]['label']} moved from {_fmt(first)} to {_fmt(last)} "
                        f"({chg:+.1f}%), peaking at {_fmt(max(vals))} around {data['labels'][peak_i]}.")
        if t in ("multi_line", "stacked_area"):
            totals = {ds["label"]: sum(v or 0 for v in ds["data"]) for ds in data["datasets"]}
            top = max(totals, key=totals.get)
            share = totals[top] / (sum(totals.values()) or 1) * 100
            return f"{top} leads the period with {_fmt(totals[top])} — {share:.0f}% of the combined total."
        if t in ("bar", "horizontal_bar", "pie", "donut", "gauge", "polar_area", "radial_bar", "radar"):
            labels, vals = data["labels"], [v or 0 for v in data["datasets"][0]["data"]]
            i = int(np.argmax(np.abs(vals)))
            total = sum(abs(v) for v in vals) or 1
            return (f"{labels[i]} is the largest at {_fmt(vals[i])} — {abs(vals[i])/total*100:.0f}% of the "
                    f"{len(labels)} shown, {_fmt(np.mean(np.abs(vals)))} average.")
        if t in ("grouped_bar", "stacked_bar", "bar3d"):
            if "datasets" in data:
                tot = {ds["label"]: sum(v or 0 for v in ds["data"]) for ds in data["datasets"]}
            else:
                tot = {c: sum(r[i] or 0 for r in data["values"]) for i, c in enumerate(data["cols"])}
            top = max(tot, key=tot.get)
            return f"{top} contributes the most overall at {_fmt(tot[top])} across {len(tot)} groups."
        if t == "pareto":
            cum = data["cumulative"]
            n80 = next((i + 1 for i, c in enumerate(cum) if c >= 80), len(cum))
            return f"The top {n80} of {len(cum)} categories account for ~80% of the total."
        if t == "waterfall":
            steps = data["steps"]
            pos = max((s for s in steps if not s.get("total")), key=lambda s: s["value"])
            return f"{pos['label']} adds the most ({_fmt(pos['value'])}); the running total ends at {_fmt(steps[-1]['end'])}."
        if t == "funnel":
            st = data["stages"]
            return (f"{st[0]['label']} holds {_fmt(st[0]['value'])}; by {st[-1]['label']} only "
                    f"{st[-1]['pct']:.0f}% remains.")
        if t in ("treemap", "sunburst"):
            nodes = data["nodes"]
            total = sum(n["value"] for n in nodes) or 1
            return f"{nodes[0]['label']} occupies {nodes[0]['value']/total*100:.0f}% of the total across {len(nodes)} branches."
        if t == "sankey":
            top = max(data["links"], key=lambda l: l["flow"])
            return f"The heaviest flow runs {top['from'].strip()} → {top['to']} at {_fmt(top['flow'])}."
        if t == "scatter":
            xs = [p["x"] for p in data["points"]]
            ys = [p["y"] for p in data["points"]]
            r = float(np.corrcoef(xs, ys)[0, 1]) if len(xs) > 2 else 0
            return (f"{len(xs):,} points; {data['xLabel']} and {data['yLabel']} show a "
                    f"{_strength(r)} {'positive' if r >= 0 else 'negative'} relationship (r = {r:.2f}).")
        if t == "regression":
            return (f"Fitted slope {_fmt(data['slope'])} per unit of {data['xLabel']}, explaining "
                    f"{data['r2']*100:.0f}% of the variance in {data['yLabel']} (r = {data['r']:.2f}).")
        if t == "bubble":
            biggest = max(data["points"], key=lambda p: p["r"])
            return (f"{len(data['points']):,} bubbles sized by {data.get('sizeLabel')}; the largest sits at "
                    f"{data['xLabel']} {_fmt(biggest['x'])}, {data['yLabel']} {_fmt(biggest['y'])}.")
        if t == "heatmap":
            labels, m = data["labels"], np.array(data["matrix"], dtype=float)
            np.fill_diagonal(m, 0)
            i, j = np.unravel_index(np.argmax(np.abs(m)), m.shape)
            return (f"Strongest pairing: {labels[i]} vs {labels[j]} at r = {m[i, j]:.2f} across "
                    f"{len(labels)} measures.")
        if t == "parallel":
            return (f"{len(data['rows']):,} records traced across {len(data['dims'])} normalised axes — "
                    "crossing lines mark trade-offs between measures.")
        if t == "candlestick":
            c = data["candles"]
            return (f"{len(c)} periods; last close {_fmt(c[-1]['c'])} against an opening {_fmt(c[0]['o'])} "
                    f"and a high of {_fmt(max(x['h'] for x in c))}.")
        if t == "histogram":
            vals = data["datasets"][0]["data"]
            i = int(np.argmax(vals))
            return f"Most common band is {data['labels'][i]} with {vals[i]:,} records of {len(data['labels'])} bins."
        if t == "kde":
            vals = data["datasets"][0]["data"]
            i = int(np.argmax(vals))
            return f"Density peaks near {data['labels'][i]} — the typical value for {data['xLabel']}."
        if t in ("box", "violin"):
            g = data["groups"]
            widest = max(g, key=lambda x: (x["q3"] or 0) - (x["q1"] or 0))
            outl = sum(len(x["outliers"]) for x in g)
            return (f"{g[0]['label']} has a median of {_fmt(g[0]['median'])}; {widest['label']} is the most "
                    f"dispersed. {outl} outlier(s) detected.")
        if t == "wordcloud":
            w = data["words"]
            return f"'{w[0]['word']}' appears {w[0]['count']} times, leading {len(w)} recurring terms in {data['column']}."
        if t == "calendar":
            days = data["days"]
            peak = max(days, key=lambda d: d["value"] or 0)
            active = sum(1 for d in days if d["value"])
            return f"{active} active days of {len(days)}; the busiest was {peak['date']} at {_fmt(peak['value'])}."
        if t == "scatter3d":
            return (f"{len(data['points']):,} points positioned by {', '.join(data['axes'])} — drag to orbit "
                    "and find the cluster structure.")
        if t == "surface3d":
            z = np.array(data["z"], dtype=float)
            return (f"{data['axes'][2]} peaks at {_fmt(z.max())} and bottoms at {_fmt(z.min())} across the "
                    f"{data['axes'][0]} × {data['axes'][1]} grid.")
    except Exception:  # noqa: BLE001 — insight text must never break a slide
        pass
    return CHART_META.get(t, ("Chart", ""))[1] + "."


def _strength(r: float) -> str:
    a = abs(r)
    return "strong" if a >= 0.7 else "moderate" if a >= 0.4 else "weak"


def title_for(spec: dict, sheet: str) -> str:
    t = spec["type"]
    name = CHART_META.get(t, (t, ""))[0]
    x, y, series = spec.get("x"), spec.get("y"), spec.get("series")
    if t == "kpi":
        return "Headline measures"
    if t == "heatmap":
        return "How the measures correlate"
    if t == "parallel":
        return "Multivariate profile"
    if t in ("scatter3d", "surface3d"):
        return f"{spec['z']} across {spec['x']} and {spec['y']}"
    if t == "bar3d":
        return f"{y or 'Records'} by {x}" + (f" and {series}" if series else "") + " in 3D"
    if t == "wordcloud":
        return f"Language in {x}"
    if t in ("histogram", "kde"):
        return f"Distribution of {x}"
    if t in ("box", "violin"):
        return f"Spread of {y or 'measures'}" + (f" by {x}" if y and x else "")
    if t == "sankey":
        return f"{x} → {series}"
    if t == "candlestick":
        return f"{y} ranges by period"
    if y and x:
        return f"{name}: {y} by {x}" if t not in ("line", "area", "step_line", "multi_line", "stacked_area") \
            else f"{y} over {x}" + (f" by {series}" if series else "")
    if x:
        return f"{name}: {x}"
    return name


def plan(df: pd.DataFrame, types: dict[str, str], sheet: str, limit: int = 40,
         progress=None) -> list[dict]:
    """Build every chart the data supports; drop the ones that cannot be built."""
    specs = candidate_specs(df, types)
    slides: list[dict] = []
    for i, spec in enumerate(specs):
        spec = {k: v for k, v in spec.items() if v is not None}
        try:
            data = build(df, types, dict(spec))
        except (ChartError, KeyError, ValueError, TypeError, ZeroDivisionError):
            continue
        except Exception:  # noqa: BLE001
            continue
        meta = CHART_META.get(spec["type"], (spec["type"], ""))
        slides.append({
            "id": f"{spec['type']}-{i}",
            "type": spec["type"],
            "name": meta[0],
            "title": title_for(spec, sheet),
            "rationale": meta[1],
            "insight": insight(spec, data),
            "spec": spec,
            "data": data,
        })
        if progress:
            progress(len(slides), len(specs))
        if len(slides) >= limit:
            break
    return slides


def dataset_summary(df: pd.DataFrame, types: dict[str, str]) -> dict:
    nums = [c for c, t in types.items() if t == NUM]
    return {
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "numeric": len(nums),
        "categorical": len([c for c, t in types.items() if t in (CAT, BOOL)]),
        "datetime": len([c for c, t in types.items() if t == DATE]),
        "completeness": _safe(1 - float(df.isna().to_numpy().mean())) if len(df) else 1,
    }
