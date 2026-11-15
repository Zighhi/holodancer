"""Skull stripping with BET (brainextractor): keeps the brain, removes skull, scalp and face.
Usage: python skullstrip.py work/t1.npz work/brain.npz [preview.png]
Works on a 1 mm copy of the volume for speed; the mask is saved at that resolution together with the 1 mm volume."""
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from brainextractor import BrainExtractor
from scipy import ndimage

src, out = Path(sys.argv[1]), Path(sys.argv[2])
preview = Path(sys.argv[3]) if len(sys.argv) > 3 else None
d = np.load(src)
vol, sp = d["vol"], d["spacing"]

zoom = sp / 1.0                                        # to 1 mm isotropic voxels
v1 = ndimage.zoom(vol, zoom, order=1).astype(np.float32)

# like FSL robustfov: keep only 170 mm below the top of the head (axis 1 runs top -> feet),
# otherwise BET starts too low and swallows the neck
head = (v1 > np.percentile(v1, 60)).any(axis=(0, 2))
top = int(np.argmax(head))
rows = min(v1.shape[1], top + 170)
img = nib.Nifti1Image(np.ascontiguousarray(v1[:, :rows, :]), np.diag([1.0, 1.0, 1.0, 1.0]))
bet = BrainExtractor(img, bt=0.5)
bet.run(iterations=1000)
m = bet.compute_mask()
m = m.get_fdata() if hasattr(m, "get_fdata") else m
mask = np.zeros(v1.shape, bool)
mask[:, :rows, :] = ndimage.binary_fill_holes(m > 0)
print(f"head top at row {top}, BET on rows 0..{rows}")
print(f"1 mm volume {v1.shape}, brain mask {mask.sum() / 1000:.0f} cm3")
np.savez_compressed(out, vol=v1, mask=mask, spacing=np.array([1.0, 1.0, 1.0]))

if preview:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    lo, hi = np.percentile(v1, [1, 99.5])
    fig, ax = plt.subplots(1, 3, figsize=(15, 5.2), facecolor="black")
    for a, i in zip(ax, range(3)):
        sl = [slice(None)] * 3
        sl[i] = v1.shape[i] // 2
        a.imshow(v1[tuple(sl)], cmap="gray", vmin=lo, vmax=hi)
        a.contour(mask[tuple(sl)], levels=[0.5], colors=["#ffc94d"], linewidths=1.2)
        a.axis("off")
    fig.tight_layout(); fig.savefig(preview, dpi=80, facecolor="black")
    print("preview:", preview)
