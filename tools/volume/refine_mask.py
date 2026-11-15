"""Clean up the BET mask: cut the leak into the neck / face through narrow bridges.
Usage: python refine_mask.py work/brain.npz work/brain_clean.npz [preview.png] [radius_mm]
Opening (erode -> keep the largest piece -> grow back inside the old mask) removes anything that is only
joined to the brain by a thin neck; then everything below the lowest cerebellum level is cut."""
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

src, out = Path(sys.argv[1]), Path(sys.argv[2])
preview = Path(sys.argv[3]) if len(sys.argv) > 3 else None
r = int(sys.argv[4]) if len(sys.argv) > 4 else 7
d = np.load(src)
vol, mask = d["vol"], d["mask"].astype(bool)
print(f"in: {mask.sum() / 1000:.0f} cm3")


def ball(n):
    z, y, x = np.ogrid[-n:n + 1, -n:n + 1, -n:n + 1]
    return x * x + y * y + z * z <= n * n


def largest(m):
    lab, n = ndimage.label(m)
    if n == 0:
        return m
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


core = largest(ndimage.binary_erosion(mask, ball(r)))
clean = ndimage.binary_dilation(core, ball(r + 1)) & mask
clean = ndimage.binary_fill_holes(largest(clean))

# axis 1 runs head-top -> feet; drop rows whose cross-section shrank to the brainstem/neck only
area = clean.sum(axis=(0, 2)).astype(float)
top = int(np.argmax(area))
cut = next((i for i in range(top, len(area)) if area[i] < 0.08 * area[top]), len(area))
clean[:, cut:, :] = False
clean = largest(clean)
print(f"out: {clean.sum() / 1000:.0f} cm3 (cut below row {cut})")
np.savez_compressed(out, vol=vol, mask=clean, spacing=d["spacing"])

if preview:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    lo, hi = np.percentile(vol, [1, 99.5])
    fig, ax = plt.subplots(1, 3, figsize=(15, 5.2), facecolor="black")
    for a, i in zip(ax, range(3)):
        sl = [slice(None)] * 3
        sl[i] = vol.shape[i] // 2
        a.imshow(vol[tuple(sl)], cmap="gray", vmin=lo, vmax=hi)
        a.contour(mask[tuple(sl)], levels=[0.5], colors=["#ff5050"], linewidths=0.8)
        a.contour(clean[tuple(sl)], levels=[0.5], colors=["#ffc94d"], linewidths=1.4)
        a.axis("off")
    fig.tight_layout(); fig.savefig(preview, dpi=80, facecolor="black")
    print("preview:", preview)
