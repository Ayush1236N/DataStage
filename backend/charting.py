"""Chart data builders + the auto-presentation planner.

Every chart type in the spec has a builder here. Builders return small, JSON-safe
payloads (already aggregated / downsampled) so the browser never crunches raw files.
"""
from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np
import pandas as pd

from profiling import BOOL, CAT, DATE, NUM, TEXT, _safe

MAX_CATEGORIES = 14
MAX_POINTS = 4000
AGGS = ("sum", "mean", "count", "median", "min", "max")


class ChartError(Exception):
    pass


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce")


def _agg_series(g, agg: str) -> pd.Series:
    if agg == "count":
        return g.count()
    return getattr(g, agg if agg in AGGS else "sum")()


def _cat_labels(df: pd.DataFrame, col: str, limit: int = MAX_CATEGORIES) -> pd.Series:
    s = df[col].astype("object").where(df[col].notna(), "—").astype(str)
    top = s.value_counts().head(limit).index
    return s.where(s.isin(top), "Other")


def groupby_agg(df, cat: str, val: str | None, agg: str = "sum", limit=MAX_CATEGORIES, sort=True):
    keys = _cat_labels(df, cat, limit)
    if val is None or agg == "count":
        out = keys.value_counts()
        out = out if sort else out.sort_index()
    else:
        frame = pd.DataFrame({"k": keys, "v": _num(df, val)})
        out = _agg_series(frame.groupby("k", dropna=False)["v"], agg).dropna()
        out = out.sort_values(ascending=False) if sort else out.sort_index()
    out = out.head(limit)
    return [str(i) for i in out.index], [_safe(v) for v in out.to_numpy()]


def lttb(x: np.ndarray, y: np.ndarray, threshold: int = 1500):
    """Largest-Triangle-Three-Buckets downsampling."""
    n = len(x)
    if n <= threshold or threshold < 3:
        return x, y
    every = (n - 2) / (threshold - 2)
    idx = [0]
    a = 0
    for i in range(threshold - 2):
        lo = int(math.floor((i + 1) * every) + 1)
        hi = min(int(math.floor((i + 2) * every) + 1), n)
        avg_x = x[lo:hi].mean() if hi > lo else x[-1]
        avg_y = y[lo:hi].mean() if hi > lo else y[-1]
        rlo = int(math.floor(i * every) + 1)
        rhi = min(int(math.floor((i + 1) * every) + 1), n)
        if rhi <= rlo:
            continue
        ax, ay = x[a], y[a]
        areas = np.abs((ax - avg_x) * (y[rlo:rhi] - ay) - (ax - x[rlo:rhi]) * (avg_y - ay))
        a = rlo + int(np.argmax(areas))
        idx.append(a)
    idx.append(n - 1)
    return x[idx], y[idx]


def _time_series(df, dcol: str, vcol: str | None, agg="sum", freq: str | None = None):
    d = pd.to_datetime(df[dcol], errors="coerce")
    v = _num(df, vcol) if vcol else pd.Series(np.ones(len(df)), index=df.index)
    frame = pd.DataFrame({"d": d, "v": v}).dropna(subset=["d"]).sort_values("d")
    if frame.empty:
        raise ChartError("No valid dates in that column.")
    span = (frame["d"].max() - frame["d"].min()).days or 1
    freq = freq or ("D" if span <= 120 else "W" if span <= 900 else "ME" if span <= 4000 else "YE")
    resampled = frame.set_index("d")["v"].resample(freq)
    grouped = _agg_series(resampled, agg).dropna()
    # drop leading/trailing partial buckets so the trend does not fake a cliff
    if len(grouped) > 4 and agg in ("sum", "count"):
        counts = resampled.count()
        counts = counts.reindex(grouped.index).fillna(0)
        typical = float(counts.median()) or 1.0
        if counts.iloc[0] < 0.5 * typical:
            grouped = grouped.iloc[1:]
            counts = counts.iloc[1:]
        if len(grouped) > 2 and counts.iloc[-1] < 0.5 * typical:
            grouped = grouped.iloc[:-1]
    if len(grouped) > 400:
        xs = grouped.index.astype("int64").to_numpy(dtype="float64")
        gx, gy = lttb(xs, grouped.to_numpy(dtype="float64"), 400)
        labels = [pd.Timestamp(int(t)).date().isoformat() for t in gx]
        return labels, [_safe(v) for v in gy]
    labels = [pd.Timestamp(t).date().isoformat() for t in grouped.index]
    return labels, [_safe(v) for v in grouped.to_numpy()]


