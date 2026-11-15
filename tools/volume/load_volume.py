"""Load one MRI series into a 3D volume (numpy) with real voxel spacing, and save a slice preview.
Usage: python load_volume.py <dicom folder> <series number> <out.npz> [preview.png]
The volume is stored as (z, y, x) in patient order, spacing in mm. No patient data is kept."""
import sys
from pathlib import Path

import numpy as np
import pydicom

folder, series_no, out = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
preview = Path(sys.argv[4]) if len(sys.argv) > 4 else None

slices = []
for f in folder.rglob("*.dcm"):
    ds = pydicom.dcmread(f, stop_before_pixels=True, force=True)
    if int(getattr(ds, "SeriesNumber", -1) or -1) == series_no and "ImagePositionPatient" in ds:
        slices.append(f)
if not slices:
    sys.exit(f"no slices for series {series_no}")

dss = [pydicom.dcmread(f, force=True) for f in slices]
o = np.array(dss[0].ImageOrientationPatient, float)
normal = np.cross(o[:3], o[3:])
dss.sort(key=lambda d: float(np.dot(normal, np.array(d.ImagePositionPatient, float))))
pos = np.array([np.dot(normal, np.array(d.ImagePositionPatient, float)) for d in dss])
dz = float(np.median(np.diff(pos))) if len(pos) > 1 else float(dss[0].SliceThickness)
dy, dx = (float(v) for v in dss[0].PixelSpacing)
vol = np.stack([d.pixel_array.astype(np.float32) * float(getattr(d, "RescaleSlope", 1) or 1)
                + float(getattr(d, "RescaleIntercept", 0) or 0) for d in dss])
np.savez_compressed(out, vol=vol, spacing=np.array([dz, dy, dx]), orientation=o, normal=normal)
print(f"series {series_no}: volume {vol.shape} (slices, rows, cols), spacing {dz:.2f} x {dy:.2f} x {dx:.2f} mm, "
      f"range {vol.min():.0f}..{vol.max():.0f}")

if preview:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(15, 5.2), facecolor="black")
    lo, hi = np.percentile(vol, [1, 99.5])
    views = [vol[vol.shape[0] // 2], vol[:, vol.shape[1] // 2, :], vol[:, :, vol.shape[2] // 2]]
    aspects = [dy / dx, dz / dx, dz / dy]
    for a, v, asp, t in zip(ax, views, aspects, ["middle slice", "across (rows)", "across (cols)"]):
        a.imshow(v, cmap="gray", vmin=lo, vmax=hi, aspect=asp, origin="upper")
        a.set_title(t, color="w"); a.axis("off")
    fig.tight_layout(); fig.savefig(preview, dpi=80, facecolor="black")
    print("preview:", preview)
