"""Generate the three realistic sample files shipped in /samples."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "samples"
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(20260822)

REGIONS = ["North", "South", "East", "West", "Central"]
CATEGORIES = ["Espresso machines", "Grinders", "Beans", "Accessories", "Subscriptions"]
CHANNELS = ["Retail", "Online", "Wholesale"]
STORES = [f"S-{i:02d}" for i in range(1, 13)]


def sales_workbook() -> None:
    n = 2600
    dates = pd.to_datetime("2024-07-01") + pd.to_timedelta(rng.integers(0, 730, n), unit="D")
    cat = rng.choice(CATEGORIES, n, p=[0.14, 0.17, 0.34, 0.24, 0.11])
    region = rng.choice(REGIONS, n, p=[0.26, 0.2, 0.18, 0.22, 0.14])
    channel = rng.choice(CHANNELS, n, p=[0.45, 0.42, 0.13])
    base = {"Espresso machines": 780, "Grinders": 240, "Beans": 26, "Accessories": 42,
            "Subscriptions": 120}
    unit = np.array([base[c] for c in cat]) * rng.normal(1, 0.16, n).clip(0.55, 1.9)
    qty = rng.integers(1, 9, n) + (cat == "Beans") * rng.integers(0, 14, n)
    season = 1 + 0.22 * np.sin((dates.dayofyear / 365) * 2 * np.pi - 1.1)
    growth = 1 + 0.00042 * (dates - dates.min()).days
    revenue = (unit * qty * season * growth).round(2)
    discount = (rng.beta(2, 12, n) * 0.35).round(3)
    margin = (revenue * rng.normal(0.38, 0.07, n).clip(0.08, 0.66) * (1 - discount)).round(2)
    tx = pd.DataFrame({
        "order_date": dates,
        "store_id": rng.choice(STORES, n),
        "region": region,
        "channel": channel,
        "category": cat,
        "units": qty,
        "unit_price": unit.round(2),
        "discount_rate": discount,
        "revenue": revenue,
        "gross_margin": margin,
        "satisfaction": rng.normal(4.2, 0.55, n).clip(1, 5).round(2),
        "repeat_customer": rng.random(n) < 0.46,
    }).sort_values("order_date")

    months = pd.date_range("2024-07-01", "2026-06-01", freq="MS")
    targets = pd.DataFrame([
        {"month": m, "region": r, "revenue_target": round(float(np.clip(rng.normal(52000, 9000), 28000, 90000)), 2),
         "units_target": int(rng.integers(700, 2200))}
        for m in months for r in REGIONS
    ])

    roster = pd.DataFrame({
        "store_id": STORES,
        "region": rng.choice(REGIONS, len(STORES)),
        "opened": pd.to_datetime("2018-01-01") + pd.to_timedelta(rng.integers(0, 2400, len(STORES)), unit="D"),
        "floor_sqm": rng.integers(48, 320, len(STORES)),
        "staff": rng.integers(3, 19, len(STORES)),
        "footfall_daily": rng.integers(120, 1400, len(STORES)),
        "nps": rng.integers(-10, 78, len(STORES)),
    })

    path = OUT / "sales.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as xl:
        tx.to_excel(xl, sheet_name="Transactions", index=False)
        targets.to_excel(xl, sheet_name="Targets", index=False)
        roster.to_excel(xl, sheet_name="Stores", index=False)
    print("wrote", path, len(tx), "rows")


COMMENTS = [
    "The onboarding flow was smooth but the export step felt slow.",
    "Love the dashboard speed; charts render instantly on my laptop.",
    "Pricing is confusing compared to competitors, needs clearer tiers.",
    "Support answered within an hour and solved my import problem.",
    "Mobile layout breaks on my tablet when I rotate the screen.",
    "The template gallery saves me hours every single week.",
    "Would pay more for scheduled reports and Slack delivery.",
    "Too many clicks to share a report with my finance team.",
    "Colour palettes look professional in client presentations.",
    "Sync with our warehouse failed twice this month, frustrating.",
]


def survey_csv() -> None:
    n = 1200
    seg = rng.choice(["Startup", "SMB", "Mid-market", "Enterprise"], n, p=[0.3, 0.31, 0.24, 0.15])
    role = rng.choice(["Analyst", "Manager", "Director", "Executive", "Engineer"], n)
    tenure = rng.integers(1, 61, n)
    sat = (rng.normal({"Startup": 7.4, "SMB": 7.8, "Mid-market": 8.1, "Enterprise": 7.1}
                      .get("SMB", 7.6), 1.4, n) + (seg == "Mid-market") * 0.5).clip(1, 10).round(1)
    nps = (sat * 1.1 + rng.normal(0, 1.4, n) - 2).clip(0, 10).round(0)
    df = pd.DataFrame({
        "response_id": [f"R{i:05d}" for i in range(1, n + 1)],
        "submitted_at": (pd.to_datetime("2026-01-05") +
                         pd.to_timedelta(rng.integers(0, 210, n), unit="D")).strftime("%Y-%m-%d"),
        "segment": seg,
        "role": role,
        "country": rng.choice(["US", "UK", "DE", "IN", "BR", "AU", "CA"], n,
                              p=[0.31, 0.14, 0.12, 0.18, 0.08, 0.07, 0.10]),
        "tenure_months": tenure,
        "seats": rng.integers(1, 320, n),
        "monthly_spend_usd": (rng.lognormal(5.4, 0.7, n)).round(2),
        "satisfaction_score": sat,
        "nps_score": nps.astype(int),
        "weekly_sessions": rng.poisson(9, n) + 1,
        "features_used": rng.integers(1, 15, n),
        "renewed": rng.random(n) < 0.78,
        "comment": rng.choice(COMMENTS, n),
    })
    path = OUT / "survey.csv"
    df.to_csv(path, index=False)
    print("wrote", path, len(df), "rows")


def report_docx() -> None:
    from docx import Document
    from docx.shared import Pt

    doc = Document()
    doc.add_heading("Northwind Coffee — Q2 FY2026 Operating Review", level=0)
    doc.add_paragraph(
        "Group revenue was 4,812,450 for the quarter, up from the prior period, while gross margin "
        "reached 38.4 percent. Online orders were 128,940 and average basket value was 41.75. "
        "Churn was 3.2 percent, customer satisfaction was 4.31 and net promoter score was 46. "
        "Marketing spend was 412,000 with a blended CAC of 38.90."
    )

    doc.add_heading("Revenue by region", level=1)
    t = doc.add_table(rows=1, cols=5)
    t.style = "Light Grid Accent 1"
    for i, h in enumerate(["Region", "Revenue", "Units", "Margin %", "Stores"]):
        t.rows[0].cells[i].text = h
    region_rows = [
        ("North", 1284300, 41250, 39.1, 4),
        ("South", 942180, 33110, 36.4, 3),
        ("East", 786940, 27980, 35.2, 2),
        ("West", 1104620, 36740, 40.8, 3),
        ("Central", 694410, 22860, 33.9, 2),
    ]
    for r in region_rows:
        cells = t.add_row().cells
        for i, v in enumerate(r):
            cells[i].text = f"{v:,}" if isinstance(v, int) else str(v)

    doc.add_heading("Monthly performance", level=1)
    t2 = doc.add_table(rows=1, cols=5)
    t2.style = "Light Grid Accent 1"
    for i, h in enumerate(["Month", "Revenue", "Orders", "Avg basket", "Returns"]):
        t2.rows[0].cells[i].text = h
    monthly = [
        ("2026-01", 1421900, 34120, 41.67, 812),
        ("2026-02", 1388240, 33010, 42.05, 774),
        ("2026-03", 1502310, 35890, 41.86, 903),
        ("2026-04", 1610480, 38240, 42.11, 941),
        ("2026-05", 1584720, 37460, 42.30, 887),
        ("2026-06", 1717050, 40120, 42.79, 968),
    ]
    for r in monthly:
        cells = t2.add_row().cells
        for i, v in enumerate(r):
            cells[i].text = f"{v:,}" if isinstance(v, int) else str(v)

    doc.add_heading("Product mix", level=1)
    t3 = doc.add_table(rows=1, cols=4)
    t3.style = "Light Grid Accent 1"
    for i, h in enumerate(["Category", "Revenue", "Attach rate", "Repeat rate"]):
        t3.rows[0].cells[i].text = h
    mix = [
        ("Espresso machines", 1420900, 0.18, 0.24),
        ("Grinders", 684210, 0.31, 0.29),
        ("Beans", 1584730, 0.62, 0.71),
        ("Accessories", 612480, 0.44, 0.38),
        ("Subscriptions", 510130, 0.12, 0.83),
    ]
    for r in mix:
        cells = t3.add_row().cells
        for i, v in enumerate(r):
            cells[i].text = f"{v:,}" if isinstance(v, int) else str(v)

    doc.add_paragraph(
        "Outlook: subscription attach rate is expected at 15 percent by Q4, wholesale pipeline is "
        "1,240,000 and headcount is 318."
    ).runs[0].font.size = Pt(10)
    path = OUT / "report.docx"
    doc.save(path)
    print("wrote", path)


if __name__ == "__main__":
    sales_workbook()
    survey_csv()
    report_docx()
