"""DataStage API — parse, profile, plan and export chart presentations."""
from __future__ import annotations

import asyncio
import json
import os
import pickle
import time
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

import charting
import planner
import profiling
from exporters import build_pdf, build_pptx, build_xlsx, render_slide
from profiling import ParseError

BASE = Path(__file__).resolve().parent
CACHE = BASE / ".cache"
SAMPLES = BASE.parent / "samples"
CACHE.mkdir(exist_ok=True)

app = FastAPI(title="DataStage API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["Content-Disposition"])

# dataset_id -> {"name":str, "sheets":{sheet: (df, types)}, "profile": [...], "ts": float}
STORE: dict[str, dict[str, Any]] = {}
JOBS: dict[str, dict[str, Any]] = {}
MAX_DATASETS = 12


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


def _persist(dsid: str, sheets: dict[str, tuple[pd.DataFrame, dict]]) -> None:
    """Disk cache so a dataset survives an eviction from the in-memory dict."""
    try:
        with open(CACHE / f"{dsid}.pkl", "wb") as fh:
            pickle.dump({k: (v[0], v[1]) for k, v in sheets.items()}, fh, protocol=4)
    except Exception:  # noqa: BLE001
        pass


def _evict() -> None:
    while len(STORE) > MAX_DATASETS:
        oldest = min(STORE, key=lambda k: STORE[k]["ts"])
        STORE.pop(oldest, None)


def _register(name: str, frames: dict[str, pd.DataFrame]) -> dict:
    dsid = uuid.uuid4().hex[:12]
    sheets: dict[str, tuple[pd.DataFrame, dict]] = {}
    profiles = []
    for sheet, raw in frames.items():
        df, types = profiling.coerce(raw)
        if df.empty or not len(df.columns):
            continue
        sheets[sheet] = (df, types)
        profiles.append(profiling.profile_sheet(sheet, df, types))
    if not sheets:
        _err(422, "The file parsed but contained no usable rows.")
    STORE[dsid] = {"name": name, "sheets": sheets, "profile": profiles, "ts": time.time()}
    _persist(dsid, sheets)
    _evict()
    return {
        "dataset_id": dsid,
        "name": name,
        "sheets": profiles,
        "summary": {s["name"]: planner.dataset_summary(*sheets[s["name"]]) for s in profiles},
    }


def _get(dsid: str) -> dict:
    entry = STORE.get(dsid)
    if entry is None:
        path = CACHE / f"{dsid}.pkl"
        if path.exists():
            try:
                with open(path, "rb") as fh:
                    sheets = pickle.load(fh)
                profiles = [profiling.profile_sheet(k, v[0], v[1]) for k, v in sheets.items()]
                entry = {"name": dsid, "sheets": sheets, "profile": profiles, "ts": time.time()}
                STORE[dsid] = entry
            except Exception:  # noqa: BLE001
                entry = None
    if entry is None:
        _err(404, "That dataset is no longer available — please upload the file again.")
    entry["ts"] = time.time()
    return entry


def _sheet(dsid: str, sheet: str | None) -> tuple[pd.DataFrame, dict, str]:
    entry = _get(dsid)
    sheets = entry["sheets"]
    key = sheet if sheet in sheets else next(iter(sheets))
    df, types = sheets[key]
    return df, types, key


# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    return {"ok": True, "datasets": len(STORE), "charts": len(charting.BUILDERS)}


@app.get("/api/chart-types")
def chart_types():
    return {"types": [{"id": k, "name": v[0], "description": v[1]}
                      for k, v in charting.CHART_META.items()]}


@app.get("/api/samples")
def samples():
    out = []
    meta = {
        "sales.xlsx": ("Retail sales workbook", "Three sheets: transactions, targets and store roster — "
                       "dates, categories and revenue."),
        "survey.csv": ("Product survey", "1,200 responses with satisfaction scores, segments and free text."),
        "report.docx": ("Quarterly report", "Word document with tables plus numeric statements in prose."),
    }
    for f in sorted(SAMPLES.glob("*")):
        if f.suffix.lower() in profiling.ALLOWED_EXT:
            title, desc = meta.get(f.name, (f.stem.title(), "Sample dataset"))
            out.append({"file": f.name, "title": title, "description": desc,
                        "size": f.stat().st_size, "ext": f.suffix.lstrip(".")})
    return {"samples": out}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        frames = profiling.read_any(file.filename or "upload", raw)
    except ParseError as exc:
        _err(422, str(exc))
    return _register(file.filename or "Uploaded data", frames)


@app.post("/api/sample/{filename}")
def load_sample(filename: str):
    path = (SAMPLES / filename).resolve()
    if not str(path).startswith(str(SAMPLES.resolve())) or not path.exists():
        _err(404, f"Sample '{filename}' not found.")
    try:
        frames = profiling.read_any(path.name, path.read_bytes())
    except ParseError as exc:
        _err(422, str(exc))
    return _register(path.name, frames)


@app.get("/api/rows/{dataset_id}")
def rows(dataset_id: str, sheet: str | None = None, offset: int = 0, limit: int = 200,
         sort: str | None = None, desc: bool = False, q: str | None = None):
    df, _types, key = _sheet(dataset_id, sheet)
    if q:
        mask = df.apply(lambda col: col.astype(str).str.contains(q, case=False, na=False)).any(axis=1)
        df = df[mask]
    if sort and sort in df.columns:
        df = df.sort_values(sort, ascending=not desc, kind="stable")
    payload = profiling.rows_payload(df, max(0, offset), min(500, max(1, limit)))
    payload["sheet"] = key
    return payload


@app.post("/api/analyze")
def analyze(payload: dict = Body(...)):
    dsid = payload.get("dataset_id")
    if not dsid:
        _err(400, "dataset_id is required.")
    df, types, key = _sheet(dsid, payload.get("sheet"))
    override = payload.get("types") or {}
    types = {**types, **{k: v for k, v in override.items() if k in types}}
    limit = int(payload.get("limit") or 40)
    slides = planner.plan(df, types, key, limit=limit)
    if not slides:
        _err(422, "This sheet has no chartable columns — try another sheet.")
    entry = _get(dsid)
    entry.setdefault("plans", {})[key] = slides
    return {"dataset_id": dsid, "sheet": key, "name": entry["name"],
            "summary": planner.dataset_summary(df, types), "slides": slides}


@app.post("/api/aggregate")
def aggregate(payload: dict = Body(...)):
    dsid = payload.get("dataset_id")
    spec = payload.get("spec") or {}
    if not dsid or not spec.get("type"):
        _err(400, "dataset_id and spec.type are required.")
    df, types, key = _sheet(dsid, payload.get("sheet"))
    for f in payload.get("filters") or []:
        col, op, val = f.get("column"), f.get("op"), f.get("value")
        if col not in df.columns:
            continue
        try:
            if op == "in" and isinstance(val, list):
                df = df[df[col].astype(str).isin([str(v) for v in val])]
            elif op == "contains":
                df = df[df[col].astype(str).str.contains(str(val), case=False, na=False)]
            elif op in (">", ">=", "<", "<=", "==") and val is not None:
                s = pd.to_numeric(df[col], errors="coerce")
                v = float(val)
                df = df[{">": s > v, ">=": s >= v, "<": s < v, "<=": s <= v, "==": s == v}[op].fillna(False)]
        except Exception:  # noqa: BLE001
            continue
    if df.empty:
        _err(422, "No rows match the current filters.")
    try:
        data = charting.build(df, types, dict(spec))
    except charting.ChartError as exc:
        _err(422, str(exc))
    except Exception as exc:  # noqa: BLE001
        _err(422, f"Could not build that chart: {exc}")
    meta = charting.CHART_META.get(spec["type"], (spec["type"], ""))
    return {"sheet": key, "type": spec["type"], "name": meta[0], "rationale": meta[1],
            "title": planner.title_for(spec, key), "insight": planner.insight(spec, data),
            "spec": spec, "data": data, "rows": int(len(df))}


@app.post("/api/describe")
def describe(payload: dict = Body(...)):
    df, types, key = _sheet(payload.get("dataset_id", ""), payload.get("sheet"))
    num = df[[c for c, t in types.items() if t == profiling.NUM]]
    if num.empty:
        return {"sheet": key, "stats": []}
    desc = num.describe().T.reset_index().rename(columns={"index": "column"})
    return {"sheet": key,
            "stats": [{k: profiling._safe(v) for k, v in row.items()} for row in desc.to_dict("records")]}


# --------------------------------------------------------------------------- #
# progress (SSE)
# --------------------------------------------------------------------------- #
@app.post("/api/jobs")
def create_job(payload: dict = Body(...)):
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"steps": [], "done": False,
                    "dataset_id": payload.get("dataset_id"), "sheet": payload.get("sheet")}
    return {"job_id": job_id}


