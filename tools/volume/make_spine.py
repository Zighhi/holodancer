"""The spine MRI -> what the show uses. Usage:
    python make_spine.py <spine DICOM folder> <assets/spine folder> [preview folder]
Reads only pixel data + geometry (no names / IDs), and only the plain T2 anatomy series:
  - the whole-spine sagittal T2 (stitched, "t2_tse_sag_COMP"), 17 slices: spine_sag.bin/.json, an R8 volume at 1 mm
    in plane (x = AP, y = foot -> head, z = the slices, right -> left), for the wall's kundalini scene, the spine inside
    her and the spine stack in the cube
  - the whole-body coronal T2 ("t2_tse_COR_COMP"), cropped above the hips: spine_cor.bin/.json, R8 at 1 mm in plane
    (x = right -> left, y = foot -> head, z = the slices, front -> back), for the torso films
  - the spinal cord's path (canal centre, traced on the sagittal T2): cord.json, points in mm (LPS: x left,
    y back, z up), from the top of the scan down to the sacrum
Medical data: the outputs stay local (app/assets is never in a repo); previews go to the given folder only."""
import json
import sys
from pathlib import Path

import numpy as np
import pydicom
from scipy import ndimage

src, out = Path(sys.argv[1]), Path(sys.argv[2])
prev = Path(sys.argv[3]) if len(sys.argv) > 3 else None
out.mkdir(parents=True, exist_ok=True)


def series(desc):
    """the slices of the series with this exact description: (sorted by position) pixels, positions, spacing, iop"""
    items = []
    for f in src.iterdir():
        if f.suffix.lower() != ".dcm":
            continue
        d = pydicom.dcmread(f, stop_before_pixels=True)
        if str(getattr(d, "SeriesDescription", "")) == desc:
            items.append(f)
    ds = [pydicom.dcmread(f) for f in items]
    iop = np.array(ds[0].ImageOrientationPatient, float)
    normal = np.cross(iop[:3], iop[3:])
    ds.sort(key=lambda d: float(np.dot(np.array(d.ImagePositionPatient, float), normal)))
    pix = np.stack([d.pixel_array.astype(np.float32) for d in ds])
    pos = np.array([d.ImagePositionPatient for d in ds], float)
    return pix, pos, float(ds[0].PixelSpacing[0]), iop


def to_r8(vol, lo_pct=0.5, hi_pct=99.7):
    lo, hi = np.percentile(vol[vol > 0], [lo_pct, hi_pct])
    return np.clip((vol - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- sagittal: rows = down (z-), columns = back (y+)
sag, sag_pos, sp, _ = series("t2_tse_sag_COMP")
sag = ndimage.zoom(sag, (1, sp, sp), order=1)                      # 1 mm in plane
n, H, W = sag.shape
print(f"sagittal: {n} slices, {H} x {W} mm, slices x from {sag_pos[0, 0]:.0f} to {sag_pos[-1, 0]:.0f} mm")
s8 = to_r8(sag)
# the volume for the show: texture x = AP (front -> back), y = foot -> head, z = slices (right -> left)
vol = s8[:, ::-1, :]                                               # rows: foot -> head
(out / "spine_sag.bin").write_bytes(np.ascontiguousarray(vol).tobytes())
top = sag_pos[:, 2].max()
meta = {"dims": [W, H, n], "mm": [W, H, float(sag_pos[-1, 0] - sag_pos[0, 0]) + 3.6], "format": "R8",
        "x_mm": [float(sag_pos[0, 0]), float(sag_pos[-1, 0])], "top_z_mm": float(top), "y0_mm": float(sag_pos[0, 1])}

# ---------------------------------------------------------------- the cord's path: the brightest continuous
# vertical channel (CSF around the cord) between the vertebral bodies and the back, by dynamic programming
mid = n // 2
g = ndimage.gaussian_filter(sag[mid - 1:mid + 2].mean(0), 4)
body = ndimage.gaussian_filter(sag[mid], 3) > np.percentile(sag[mid], 60) * 0.35
back = np.array([np.nonzero(r)[0].max() if r.any() else W - 1 for r in body])   # the back's skin, per row
back = ndimage.median_filter(back, 31)
allowed = np.zeros_like(g, bool)
for r in range(H):
    allowed[r, max(0, back[r] - 130):max(1, back[r] - 25)] = True
score = np.where(allowed, g / g[allowed].max(), -1.0)
acc = score.copy()
arg = np.zeros((H, W), np.int32)
STEP = 1
for r in range(1, H):
    prev_row = acc[r - 1]
    best = np.full(W, -1e9); bi = np.zeros(W, np.int32)
    for d in range(-STEP, STEP + 1):
        sh = np.roll(prev_row, d)
        if d > 0: sh[:d] = -1e9
        if d < 0: sh[d:] = -1e9
        better = sh > best
        best[better] = sh[better]; bi[better] = (np.arange(W) - d)[better]
    acc[r] = score[r] + best
    arg[r] = bi
path = np.zeros(H, int)
path[-1] = int(np.argmax(acc[-1]))
for r in range(H - 1, 0, -1):
    path[r - 1] = arg[r, path[r]]
path = ndimage.gaussian_filter1d(path.astype(float), 10)
# left-right: in each row, the slice where the channel is brightest (smoothed a lot)
xs = sag_pos[:, 0]
colv = np.array([sag[:, r, int(round(path[r]))] for r in range(H)])           # (H, n)
xk = ndimage.gaussian_filter1d((colv ** 4 @ xs) / (colv ** 4).sum(1), 25)
pts = [[float(xk[r]), float(sag_pos[0, 1] + path[r]), float(top - r)] for r in range(0, H, 2)]
(out / "cord.json").write_text(json.dumps({"points_lps_mm": pts, "note": "canal centre, top of scan -> sacrum"}))
(out / "spine_sag.json").write_text(json.dumps(meta))
print(f"cord path: {len(pts)} points, {H} mm long (scan top z = {top:.0f} mm)")

# ---------------------------------------------------------------- coronal: rows = down, columns = left (x+)
cor, cor_pos, cp, _ = series("t2_tse_COR_COMP")
cor = ndimage.zoom(cor, (1, cp, cp), order=1)
cn, CH, CW = cor.shape
crop = int(CH * 0.74)                                              # cut off at the hips
cor = cor[:, :crop, :]
c8 = to_r8(cor)[:, ::-1, :]                                        # rows: foot -> head (from the hips up)
(out / "spine_cor.bin").write_bytes(np.ascontiguousarray(c8).tobytes())
(out / "spine_cor.json").write_text(json.dumps({"dims": [CW, crop, cn], "format": "R8"}))
print(f"coronal: {cn} slices, {CH} x {CW} mm, kept the top {crop} mm")

if prev:
    from PIL import Image, ImageDraw
    im = Image.fromarray(s8[mid]).convert("RGB")
    dr = ImageDraw.Draw(im)
    dr.line([(path[r], r) for r in range(H)], fill=(255, 60, 60), width=2)
    im.save(prev / "spine_cord_check.png")
    Image.fromarray(to_r8(cor)[cn // 2]).save(prev / "spine_cor_check.png")
    print("previews in", prev)
