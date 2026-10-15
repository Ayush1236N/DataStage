"""Parsing + profiling: turn any uploaded file into typed sheets of tabular data."""
from __future__ import annotations

import io
import json
import re
import math
from typing import Any

import numpy as np
import pandas as pd

MAX_BYTES = 50 * 1024 * 1024
NUM, CAT, DATE, TEXT, BOOL = "numeric", "categorical", "datetime", "text", "boolean"

ALLOWED_EXT = {".xlsx", ".xlsm", ".xls", ".csv", ".tsv", ".txt", ".json", ".docx"}


class ParseError(Exception):
    """Raised for user-fixable problems (bad file type, unreadable content)."""


# --------------------------------------------------------------------------- #
# type inference
# --------------------------------------------------------------------------- #
_TRUEY = {"true", "false", "yes", "no", "y", "n", "t", "f", "0", "1"}


def infer_type(s: pd.Series) -> str:
    s = s.dropna()
    if s.empty:
        return TEXT
    if pd.api.types.is_bool_dtype(s):
        return BOOL
    if pd.api.types.is_datetime64_any_dtype(s):
        return DATE
    if pd.api.types.is_numeric_dtype(s):
        # integer-coded categories with very few levels behave better as categories
        n_uniq = s.nunique()
        if n_uniq <= 2 and set(pd.unique(s.astype(str))) <= {"0", "1", "0.0", "1.0"}:
            return BOOL
        return NUM
    vals = s.astype(str).str.strip()
    low = vals.str.lower()
    if low.nunique() <= 2 and set(low.unique()) <= _TRUEY:
        return BOOL
    # numeric strings ("1,240", "$32.10", "12%")
    cleaned = vals.str.replace(r"[,$€£%\s]", "", regex=True)
    num = pd.to_numeric(cleaned, errors="coerce")
    if num.notna().mean() > 0.9:
        return NUM
    if _looks_datelike(vals):
        dt = _to_datetime(vals)
        if dt.notna().mean() > 0.85:
            return DATE
    n_uniq = vals.nunique()
    if n_uniq <= max(25, 0.35 * len(vals)) and vals.str.len().mean() < 40:
        return CAT
    return TEXT


_DATE_RE = re.compile(r"^\s*\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?|^\s*\d{4}(?:-\d{2})?$|^[A-Z][a-z]{2}\s+\d")


def _looks_datelike(vals: pd.Series) -> bool:
    head = vals.head(50)
    return bool(head.str.contains(_DATE_RE).mean() > 0.6)


def _to_datetime(vals: pd.Series) -> pd.Series:
    try:
        return pd.to_datetime(vals, errors="coerce", format="mixed", dayfirst=False)
    except Exception:
        try:
            return pd.to_datetime(vals, errors="coerce")
        except Exception:
            return pd.Series([pd.NaT] * len(vals), index=vals.index)


def coerce(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
    """Return a cleaned dataframe plus {column: type}."""
    df = df.copy()
    df.columns = [_clean_col(c, i) for i, c in enumerate(df.columns)]
    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    types: dict[str, str] = {}
    for col in df.columns:
        t = infer_type(df[col])
        if t == NUM and not pd.api.types.is_numeric_dtype(df[col]):
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(r"[,$€£%\s]", "", regex=True), errors="coerce"
            )
        elif t == DATE and not pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = _to_datetime(df[col].astype(str))
        elif t == BOOL and not pd.api.types.is_bool_dtype(df[col]):
            mapping = {"true": True, "yes": True, "y": True, "t": True, "1": True, "1.0": True,
                       "false": False, "no": False, "n": False, "f": False, "0": False, "0.0": False}
            df[col] = df[col].astype(str).str.strip().str.lower().map(mapping)
        elif t in (CAT, TEXT):
            df[col] = df[col].astype("object").where(df[col].notna(), None)
        types[col] = t
    return df.reset_index(drop=True), types


def _clean_col(c: Any, i: int) -> str:
    name = str(c).strip() if c is not None else ""
    if not name or name.lower().startswith("unnamed"):
        name = f"column_{i + 1}"
    return re.sub(r"\s+", " ", name)