@app.get("/api/progress/{job_id}")
async def progress(job_id: str, dataset_id: str | None = None, sheet: str | None = None,
                   limit: int = 40):
    """Runs parse-free analyze pipeline, streaming stage updates as SSE."""
    job = JOBS.get(job_id) or {}
    dsid = dataset_id or job.get("dataset_id")
    sheet = sheet or job.get("sheet")
    if not dsid:
        _err(400, "dataset_id required.")

    async def gen():
        def ev(stage: str, pct: float, detail: str = ""):
            return f"data: {json.dumps({'stage': stage, 'pct': round(pct, 1), 'detail': detail})}\n\n"

        try:
            yield ev("reading", 8, "Reading cached dataset")
            await asyncio.sleep(0.05)
            df, types, key = _sheet(dsid, sheet)
            yield ev("profiling", 24, f"{len(df):,} rows · {len(df.columns)} columns")
            await asyncio.sleep(0.05)
            yield ev("planning", 42, "Scoring chart candidates")
            loop = asyncio.get_running_loop()
            slides = await loop.run_in_executor(None, lambda: planner.plan(df, types, key, limit))
            for i in range(0, len(slides), max(1, len(slides) // 6)):
                yield ev("building", 42 + 50 * (i / max(len(slides), 1)),
                         f"Built {min(i + 1, len(slides))} of {len(slides)} charts")
                await asyncio.sleep(0.04)
            _get(dsid).setdefault("plans", {})[key] = slides
            JOBS[job_id] = {**job, "done": True, "count": len(slides)}
            yield ev("done", 100, f"{len(slides)} charts ready")
        except HTTPException as exc:
            yield f"data: {json.dumps({'stage': 'error', 'pct': 100, 'detail': exc.detail})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'stage': 'error', 'pct': 100, 'detail': str(exc)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --------------------------------------------------------------------------- #
# exports
# --------------------------------------------------------------------------- #
def _slides_for(dsid: str, sheet: str | None, limit: int = 40):
    entry = _get(dsid)
    df, types, key = _sheet(dsid, sheet)
    cached = (entry.get("plans") or {}).get(key)
    slides = cached or planner.plan(df, types, key, limit=limit)
    profile = next((p for p in entry["profile"] if p["name"] == key), entry["profile"][0])
    return entry, slides, planner.dataset_summary(df, types), profile, key


def _attach(data: bytes, filename: str, mime: str) -> Response:
    return Response(content=data, media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/export/{dataset_id}")
def export(dataset_id: str, sheet: str | None = None, format: str = Query("pptx")):
    fmt = format.lower()
    if fmt not in ("pptx", "xlsx", "pdf"):
        _err(400, "format must be pptx, xlsx or pdf.")
    entry, slides, summary, profile, key = _slides_for(dataset_id, sheet)
    stem = f"{Path(entry['name']).stem}-{key}".replace(" ", "-")[:48]
    if fmt == "pptx":
        return _attach(build_pptx(f"{entry['name']} · {key}", summary, slides), f"{stem}.pptx",
                       "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    if fmt == "xlsx":
        return _attach(build_xlsx(f"{entry['name']} · {key}", summary, slides, profile), f"{stem}.xlsx",
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return _attach(build_pdf(f"{entry['name']} · {key}", summary, slides), f"{stem}.pdf", "application/pdf")


@app.get("/api/export/pdf/{dataset_id}")
def export_pdf(dataset_id: str, sheet: str | None = None):
    return export(dataset_id, sheet, "pdf")


@app.get("/api/export/png/{dataset_id}/{slide_id}")
def export_png(dataset_id: str, slide_id: str, sheet: str | None = None):
    _entry, slides, _summary, _profile, _key = _slides_for(dataset_id, sheet)
    slide = next((s for s in slides if s["id"] == slide_id), None)
    if slide is None:
        _err(404, "Slide not found — regenerate the presentation.")
    return _attach(render_slide(slide), f"{slide_id}.png", "image/png")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), log_level="info")