def _pair(df, x: str, y: str, cap=MAX_POINTS):
    frame = pd.DataFrame({"x": _num(df, x), "y": _num(df, y)}).dropna()
    if frame.empty:
        raise ChartError("No overlapping numeric values for those two columns.")
    if len(frame) > cap:
        frame = frame.sample(cap, random_state=7).sort_values("x")
    return frame


def _stats(v: np.ndarray) -> dict:
    q1, med, q3 = np.percentile(v, [25, 50, 75])
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inl = v[(v >= lo) & (v <= hi)]
    return {
        "min": _safe(inl.min() if len(inl) else v.min()),
        "q1": _safe(q1), "median": _safe(med), "q3": _safe(q3),
        "max": _safe(inl.max() if len(inl) else v.max()),
        "mean": _safe(v.mean()),
        "outliers": [_safe(o) for o in np.unique(v[(v < lo) | (v > hi)])[:24]],
    }


def _kde(v: np.ndarray, points: int = 48):
    v = v.astype("float64")
    if len(v) < 2 or np.allclose(v.std(), 0):
        return [_safe(v.mean())] * points, [1.0] * points
    bw = 1.06 * v.std() * len(v) ** (-1 / 5) or 1e-6
    grid = np.linspace(v.min() - bw, v.max() + bw, points)
    dens = np.exp(-0.5 * ((grid[:, None] - v[None, :]) / bw) ** 2).sum(axis=1) / (len(v) * bw * math.sqrt(2 * math.pi))
    return [_safe(g) for g in grid], [_safe(d) for d in dens]