def _safe(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (pd.Timestamp,)):
        return None if pd.isna(v) else v.isoformat()
    if v is pd.NaT:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return str(v) if not isinstance(v, (int, str)) else v


def profile_sheet(name: str, df: pd.DataFrame, types: dict[str, str]) -> dict:
    cols = []
    for c in df.columns:
        s = df[c]
        t = types[c]
        entry: dict[str, Any] = {
            "name": c,
            "type": t,
            "unique": int(s.nunique(dropna=True)),
            "nulls": int(s.isna().sum()),
            "sample": [_safe(v) for v in s.dropna().head(4).tolist()],
        }
        if t == NUM:
            sn = pd.to_numeric(s, errors="coerce").dropna()
            if len(sn):
                entry |= {
                    "min": _safe(sn.min()), "max": _safe(sn.max()),
                    "mean": _safe(sn.mean()), "std": _safe(sn.std()),
                    "sum": _safe(sn.sum()),
                }
        elif t == DATE:
            sd = pd.to_datetime(s, errors="coerce").dropna()
            if len(sd):
                entry |= {"min": _safe(sd.min()), "max": _safe(sd.max())}
        elif t in (CAT, BOOL, TEXT):
            vc = s.astype(str).value_counts().head(6)
            entry["top"] = [{"value": str(k), "count": int(v)} for k, v in vc.items()]
        cols.append(entry)
    return {"name": name, "rows": int(len(df)), "columns": cols}


def rows_payload(df: pd.DataFrame, offset: int = 0, limit: int = 200) -> dict:
    sub = df.iloc[offset: offset + limit]
    return {
        "columns": list(df.columns),
        "rows": [[_safe(v) for v in row] for row in sub.itertuples(index=False, name=None)],
        "total": int(len(df)),
        "offset": offset,
    }


# --------------------------------------------------------------------------- #
# readers
# --------------------------------------------------------------------------- #
def read_any(filename: str, raw: bytes) -> dict[str, pd.DataFrame]:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXT:
        raise ParseError(
            f"Unsupported file type '{ext or filename}'. Use xlsx, xls, csv, tsv, json or docx."
        )
    if len(raw) > MAX_BYTES:
        raise ParseError("File is larger than the 50 MB limit.")
    if not raw:
        raise ParseError("The uploaded file is empty.")
    try:
        if ext in (".xlsx", ".xlsm", ".xls"):
            return _read_excel(raw, ext)
        if ext in (".csv", ".tsv", ".txt"):
            return _read_delim(raw, ext)
        if ext == ".json":
            return _read_json(raw)
        if ext == ".docx":
            return _read_docx(raw)
    except ParseError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ParseError(f"Could not parse {filename}: {exc}") from exc
    raise ParseError("Unsupported file.")


def _read_excel(raw: bytes, ext: str) -> dict[str, pd.DataFrame]:
    engine = "openpyxl" if ext != ".xls" else None
    book = pd.read_excel(io.BytesIO(raw), sheet_name=None, engine=engine)
    out: dict[str, pd.DataFrame] = {}
    for name, df in book.items():
        df = _promote_header(df)
        if df.empty or not len(df.columns):
            continue
        out[str(name)[:40]] = df
    if not out:
        raise ParseError("The workbook has no readable sheets with data.")
    return out


def _promote_header(df: pd.DataFrame) -> pd.DataFrame:
    """If a spreadsheet has title rows above the header, find the real header row."""
    if df.empty:
        return df
    unnamed = sum(1 for c in df.columns if str(c).lower().startswith("unnamed"))
    if unnamed <= len(df.columns) / 2:
        return df
    for i in range(min(6, len(df))):
        row = df.iloc[i]
        filled = row.notna().sum()
        if filled >= max(2, int(0.6 * len(df.columns))):
            new = df.iloc[i + 1:].copy()
            new.columns = [str(v) if pd.notna(v) else f"column_{j+1}" for j, v in enumerate(row)]
            return new.reset_index(drop=True)
    return df


