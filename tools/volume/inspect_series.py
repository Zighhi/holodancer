"""List the MRI series in a DICOM folder - technical fields only (no patient data is printed).
Usage: python inspect_series.py <folder>"""
import sys
from collections import defaultdict
from pathlib import Path

import pydicom

root = Path(sys.argv[1])
series = defaultdict(list)
for f in root.rglob("*"):
    if not f.is_file() or f.suffix.lower() not in (".dcm", ""):
        continue
    try:
        ds = pydicom.dcmread(f, stop_before_pixels=True, force=True)
    except Exception:
        continue
    if "SeriesInstanceUID" not in ds:
        continue
    series[ds.SeriesInstanceUID].append(ds)

rows = []
for uid, items in series.items():
    d = items[0]
    rows.append((
        int(getattr(d, "SeriesNumber", 0) or 0),
        str(getattr(d, "SeriesDescription", "")),
        str(getattr(d, "Modality", "")),
        len(items),
        f"{getattr(d, 'Rows', '?')}x{getattr(d, 'Columns', '?')}",
        "x".join(f"{float(v):.2f}" for v in getattr(d, "PixelSpacing", [])) or "?",
        f"{float(getattr(d, 'SliceThickness', 0) or 0):.2f}",
        str(getattr(d, "MRAcquisitionType", "")),
        str(getattr(d, "ImageType", "")).replace("'", "")[:40],
    ))
rows.sort()
print(f"{'#':>3}  {'description':38} {'mod':4} {'n':>4}  {'matrix':9} {'pixel mm':11} {'slice':6} {'acq':3}  type")
for r in rows:
    print(f"{r[0]:>3}  {r[1][:38]:38} {r[2]:4} {r[3]:>4}  {r[4]:9} {r[5]:11} {r[6]:6} {r[7]:3}  {r[8]}")
