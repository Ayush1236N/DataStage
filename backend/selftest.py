"""Offline smoke test: parse each sample, plan every chart, render exports."""
from __future__ import annotations

import json
from pathlib import Path

import charting
import planner
import profiling
from exporters import build_pdf, build_pptx, build_xlsx, render_slide

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
seen: set[str] = set()

for f in sorted(SAMPLES.glob("*")):
    frames = profiling.read_any(f.name, f.read_bytes())
    print(f"\n=== {f.name}: sheets={list(frames)}")
    for sheet, raw in frames.items():
        df, types = profiling.coerce(raw)
        slides = planner.plan(df, types, sheet)
        print(f"  [{sheet}] {len(df)} rows types={json.dumps(types)[:160]}")
        print(f"    {len(slides)} slides: {[s['type'] for s in slides]}")
        for s in slides[:3]:
            print(f"      · {s['title']} — {s['insight'][:110]}")
        seen.update(s["type"] for s in slides)
        # render every chart type once through matplotlib
        for s in slides:
            png = render_slide(s)
            assert png[:4] == b"\x89PNG", s["type"]
        if sheet == list(frames)[0]:
            summary = planner.dataset_summary(df, types)
            profile = profiling.profile_sheet(sheet, df, types)
            for name, fn in (("pptx", lambda: build_pptx(f.name, summary, slides)),
                             ("xlsx", lambda: build_xlsx(f.name, summary, slides, profile)),
                             ("pdf", lambda: build_pdf(f.name, summary, slides))):
                data = fn()
                out = Path(f"/tmp/{f.stem}.{name}")
                out.write_bytes(data)
                print(f"    export {name}: {len(data):,} bytes -> {out}")

missing = set(charting.BUILDERS) - seen
print(f"\nchart types exercised: {len(seen)}/{len(charting.BUILDERS)}")
print("never produced by planner:", sorted(missing))