def _read_delim(raw: bytes, ext: str) -> dict[str, pd.DataFrame]:
    text = raw.decode("utf-8-sig", errors="replace")
    sep = "\t" if ext == ".tsv" else None
    df = pd.read_csv(
        io.StringIO(text), sep=sep, engine="python", skip_blank_lines=True,
        on_bad_lines="skip",
    )
    if df.empty:
        raise ParseError("No rows found in the delimited file.")
    return {"Data": _promote_header(df)}


def _read_json(raw: bytes) -> dict[str, pd.DataFrame]:
    data = json.loads(raw.decode("utf-8-sig", errors="replace"))
    out: dict[str, pd.DataFrame] = {}
    if isinstance(data, list):
        out["Data"] = pd.json_normalize(data)
    elif isinstance(data, dict):
        table_keys = [k for k, v in data.items() if isinstance(v, list) and v and isinstance(v[0], dict)]
        if table_keys:
            for k in table_keys:
                out[str(k)[:40]] = pd.json_normalize(data[k])
        else:
            out["Data"] = pd.json_normalize(data)
    if not out or all(df.empty for df in out.values()):
        raise ParseError("The JSON file contains no tabular records.")
    return {k: v for k, v in out.items() if not v.empty}


def _read_docx(raw: bytes) -> dict[str, pd.DataFrame]:
    from docx import Document

    doc = Document(io.BytesIO(raw))
    out: dict[str, pd.DataFrame] = {}
    for i, table in enumerate(doc.tables):
        grid = [[cell.text.strip() for cell in row.cells] for row in table.rows]
        grid = [r for r in grid if any(c for c in r)]
        if len(grid) < 2:
            continue
        header, *body = grid
        width = max(len(r) for r in grid)
        header = (header + [""] * width)[:width]
        body = [(r + [""] * width)[:width] for r in body]
        df = pd.DataFrame(body, columns=[h or f"column_{j+1}" for j, h in enumerate(header)])
        out[_docx_table_name(doc, table, i)] = df
    metrics = _docx_paragraph_metrics(doc)
    if metrics is not None:
        out["Narrative metrics"] = metrics
    if not out:
        raise ParseError("No tables or numeric statements found in the Word document.")
    return out


def _docx_table_name(doc, table, i: int) -> str:
    """Use the nearest preceding heading/caption as the sheet name."""
    try:
        texts = {p._element: p.text.strip() for p in doc.paragraphs}
        body = list(doc.element.body)
        idx = body.index(table._element)
        for el in reversed(body[:idx]):
            text = texts.get(el, "").strip()
            if 2 < len(text) < 60:
                return text[:40]
    except Exception:  # noqa: BLE001
        pass
    return f"Table {i + 1}"


_METRIC_RE = re.compile(
    r"([A-Za-z][A-Za-z /&'\-]{2,40}?)\s+(?:was|were|is|are|at|of|reached|hit|grew to|totalled|totaled)\s+"
    r"([$€£]?\s*-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|\b(?:k|m|bn|b|million|billion)\b)?(?![\w.])",
    re.IGNORECASE,
)


def _docx_paragraph_metrics(doc) -> pd.DataFrame | None:
    rows = []
    for p in doc.paragraphs:
        text = p.text.strip()
        if not text or len(text) > 400:
            continue
        for m in _METRIC_RE.finditer(text):
            label = re.sub(r"\s+", " ", m.group(1)).strip(" .,:")
            label = re.sub(r"^(and|but|the|a|an|while|with|our|its)\s+", "", label, flags=re.I).title()
            if len(label) < 3:
                continue
            num = m.group(2).replace(",", "").replace("$", "").replace("€", "").replace("£", "").strip()
            try:
                val = float(num)
            except ValueError:
                continue
            unit = (m.group(3) or "").lower()
            scale = {"k": 1e3, "m": 1e6, "million": 1e6, "bn": 1e9, "b": 1e9, "billion": 1e9}.get(unit)
            if scale:
                val *= scale
            rows.append({"metric": label, "value": val,
                         "unit": "percent" if unit in ("%", "percent") else "count"})
    if len(rows) < 3:
        return None
    df = pd.DataFrame(rows).drop_duplicates(subset=["metric"], keep="first")
    return df if len(df) >= 3 else None
