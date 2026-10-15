"""Deck exporters: PPTX (python-pptx), XLSX (openpyxl) and PDF (matplotlib), all with
server-rendered chart PNGs so exports look like the on-screen deck."""
from __future__ import annotations

import io
import math
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402
from matplotlib.patches import Polygon, Rectangle, Wedge  # noqa: E402

BG = "#0b1014"
PANEL = "#121a20"
FG = "#e6edf3"
MUTED = "#8ba0ae"
ACCENT = "#5ee7c6"
PALETTE = ["#5ee7c6", "#59a5f5", "#b98cf7", "#f5a35e", "#f2718c", "#7de08a", "#e5d15e", "#6fd3e0"]


def _fig(w=10.0, h=5.6):
    fig = plt.figure(figsize=(w, h), dpi=130, facecolor=BG)
    ax = fig.add_subplot(111, facecolor=PANEL)
    for spine in ax.spines.values():
        spine.set_color("#25323b")
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(color="#1d272e", linewidth=0.6)
    ax.set_axisbelow(True)
    return fig, ax


def _short(labels, n=16):
    return [str(l)[: n - 1] + "…" if len(str(l)) > n else str(l) for l in labels]


def _finish(fig, title: str) -> bytes:
    fig.suptitle(title, color=FG, fontsize=13, x=0.02, ha="left", y=0.97)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()


def render_slide(slide: dict) -> bytes:
    t, d, title = slide["type"], slide.get("data") or {}, slide.get("title", "Chart")
    try:
        return _render(t, d, title)
    except Exception:  # noqa: BLE001 — never fail an export because of one chart
        fig, ax = _fig()
        ax.text(0.5, 0.5, "Chart preview unavailable", color=MUTED, ha="center", va="center")
        ax.set_axis_off()
        return _finish(fig, title)