# --------------------------------------------------------------------------- #
# builders — each returns the `data` block the frontend renderer consumes
# --------------------------------------------------------------------------- #
def b_categorical(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"))
    return {"labels": labels, "datasets": [{"label": _series_label(s), "data": values}]}


def b_categorical_sorted_index(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"), sort=False)
    return {"labels": labels, "datasets": [{"label": _series_label(s), "data": values}]}


def b_grouped(df, types, s):
    ycols = s.get("ys") or ([s["y"]] if s.get("y") else [])
    if s.get("series"):
        keys = _cat_labels(df, s["x"])
        grp = _cat_labels(df, s["series"], 8)
        val = _num(df, s["y"]) if s.get("y") else pd.Series(1.0, index=df.index)
        piv = pd.DataFrame({"k": keys, "g": grp, "v": val}).pivot_table(
            index="k", columns="g", values="v", aggfunc=s.get("agg", "sum"), fill_value=0
        )
        piv = piv.loc[piv.sum(axis=1).sort_values(ascending=False).index[:MAX_CATEGORIES]]
        return {
            "labels": [str(i) for i in piv.index],
            "datasets": [{"label": str(c), "data": [_safe(v) for v in piv[c].to_numpy()]} for c in piv.columns],
        }
    keys = _cat_labels(df, s["x"])
    out = {"labels": None, "datasets": []}
    for col in ycols[:6]:
        agg = _agg_series(pd.DataFrame({"k": keys, "v": _num(df, col)}).groupby("k")["v"], s.get("agg", "sum"))
        out["labels"] = out["labels"] or [str(i) for i in out.get("_idx", out["labels"] or [])]
        out["datasets"].append({"label": col, "data": [_safe(v) for v in agg.to_numpy()], "_idx": list(agg.index)})
    if out["datasets"]:
        out["labels"] = [str(i) for i in out["datasets"][0].pop("_idx")]
        for d in out["datasets"]:
            d.pop("_idx", None)
    return out


def b_timeseries(df, types, s):
    ycols = s.get("ys") or ([s["y"]] if s.get("y") else [None])
    labels = None
    datasets = []
    for col in ycols[:5]:
        lab, vals = _time_series(df, s["x"], col, s.get("agg", "sum"))
        labels = labels or lab
        if lab != labels:
            vals = pd.Series(vals, index=lab).reindex(labels).ffill().fillna(0).tolist()
        datasets.append({"label": col or "records", "data": [_safe(v) for v in vals]})
    return {"labels": labels, "datasets": datasets}


def b_timeseries_series(df, types, s):
    if not s.get("series"):
        return b_timeseries(df, types, s)
    d = pd.to_datetime(df[s["x"]], errors="coerce")
    grp = _cat_labels(df, s["series"], 6)
    v = _num(df, s["y"]) if s.get("y") else pd.Series(1.0, index=df.index)
    frame = pd.DataFrame({"d": d, "g": grp, "v": v}).dropna(subset=["d"])
    span = (frame["d"].max() - frame["d"].min()).days or 1
    freq = "D" if span <= 120 else "W" if span <= 900 else "ME"
    piv = frame.pivot_table(index=pd.Grouper(key="d", freq=freq), columns="g", values="v",
                            aggfunc=s.get("agg", "sum"), fill_value=0)
    if len(piv) > 200:
        piv = piv.iloc[:: max(1, len(piv) // 200)]
    return {
        "labels": [pd.Timestamp(i).date().isoformat() for i in piv.index],
        "datasets": [{"label": str(c), "data": [_safe(v) for v in piv[c].to_numpy()]} for c in piv.columns],
    }


def b_scatter(df, types, s):
    frame = _pair(df, s["x"], s["y"])
    return {"points": [{"x": _safe(a), "y": _safe(b)} for a, b in frame.to_numpy()],
            "xLabel": s["x"], "yLabel": s["y"]}


def b_bubble(df, types, s):
    cols = [s["x"], s["y"]] + ([s["size"]] if s.get("size") else [])
    frame = pd.DataFrame({c: _num(df, c) for c in cols}).dropna()
    if frame.empty:
        raise ChartError("Not enough numeric rows for a bubble chart.")
    if len(frame) > 600:
        frame = frame.sample(600, random_state=7)
    r = frame[cols[2]] if len(cols) > 2 else frame[s["y"]]
    lo, hi = float(r.min()), float(r.max())
    scale = (lambda v: 6 + 22 * (v - lo) / (hi - lo)) if hi > lo else (lambda v: 12)
    return {"points": [{"x": _safe(row[s["x"]]), "y": _safe(row[s["y"]]), "r": _safe(scale(row[cols[-1]]))}
                       for _, row in frame.iterrows()],
            "xLabel": s["x"], "yLabel": s["y"], "sizeLabel": cols[-1]}


def b_regression(df, types, s):
    frame = _pair(df, s["x"], s["y"])
    x, y = frame["x"].to_numpy(float), frame["y"].to_numpy(float)
    slope, intercept = (np.polyfit(x, y, 1) if len(x) > 1 and x.std() else (0.0, float(y.mean())))
    r = float(np.corrcoef(x, y)[0, 1]) if len(x) > 2 and x.std() and y.std() else 0.0
    xs = np.linspace(x.min(), x.max(), 2)
    return {
        "points": [{"x": _safe(a), "y": _safe(b)} for a, b in zip(x, y)],
        "fit": [{"x": _safe(a), "y": _safe(slope * a + intercept)} for a in xs],
        "r2": _safe(r * r), "r": _safe(r), "slope": _safe(slope), "intercept": _safe(intercept),
        "xLabel": s["x"], "yLabel": s["y"],
    }


def b_histogram(df, types, s):
    v = _num(df, s["x"]).dropna().to_numpy(float)
    if v.size == 0:
        raise ChartError("No numeric values to bin.")
    bins = int(s.get("bins") or min(30, max(6, int(math.sqrt(v.size)))))
    counts, edges = np.histogram(v, bins=bins)
    labels = [f"{_fmt(edges[i])} – {_fmt(edges[i+1])}" for i in range(len(counts))]
    gx, gy = _kde(v)
    peak = max(gy) or 1
    return {"labels": labels, "datasets": [{"label": f"{s['x']} frequency", "data": [int(c) for c in counts]}],
            "kde": [{"x": a, "y": _safe(b / peak * max(counts))} for a, b in zip(gx, gy)],
            "edges": [_safe(e) for e in edges], "xLabel": s["x"]}


def b_kde(df, types, s):
    v = _num(df, s["x"]).dropna().to_numpy(float)
    gx, gy = _kde(v, 72)
    return {"labels": [_fmt(g) for g in gx],
            "datasets": [{"label": f"{s['x']} density", "data": gy}], "xLabel": s["x"]}


def b_box(df, types, s):
    groups: list[dict] = []
    if s.get("x") and types.get(s["x"]) in (CAT, BOOL) and s.get("y"):
        keys = _cat_labels(df, s["x"], 10)
        frame = pd.DataFrame({"k": keys, "v": _num(df, s["y"])}).dropna()
        for k, sub in frame.groupby("k"):
            if len(sub) >= 3:
                arr = sub["v"].to_numpy(float)
                groups.append({"label": str(k), **_stats(arr),
                               "values": [_safe(x) for x in (arr if len(arr) <= 400 else np.random.default_rng(3).choice(arr, 400))],
                               "kde": _kde_pair(arr)})
    else:
        for col in (s.get("ys") or [s.get("y") or s.get("x")])[:8]:
            arr = _num(df, col).dropna().to_numpy(float)
            if arr.size >= 3:
                groups.append({"label": col, **_stats(arr),
                               "values": [_safe(x) for x in (arr if len(arr) <= 400 else np.random.default_rng(3).choice(arr, 400))],
                               "kde": _kde_pair(arr)})
    if not groups:
        raise ChartError("Not enough numeric rows for a distribution chart.")
    return {"groups": groups}


def _kde_pair(arr):
    gx, gy = _kde(arr, 40)
    peak = max(gy) or 1
    return [{"x": a, "y": _safe(b / peak)} for a, b in zip(gx, gy)]


def b_heatmap(df, types, s):
    cols = s.get("ys") or [c for c, t in types.items() if t == NUM]
    cols = cols[:12]
    if len(cols) < 2:
        raise ChartError("Need at least two numeric columns for a correlation heatmap.")
    corr = pd.DataFrame({c: _num(df, c) for c in cols}).corr(numeric_only=True).fillna(0)
    return {"labels": [str(c) for c in corr.columns],
            "matrix": [[_safe(v) for v in row] for row in corr.to_numpy()]}


def b_treemap(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"), limit=18)
    return {"nodes": [{"label": l, "value": abs(v or 0)} for l, v in zip(labels, values)]}


def b_sunburst(df, types, s):
    outer = s.get("series") or s["x"]
    inner = s["x"] if outer != s["x"] else None
    val = s.get("y")
    a = _cat_labels(df, outer, 8)
    v = _num(df, val) if val else pd.Series(1.0, index=df.index)
    if inner:
        b = _cat_labels(df, inner, 6)
        frame = pd.DataFrame({"a": a, "b": b, "v": v}).dropna(subset=["v"])
        grp = frame.groupby(["a", "b"])["v"].agg(s.get("agg", "sum"))
        children: dict[str, list] = {}
        for (ka, kb), value in grp.items():
            children.setdefault(str(ka), []).append({"label": str(kb), "value": abs(_safe(value) or 0)})
        nodes = [{"label": k, "children": c, "value": sum(x["value"] for x in c)} for k, c in children.items()]
    else:
        labels, values = groupby_agg(df, outer, val, s.get("agg", "sum"), limit=10)
        nodes = [{"label": l, "value": abs(v or 0), "children": []} for l, v in zip(labels, values)]
    nodes.sort(key=lambda n: -n["value"])
    return {"nodes": nodes}


def b_funnel(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"), limit=8)
    pairs = sorted(zip(labels, [abs(v or 0) for v in values]), key=lambda p: -p[1])
    top = pairs[0][1] or 1
    return {"stages": [{"label": l, "value": v, "pct": _safe(v / top * 100)} for l, v in pairs]}


def b_waterfall(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"), limit=10, sort=False)
    steps, run = [], 0.0
    for l, v in zip(labels, values):
        v = float(v or 0)
        steps.append({"label": l, "start": _safe(run), "end": _safe(run + v), "value": _safe(v)})
        run += v
    steps.append({"label": "Total", "start": 0, "end": _safe(run), "value": _safe(run), "total": True})
    return {"steps": steps}


def b_sankey(df, types, s):
    src, dst = s["x"], s.get("series") or s.get("y")
    if not dst or dst == src:
        raise ChartError("Sankey needs two categorical columns.")
    a, b = _cat_labels(df, src, 7), _cat_labels(df, dst, 7)
    v = _num(df, s["value"]) if s.get("value") else pd.Series(1.0, index=df.index)
    frame = pd.DataFrame({"a": a.astype(str) + " ", "b": b.astype(str), "v": v}).dropna()
    grp = frame.groupby(["a", "b"])["v"].sum().sort_values(ascending=False).head(28)
    links = [{"from": str(k[0]), "to": str(k[1]), "flow": _safe(abs(val))} for k, val in grp.items() if val]
    if not links:
        raise ChartError("No flows to draw.")
    return {"links": links, "fromLabel": src, "toLabel": dst}


def b_parallel(df, types, s):
    cols = (s.get("ys") or [c for c, t in types.items() if t == NUM])[:6]
    if len(cols) < 3:
        raise ChartError("Parallel coordinates needs three or more numeric columns.")
    frame = pd.DataFrame({c: _num(df, c) for c in cols}).dropna()
    if frame.empty:
        raise ChartError("No complete numeric rows.")
    groupcol = s.get("series")
    groups = _cat_labels(df, groupcol, 6).reindex(frame.index) if groupcol and groupcol in df else None
    if len(frame) > 400:
        keep = frame.sample(400, random_state=11).index
        frame, groups = frame.loc[keep], (groups.loc[keep] if groups is not None else None)
    dims = [{"name": c, "min": _safe(frame[c].min()), "max": _safe(frame[c].max())} for c in cols]
    return {"dims": dims,
            "rows": [[_safe(v) for v in row] for row in frame.to_numpy()],
            "groups": [str(g) for g in groups] if groups is not None else None}


def b_candlestick(df, types, s):
    d = pd.to_datetime(df[s["x"]], errors="coerce")
    v = _num(df, s["y"])
    frame = pd.DataFrame({"d": d, "v": v}).dropna().sort_values("d")
    if frame.empty:
        raise ChartError("Need a date column and a numeric column.")
    span = (frame["d"].max() - frame["d"].min()).days or 1
    freq = "W" if span <= 400 else "ME" if span <= 2500 else "QE"
    g = frame.set_index("d")["v"].resample(freq)
    ohlc = pd.DataFrame({"o": g.first(), "h": g.max(), "l": g.min(), "c": g.last()}).dropna()
    if len(ohlc) > 60:
        ohlc = ohlc.iloc[-60:]
    return {"candles": [{"t": pd.Timestamp(i).date().isoformat(), "o": _safe(r.o), "h": _safe(r.h),
                         "l": _safe(r.l), "c": _safe(r.c)} for i, r in ohlc.iterrows()],
            "yLabel": s["y"]}


def b_pareto(df, types, s):
    labels, values = groupby_agg(df, s["x"], s.get("y"), s.get("agg", "sum"), limit=12)
    vals = [abs(v or 0) for v in values]
    total = sum(vals) or 1
    cum, acc = [], 0.0
    for v in vals:
        acc += v
        cum.append(_safe(acc / total * 100))
    return {"labels": labels, "datasets": [{"label": _series_label(s), "data": [_safe(v) for v in vals]}],
            "cumulative": cum}


def b_kpi(df, types, s):
    cards = []
    numcols = (s.get("ys") or [c for c, t in types.items() if t == NUM])[:4]
    datecol = next((c for c, t in types.items() if t == DATE), None)
    for col in numcols:
        v = _num(df, col).dropna()
        if v.empty:
            continue
        spark: list[float] = []
        delta = None
        if datecol:
            try:
                _, spark = _time_series(df, datecol, col, "sum")
                spark = [x for x in spark if x is not None][-24:]
            except ChartError:
                spark = []
        if not spark:
            step = max(1, len(v) // 24)
            spark = [_safe(x) for x in v.rolling(step, min_periods=1).mean().to_numpy()[::step][:24]]
        if len(spark) > 3:
            half = len(spark) // 2
            first, second = np.mean(spark[:half]) or 0, np.mean(spark[half:])
            delta = _safe((second - first) / abs(first) * 100) if first else None
        cards.append({"label": col, "value": _safe(v.sum() if v.min() >= 0 else v.mean()),
                      "mean": _safe(v.mean()), "max": _safe(v.max()), "min": _safe(v.min()),
                      "delta": delta, "spark": spark})
    if not cards:
        raise ChartError("No numeric columns for KPI cards.")
    return {"cards": cards}


_STOP = set("""a an the and or of to in for on with at by from as is are was were be been it its this that these those
we you they he she i not no but if then than so such can will would should may might do does did have has had our your
their his her them us me my mine more most other some any all each which who whom what when where why how""".split())


def b_wordcloud(df, types, s):
    col = s["x"]
    text = " ".join(str(v) for v in df[col].dropna().astype(str).head(6000))
    words = [w.strip(".,!?;:()[]\"'`-–—/").lower() for w in text.split()]
    counts: dict[str, int] = {}
    for w in words:
        if len(w) < 3 or w in _STOP or w.isdigit():
            continue
        counts[w] = counts.get(w, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:60]
    if not top:
        raise ChartError("No words to plot.")
    return {"words": [{"word": w, "count": c} for w, c in top], "column": col}


def b_calendar(df, types, s):
    d = pd.to_datetime(df[s["x"]], errors="coerce")
    v = _num(df, s["y"]) if s.get("y") else pd.Series(1.0, index=df.index)
    frame = pd.DataFrame({"d": d, "v": v}).dropna(subset=["d"])
    daily = frame.set_index("d")["v"].resample("D").sum()
    if daily.empty:
        raise ChartError("No dated rows.")
    if len(daily) > 420:
        daily = daily.iloc[-420:]
    return {"days": [{"date": pd.Timestamp(i).date().isoformat(), "value": _safe(x)} for i, x in daily.items()],
            "label": s.get("y") or "records"}


def b_scatter3d(df, types, s):
    cols = [s["x"], s["y"], s["z"]]
    frame = pd.DataFrame({c: _num(df, c) for c in cols}).dropna()
    if frame.empty:
        raise ChartError("Need three numeric columns with overlapping rows.")
    if len(frame) > 2500:
        frame = frame.sample(2500, random_state=5)
    color = None
    if s.get("series") and s["series"] in df:
        color = _cat_labels(df, s["series"], 6).reindex(frame.index).astype(str).tolist()
    return {"points": [{"x": _safe(r[0]), "y": _safe(r[1]), "z": _safe(r[2])} for r in frame.to_numpy()],
            "axes": cols, "groups": color,
            "ranges": {c: [_safe(frame[c].min()), _safe(frame[c].max())] for c in cols}}


def b_surface3d(df, types, s):
    cols = [s["x"], s["y"], s["z"]]
    frame = pd.DataFrame({c: _num(df, c) for c in cols}).dropna()
    if len(frame) < 9:
        raise ChartError("Not enough rows to build a surface.")
    n = 22
    xb = pd.cut(frame[cols[0]], n, duplicates="drop")
    yb = pd.cut(frame[cols[1]], n, duplicates="drop")
    piv = frame.groupby([xb, yb], observed=True)[cols[2]].mean().unstack()
    piv = piv.interpolate(axis=0, limit_direction="both").interpolate(axis=1, limit_direction="both").fillna(0)
    return {"z": [[_safe(v) for v in row] for row in piv.to_numpy()],
            "axes": cols,
            "xTicks": [_safe(iv.mid) for iv in piv.index],
            "yTicks": [_safe(iv.mid) for iv in piv.columns]}


def b_bar3d(df, types, s):
    cat = s["x"]
    grp = s.get("series")
    val = s.get("y")
    if grp and grp != cat:
        a, b = _cat_labels(df, cat, 10), _cat_labels(df, grp, 8)
        v = _num(df, val) if val else pd.Series(1.0, index=df.index)
        piv = pd.DataFrame({"a": a, "b": b, "v": v}).pivot_table(index="a", columns="b", values="v",
                                                                 aggfunc=s.get("agg", "sum"), fill_value=0)
        return {"rows": [str(i) for i in piv.index], "cols": [str(c) for c in piv.columns],
                "values": [[_safe(v) for v in row] for row in piv.to_numpy()]}
    labels, values = groupby_agg(df, cat, val, s.get("agg", "sum"), limit=12)
    return {"rows": labels, "cols": [val or "count"], "values": [[abs(v or 0)] for v in values]}


def _series_label(s) -> str:
    if s.get("agg") == "count" or not s.get("y"):
        return "records"
    return f"{s['agg']} of {s['y']}" if s.get("agg") else s["y"]


def _fmt(v: float) -> str:
    a = abs(v)
    if a >= 1e9:
        return f"{v/1e9:.1f}B"
    if a >= 1e6:
        return f"{v/1e6:.1f}M"
    if a >= 1e4:
        return f"{v/1e3:.0f}k"
    if a >= 100:
        return f"{v:.0f}"
    if a >= 1:
        return f"{v:.1f}"
    return f"{v:.3g}"


BUILDERS: dict[str, Callable] = {
    "bar": b_categorical, "horizontal_bar": b_categorical, "grouped_bar": b_grouped,
    "stacked_bar": b_grouped, "pie": b_categorical, "donut": b_categorical, "gauge": b_categorical,
    "radar": b_categorical, "polar_area": b_categorical, "radial_bar": b_categorical,
    "line": b_timeseries, "multi_line": b_timeseries_series, "area": b_timeseries,
    "stacked_area": b_timeseries_series, "step_line": b_timeseries,
    "scatter": b_scatter, "bubble": b_bubble, "regression": b_regression,
    "histogram": b_histogram, "kde": b_kde, "box": b_box, "violin": b_box,
    "heatmap": b_heatmap, "treemap": b_treemap, "sunburst": b_sunburst,
    "funnel": b_funnel, "waterfall": b_waterfall, "sankey": b_sankey,
    "parallel": b_parallel, "candlestick": b_candlestick, "pareto": b_pareto,
    "kpi": b_kpi, "wordcloud": b_wordcloud, "calendar": b_calendar,
    "scatter3d": b_scatter3d, "surface3d": b_surface3d, "bar3d": b_bar3d,
}

CHART_META = {
    "bar": ("Bar", "Compare totals across categories"),
    "grouped_bar": ("Grouped bar", "Compare sub-groups side by side"),
    "stacked_bar": ("Stacked bar", "Composition inside each category"),
    "horizontal_bar": ("Horizontal bar", "Ranking with long labels"),
    "line": ("Line", "Trend over time"),
    "multi_line": ("Multi-line", "Compare trends across groups"),
    "area": ("Area", "Volume over time"),
    "stacked_area": ("Stacked area", "Composition over time"),
    "step_line": ("Step line", "Discrete level changes"),
    "pie": ("Pie", "Share of total"),
    "donut": ("Donut", "Share of total, centred metric"),
    "gauge": ("Gauge", "Progress against the leader"),
    "radar": ("Radar", "Multi-axis profile"),
    "polar_area": ("Polar area", "Magnitude around a circle"),
    "radial_bar": ("Radial bar", "Ranked magnitude, radial"),
    "scatter": ("Scatter", "Relationship between two measures"),
    "bubble": ("Bubble", "Three measures at once"),
    "regression": ("Regression", "Fitted trend and strength"),
    "histogram": ("Histogram", "Distribution shape"),
    "kde": ("Density", "Smoothed distribution"),
    "box": ("Box plot", "Spread, median and outliers"),
    "violin": ("Violin", "Distribution density by group"),
    "heatmap": ("Correlation heatmap", "How measures move together"),
    "treemap": ("Treemap", "Nested magnitude"),
    "sunburst": ("Sunburst", "Hierarchy of shares"),
    "funnel": ("Funnel", "Stage-to-stage drop-off"),
    "waterfall": ("Waterfall", "Running contribution"),
    "sankey": ("Sankey", "Flow between categories"),
    "parallel": ("Parallel coordinates", "Multivariate patterns"),
    "candlestick": ("Candlestick", "Open/high/low/close per period"),
    "pareto": ("Pareto", "80/20 concentration"),
    "kpi": ("KPI sparklines", "Headline numbers with micro-trends"),
    "wordcloud": ("Word cloud", "Most frequent terms"),
    "calendar": ("Calendar heatmap", "Daily intensity"),
    "scatter3d": ("3D scatter", "Three measures in space"),
    "surface3d": ("3D surface", "Response surface across two inputs"),
    "bar3d": ("3D bars", "Category grid in space"),
}


def build(df: pd.DataFrame, types: dict[str, str], spec: dict) -> dict:
    t = spec.get("type")
    fn = BUILDERS.get(t)
    if fn is None:
        raise ChartError(f"Unknown chart type '{t}'.")
    for key in ("x", "y", "z", "series", "size", "value"):
        col = spec.get(key)
        if col and col not in df.columns:
            raise ChartError(f"Column '{col}' is not in this sheet.")
    if spec.get("ys"):
        spec["ys"] = [c for c in spec["ys"] if c in df.columns]
    return fn(df, types, spec)