def _render(t: str, d: dict, title: str) -> bytes:  # noqa: C901 - dispatch table
    if t == "kpi":
        fig = plt.figure(figsize=(10, 5.6), dpi=130, facecolor=BG)
        cards = d["cards"][:4]
        for i, c in enumerate(cards):
            ax = fig.add_subplot(len(cards), 1, i + 1, facecolor=PANEL)
            ax.set_axis_off()
            ax.text(0.01, 0.62, c["label"], color=MUTED, fontsize=9, transform=ax.transAxes)
            ax.text(0.01, 0.12, f"{c['value']:,.2f}".rstrip("0").rstrip("."), color=FG,
                    fontsize=18, transform=ax.transAxes)
            if c.get("delta") is not None:
                ax.text(0.30, 0.2, f"{c['delta']:+.1f}%", color=ACCENT if c["delta"] >= 0 else "#f2718c",
                        fontsize=11, transform=ax.transAxes)
            sp = [x for x in c.get("spark") or [] if x is not None]
            if len(sp) > 1:
                sax = ax.inset_axes([0.55, 0.1, 0.44, 0.8])
                sax.plot(sp, color=PALETTE[i % len(PALETTE)], linewidth=1.6)
                sax.fill_between(range(len(sp)), sp, min(sp), color=PALETTE[i % len(PALETTE)], alpha=0.18)
                sax.set_axis_off()
                sax.set_facecolor(PANEL)
        return _finish(fig, title)

    if t in ("bar", "grouped_bar", "stacked_bar", "horizontal_bar", "pareto", "histogram", "kde",
             "line", "area", "multi_line", "stacked_area", "step_line", "radar", "polar_area",
             "radial_bar", "pie", "donut", "gauge"):
        labels = _short(d.get("labels") or [])
        ds = d.get("datasets") or []
        if t in ("pie", "donut", "gauge"):
            fig, ax = _fig(8, 5.6)
            vals = [abs(v or 0) for v in ds[0]["data"]]
            ax.set_axis_off()
            wedges, *_ = ax.pie(vals, labels=labels, colors=PALETTE * 4,
                                textprops={"color": FG, "fontsize": 8},
                                wedgeprops={"width": 0.42 if t != "pie" else 1.0,
                                            "edgecolor": BG, "linewidth": 1.4},
                                startangle=90 if t != "gauge" else 180)
            ax.axis("equal")
            return _finish(fig, title)
        if t in ("radar", "polar_area", "radial_bar"):
            fig = plt.figure(figsize=(8, 5.6), dpi=130, facecolor=BG)
            ax = fig.add_subplot(111, polar=True, facecolor=PANEL)
            vals = [abs(v or 0) for v in ds[0]["data"]]
            ang = np.linspace(0, 2 * math.pi, len(vals), endpoint=False)
            if t == "radar":
                ax.plot(np.append(ang, ang[0]), vals + vals[:1], color=ACCENT)
                ax.fill(np.append(ang, ang[0]), vals + vals[:1], color=ACCENT, alpha=0.25)
            else:
                ax.bar(ang, vals, width=2 * math.pi / max(len(vals), 1) * 0.85,
                       color=PALETTE * 4, alpha=0.85)
            ax.set_xticks(ang)
            ax.set_xticklabels(labels, color=MUTED, fontsize=7)
            ax.tick_params(colors=MUTED, labelsize=7)
            return _finish(fig, title)
        fig, ax = _fig()
        idx = np.arange(len(labels))
        line_like = t in ("line", "area", "multi_line", "stacked_area", "step_line")
        if line_like:
            bottom = np.zeros(len(labels))
            for i, s in enumerate(ds):
                y = np.array([v or 0 for v in s["data"]], dtype=float)
                c = PALETTE[i % len(PALETTE)]
                if t == "stacked_area":
                    ax.fill_between(idx, bottom, bottom + y, color=c, alpha=0.6, label=s["label"])
                    bottom = bottom + y
                else:
                    ax.plot(idx, y, color=c, linewidth=1.9, label=s["label"],
                            drawstyle="steps-post" if t == "step_line" else "default")
                    if t == "area":
                        ax.fill_between(idx, y, y.min(), color=c, alpha=0.22)
        elif t == "horizontal_bar":
            ax.barh(idx, [v or 0 for v in ds[0]["data"]], color=ACCENT, height=0.62)
            ax.set_yticks(idx, labels)
            ax.invert_yaxis()
        elif t in ("grouped_bar", "stacked_bar") and len(ds) > 1:
            if t == "stacked_bar":
                bottom = np.zeros(len(labels))
                for i, s in enumerate(ds):
                    y = np.array([v or 0 for v in s["data"]], float)
                    ax.bar(idx, y, bottom=bottom, color=PALETTE[i % len(PALETTE)], label=s["label"])
                    bottom += y
            else:
                w = 0.8 / len(ds)
                for i, s in enumerate(ds):
                    ax.bar(idx + i * w - 0.4 + w / 2, [v or 0 for v in s["data"]], width=w,
                           color=PALETTE[i % len(PALETTE)], label=s["label"])
        else:
            ax.bar(idx, [v or 0 for v in ds[0]["data"]], color=ACCENT, width=0.62)
        if t == "pareto":
            ax2 = ax.twinx()
            ax2.plot(idx, d["cumulative"], color="#f5a35e", marker="o", markersize=3)
            ax2.set_ylim(0, 105)
            ax2.tick_params(colors=MUTED, labelsize=8)
        if t != "horizontal_bar":
            step = max(1, len(labels) // 12)
            ax.set_xticks(idx[::step], labels[::step], rotation=30, ha="right")
        if len(ds) > 1:
            ax.legend(facecolor=PANEL, edgecolor="#25323b", labelcolor=FG, fontsize=7, loc="best")
        return _finish(fig, title)

    if t in ("scatter", "bubble", "regression"):
        fig, ax = _fig()
        pts = d["points"]
        x = [p["x"] for p in pts]
        y = [p["y"] for p in pts]
        sizes = [max(6, (p.get("r") or 4) ** 1.6) for p in pts] if t == "bubble" else 14
        ax.scatter(x, y, s=sizes, color=ACCENT, alpha=0.55, edgecolors="none")
        if t == "regression":
            ax.plot([p["x"] for p in d["fit"]], [p["y"] for p in d["fit"]], color="#f5a35e", linewidth=2)
        ax.set_xlabel(d.get("xLabel", ""), color=MUTED, fontsize=9)
        ax.set_ylabel(d.get("yLabel", ""), color=MUTED, fontsize=9)
        return _finish(fig, title)

    if t == "heatmap":
        fig, ax = _fig(8.4, 5.6)
        m = np.array(d["matrix"], float)
        im = ax.imshow(m, cmap="viridis", vmin=-1, vmax=1)
        labels = _short(d["labels"], 12)
        ax.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
        ax.set_yticks(range(len(labels)), labels)
        ax.grid(False)
        cb = fig.colorbar(im, ax=ax)
        cb.ax.tick_params(colors=MUTED, labelsize=7)
        return _finish(fig, title)

    if t in ("box", "violin"):
        fig, ax = _fig()
        groups = d["groups"]
        data = [[v for v in g["values"] if v is not None] or [g["median"] or 0] for g in groups]
        if t == "violin":
            parts = ax.violinplot(data, showmedians=True)
            for i, b in enumerate(parts["bodies"]):
                b.set_facecolor(PALETTE[i % len(PALETTE)])
                b.set_alpha(0.55)
            for key in ("cbars", "cmins", "cmaxes", "cmedians"):
                if key in parts:
                    parts[key].set_color(MUTED)
        else:
            bp = ax.boxplot(data, patch_artist=True, medianprops={"color": BG})
            for i, patch in enumerate(bp["boxes"]):
                patch.set_facecolor(PALETTE[i % len(PALETTE)])
                patch.set_alpha(0.8)
            for key in ("whiskers", "caps", "fliers"):
                for art in bp[key]:
                    art.set_color(MUTED)
        ax.set_xticks(range(1, len(groups) + 1), _short([g["label"] for g in groups], 12),
                      rotation=25, ha="right")
        return _finish(fig, title)

    if t in ("treemap", "sunburst"):
        fig, ax = _fig()
        nodes = d["nodes"]
        if t == "sunburst":
            ax.set_axis_off()
            ax.set_xlim(-1.1, 1.1)
            ax.set_ylim(-1.1, 1.1)
            total = sum(n["value"] for n in nodes) or 1
            start = 90.0
            for i, n in enumerate(nodes):
                ext = n["value"] / total * 360
                ax.add_patch(Wedge((0, 0), 0.62, start - ext, start, width=0.3,
                                   facecolor=PALETTE[i % len(PALETTE)], edgecolor=BG))
                inner_start = start
                for j, ch in enumerate(n.get("children") or []):
                    cext = ch["value"] / total * 360
                    ax.add_patch(Wedge((0, 0), 0.98, inner_start - cext, inner_start, width=0.32,
                                       facecolor=PALETTE[i % len(PALETTE)], alpha=0.55, edgecolor=BG))
                    inner_start -= cext
                mid = math.radians(start - ext / 2)
                if ext > 12:
                    ax.text(0.45 * math.cos(mid), 0.45 * math.sin(mid), _short([n["label"]], 12)[0],
                            color=BG, fontsize=7, ha="center", va="center")
                start -= ext
            return _finish(fig, title)
        ax.set_axis_off()
        _squarify(ax, nodes)
        return _finish(fig, title)

    if t == "funnel":
        fig, ax = _fig()
        ax.set_axis_off()
        stages = d["stages"]
        top = max(s["value"] for s in stages) or 1
        h = 1.0 / max(len(stages), 1)
        for i, s in enumerate(stages):
            w = 0.15 + 0.8 * (s["value"] / top)
            y = 1 - (i + 1) * h
            ax.add_patch(Rectangle(((1 - w) / 2, y + h * 0.12), w, h * 0.7,
                                   facecolor=PALETTE[i % len(PALETTE)], alpha=0.85))
            ax.text(0.5, y + h * 0.45, f"{s['label']} — {s['value']:,.0f} ({s['pct']:.0f}%)",
                    color=BG, ha="center", va="center", fontsize=8)
        return _finish(fig, title)

    if t == "waterfall":
        fig, ax = _fig()
        steps = d["steps"]
        for i, s in enumerate(steps):
            lo, hi = min(s["start"], s["end"]), max(s["start"], s["end"])
            color = ACCENT if s["value"] >= 0 else "#f2718c"
            if s.get("total"):
                color = "#59a5f5"
            ax.bar(i, max(hi - lo, 1e-9), bottom=lo, color=color, width=0.6)
        ax.set_xticks(range(len(steps)), _short([s["label"] for s in steps], 12), rotation=30, ha="right")
        return _finish(fig, title)

    if t == "sankey":
        fig, ax = _fig()
        ax.set_axis_off()
        links = d["links"]
        srcs = list(dict.fromkeys(l["from"] for l in links))
        dsts = list(dict.fromkeys(l["to"] for l in links))
        total = sum(l["flow"] for l in links) or 1
        pos_s, y = {}, 1.0
        for s in srcs:
            hh = sum(l["flow"] for l in links if l["from"] == s) / total
            pos_s[s] = [y - hh, y]
            ax.add_patch(Rectangle((0.02, y - hh), 0.05, hh, facecolor=ACCENT))
            ax.text(0.08, y - hh / 2, _short([s], 14)[0], color=FG, fontsize=7, va="center")
            y -= hh + 0.02
        pos_d, y = {}, 1.0
        for i, dd in enumerate(dsts):
            hh = sum(l["flow"] for l in links if l["to"] == dd) / total
            pos_d[dd] = [y - hh, y]
            ax.add_patch(Rectangle((0.93, y - hh), 0.05, hh, facecolor=PALETTE[(i + 1) % len(PALETTE)]))
            ax.text(0.92, y - hh / 2, _short([dd], 14)[0], color=FG, fontsize=7, va="center", ha="right")
            y -= hh + 0.02
        for i, l in enumerate(links):
            hh = l["flow"] / total
            a = pos_s[l["from"]]
            b = pos_d[l["to"]]
            ax.add_patch(Polygon([(0.07, a[1]), (0.93, b[1]), (0.93, b[1] - hh), (0.07, a[1] - hh)],
                                 facecolor=PALETTE[i % len(PALETTE)], alpha=0.28))
            a[1] -= hh
            b[1] -= hh
        ax.set_xlim(0, 1)
        ax.set_ylim(-0.05, 1.05)
        return _finish(fig, title)

    if t == "parallel":
        fig, ax = _fig()
        dims, rows = d["dims"], d["rows"]
        norm = []
        for r in rows:
            norm.append([(v - dm["min"]) / ((dm["max"] - dm["min"]) or 1) for v, dm in zip(r, dims)])
        for i, r in enumerate(norm[:250]):
            ax.plot(range(len(dims)), r, color=PALETTE[i % len(PALETTE)], alpha=0.25, linewidth=0.8)
        ax.set_xticks(range(len(dims)), _short([dm["name"] for dm in dims], 12), rotation=20, ha="right")
        ax.set_yticks([])
        return _finish(fig, title)

    if t == "candlestick":
        fig, ax = _fig()
        for i, c in enumerate(d["candles"]):
            up = c["c"] >= c["o"]
            color = ACCENT if up else "#f2718c"
            ax.plot([i, i], [c["l"], c["h"]], color=color, linewidth=0.9)
            ax.bar(i, max(abs(c["c"] - c["o"]), 1e-9), bottom=min(c["o"], c["c"]), color=color, width=0.6)
        step = max(1, len(d["candles"]) // 10)
        ax.set_xticks(range(0, len(d["candles"]), step),
                      [c["t"] for c in d["candles"][::step]], rotation=30, ha="right")
        return _finish(fig, title)

    if t == "wordcloud":
        fig, ax = _fig()
        ax.set_axis_off()
        words = d["words"][:34]
        mx = max(w["count"] for w in words) or 1
        rng = np.random.default_rng(4)
        placed = []
        for i, w in enumerate(words):
            size = 8 + 26 * (w["count"] / mx)
            for _ in range(120):
                x, y = rng.uniform(0.05, 0.95), rng.uniform(0.08, 0.92)
                wd = size * len(w["word"]) * 0.0055
                box = (x - wd / 2, y - size * 0.006, x + wd / 2, y + size * 0.006)
                if all(box[2] < p[0] or box[0] > p[2] or box[3] < p[1] or box[1] > p[3] for p in placed):
                    placed.append(box)
                    ax.text(x, y, w["word"], color=PALETTE[i % len(PALETTE)], fontsize=size,
                            ha="center", va="center", transform=ax.transAxes)
                    break
        return _finish(fig, title)

    if t == "calendar":
        fig, ax = _fig(10, 3.4)
        days = d["days"]
        vals = [x["value"] or 0 for x in days]
        weeks = math.ceil(len(days) / 7)
        grid = np.full((7, weeks), np.nan)
        for i, v in enumerate(vals):
            grid[i % 7, i // 7] = v
        ax.imshow(grid, cmap="viridis", aspect="auto")
        ax.set_yticks(range(7), ["M", "T", "W", "T", "F", "S", "S"])
        ax.set_xticks([])
        ax.grid(False)
        return _finish(fig, title)

    if t in ("scatter3d", "bar3d", "surface3d"):
        fig = plt.figure(figsize=(9, 5.6), dpi=130, facecolor=BG)
        ax = fig.add_subplot(111, projection="3d", facecolor=PANEL)
        ax.tick_params(colors=MUTED, labelsize=7)
        for pane in (ax.xaxis, ax.yaxis, ax.zaxis):
            pane.set_pane_color((0.07, 0.1, 0.12, 1.0))
        if t == "scatter3d":
            p = d["points"]
            ax.scatter([q["x"] for q in p], [q["y"] for q in p], [q["z"] for q in p],
                       c=[q["z"] for q in p], cmap="viridis", s=8, alpha=0.7)
            ax.set_xlabel(d["axes"][0], color=MUTED, fontsize=8)
            ax.set_ylabel(d["axes"][1], color=MUTED, fontsize=8)
            ax.set_zlabel(d["axes"][2], color=MUTED, fontsize=8)
        elif t == "surface3d":
            z = np.array(d["z"], float)
            X, Y = np.meshgrid(np.arange(z.shape[1]), np.arange(z.shape[0]))
            ax.plot_surface(X, Y, z, cmap="viridis", linewidth=0, antialiased=True)
            ax.set_xlabel(d["axes"][1], color=MUTED, fontsize=8)
            ax.set_ylabel(d["axes"][0], color=MUTED, fontsize=8)
            ax.set_zlabel(d["axes"][2], color=MUTED, fontsize=8)
        else:
            vals = np.array(d["values"], float)
            for i in range(vals.shape[0]):
                for j in range(vals.shape[1]):
                    ax.bar3d(i, j, 0, 0.6, 0.6, vals[i, j], color=PALETTE[j % len(PALETTE)],
                             alpha=0.85, shade=True)
            ax.set_xticks(range(len(d["rows"])), _short(d["rows"], 10), fontsize=6)
            ax.set_yticks(range(len(d["cols"])), _short(d["cols"], 10), fontsize=6)
        return _finish(fig, title)

    fig, ax = _fig()
    ax.text(0.5, 0.5, "No renderer", color=MUTED, ha="center")
    ax.set_axis_off()
    return _finish(fig, title)


def _squarify(ax, nodes):
    """Minimal squarified treemap layout."""
    total = sum(n["value"] for n in nodes) or 1
    x, y, w, h = 0.0, 0.0, 1.0, 1.0
    items = sorted(nodes, key=lambda n: -n["value"])
    i = 0
    while i < len(items):
        remaining = sum(n["value"] for n in items[i:]) or 1
        horizontal = w >= h
        row = [items[i]]
        i += 1
        while i < len(items) and len(row) < 3:
            row.append(items[i])
            i += 1
        frac = sum(n["value"] for n in row) / remaining
        if horizontal:
            rw = w * frac
            oy = y
            for n in row:
                rh = h * (n["value"] / (sum(m["value"] for m in row) or 1))
                _cell(ax, x, oy, rw, rh, n, total)
                oy += rh
            x += rw
            w -= rw
        else:
            rh = h * frac
            ox = x
            for n in row:
                rww = w * (n["value"] / (sum(m["value"] for m in row) or 1))
                _cell(ax, ox, y, rww, rh, n, total)
                ox += rww
            y += rh
            h -= rh
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)


_cell_i = 0


def _cell(ax, x, y, w, h, node, total):
    global _cell_i
    _cell_i += 1
    ax.add_patch(Rectangle((x, y), w, h, facecolor=PALETTE[_cell_i % len(PALETTE)],
                           alpha=0.85, edgecolor=BG, linewidth=1.5))
    if w > 0.09 and h > 0.06:
        ax.text(x + w / 2, y + h / 2, f"{_short([node['label']], 14)[0]}\n{node['value']:,.0f}",
                color=BG, fontsize=7, ha="center", va="center")


# --------------------------------------------------------------------------- #
# containers
# --------------------------------------------------------------------------- #
def build_pptx(name: str, summary: dict, slides: list[dict]) -> bytes:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Emu, Inches, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]

    def bg(slide):
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor(0x0B, 0x10, 0x14)

    def text(slide, txt, left, top, width, height, size, color=FG, bold=False):
        box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
        tf = box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = txt
        p.font.size = Pt(size)
        p.font.bold = bold
        p.font.color.rgb = RGBColor.from_string(color.lstrip("#").upper())
        return box

    cover = prs.slides.add_slide(blank)
    bg(cover)
    text(cover, "DataStage", 0.8, 2.1, 8, 1, 44, ACCENT, True)
    text(cover, name, 0.8, 3.1, 11, 1, 26, FG)
    text(cover, f"{summary['rows']:,} rows · {summary['columns']} columns · {len(slides)} charts · "
                f"{summary['completeness']*100:.0f}% complete", 0.8, 4.0, 11, 1, 14, MUTED)

    for s in slides:
        sl = prs.slides.add_slide(blank)
        bg(sl)
        text(sl, s["title"], 0.6, 0.35, 12, 0.7, 24, FG, True)
        text(sl, f"{s['name']} · {s['rationale']}", 0.6, 1.0, 12, 0.4, 12, ACCENT)
        png = render_slide(s)
        sl.shapes.add_picture(io.BytesIO(png), Inches(0.6), Inches(1.5), width=Inches(12.1))
        text(sl, s["insight"], 0.6, 6.55, 12.1, 0.8, 12, MUTED)
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def build_xlsx(name: str, summary: dict, slides: list[dict], profile: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="15242C")
    ws.append(["DataStage export", name])
    ws.append([])
    for k, v in summary.items():
        ws.append([k, v])
    ws.append([])
    ws.append(["Chart", "Type", "Insight"])
    for c in ws[ws.max_row]:
        c.font, c.fill = head, fill
    for s in slides:
        ws.append([s["title"], s["name"], s["insight"]])
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 90
    for row in ws.iter_rows(min_row=1):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)

    cols = wb.create_sheet("Columns")
    cols.append(["column", "type", "unique", "nulls", "min", "max", "mean"])
    for c in cols[1]:
        c.font, c.fill = head, fill
    for col in profile.get("columns", []):
        cols.append([col["name"], col["type"], col.get("unique"), col.get("nulls"),
                     col.get("min"), col.get("max"), col.get("mean")])
    cols.column_dimensions["A"].width = 30

    data_ws = wb.create_sheet("Chart data")
    for s in slides:
        data_ws.append([s["title"]])
        data_ws[data_ws.max_row][0].font = Font(bold=True)
        d = s.get("data") or {}
        if d.get("labels") and d.get("datasets"):
            data_ws.append(["label"] + [ds["label"] for ds in d["datasets"]])
            for i, lab in enumerate(d["labels"]):
                data_ws.append([lab] + [ds["data"][i] if i < len(ds["data"]) else None for ds in d["datasets"]])
        elif d.get("cards"):
            data_ws.append(["metric", "value", "mean", "min", "max"])
            for c in d["cards"]:
                data_ws.append([c["label"], c["value"], c["mean"], c["min"], c["max"]])
        else:
            data_ws.append(["insight", s["insight"]])
        data_ws.append([])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def build_pdf(name: str, summary: dict, slides: list[dict]) -> bytes:
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        fig = plt.figure(figsize=(11, 8.5), dpi=110, facecolor=BG)
        fig.text(0.08, 0.62, "DataStage", color=ACCENT, fontsize=40, weight="bold")
        fig.text(0.08, 0.55, name, color=FG, fontsize=20)
        fig.text(0.08, 0.50, f"{summary['rows']:,} rows · {summary['columns']} columns · {len(slides)} charts",
                 color=MUTED, fontsize=12)
        pdf.savefig(fig, facecolor=BG)
        plt.close(fig)
        for s in slides:
            png = render_slide(s)
            fig = plt.figure(figsize=(11, 8.5), dpi=110, facecolor=BG)
            fig.text(0.06, 0.94, s["title"], color=FG, fontsize=18)
            fig.text(0.06, 0.90, f"{s['name']} · {s['rationale']}", color=ACCENT, fontsize=10)
            ax = fig.add_axes([0.06, 0.16, 0.88, 0.7])
            ax.imshow(plt.imread(io.BytesIO(png)))
            ax.set_axis_off()
            fig.text(0.06, 0.08, _wrap(s["insight"], 120), color=MUTED, fontsize=10)
            pdf.savefig(fig, facecolor=BG)
            plt.close(fig)
    return buf.getvalue()


def _wrap(text: str, width: int) -> str:
    import textwrap
    return "\n".join(textwrap.wrap(text, width))
