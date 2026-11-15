"""The whole head from the MRI: skin surface mesh + the MRI as a 3D texture, in the brain's frame (frame.json).
Usage: python make_head.py work/brain.npz <assets/brain folder> [preview.png]
Writes head.glb (skin surface, metres, same frame as brain.glb) and head_volume.bin + head_volume.json:
an RG8 volume in three.js axes (x fastest, then y, then z): R = MRI intensity, G = label (0 air, 128 head, 255 brain).
Medical data with a face: local only, never in a repo or a published page."""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage
from skimage import filters, measure

src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
preview = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
d = np.load(src)
vol, brain = d["vol"], d["mask"].astype(bool)
frame = json.loads((outdir / "frame.json").read_text())
M, centre = np.array(frame["M"]), np.array(frame["centre_m"])

# ---- head mask: everything clearly above the background noise, holes filled (airways, sinuses, the dark skull)
t = filters.threshold_otsu(vol[vol > np.percentile(vol, 5)]) * 0.45
head = ndimage.binary_opening(vol > t, iterations=2)


def largest(m):
    lab, n = ndimage.label(m)
    return lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1))))) if n else m


def ball(n):
    z, y, x = np.ogrid[-n:n + 1, -n:n + 1, -n:n + 1]
    return x * x + y * y + z * z <= n * n


head = ndimage.binary_closing(largest(head), iterations=3)
for r in range(head.shape[1]):                     # axis 1 = top -> feet: fill every axial slice (nose, mouth)
    head[:, r, :] = ndimage.binary_fill_holes(head[:, r, :])
head = ndimage.binary_fill_holes(head) | brain
# thin things sticking out (the scanner's ear tubes, skin markers): only the parts outside the head's main body are
# tested for thinness, so the thin scalp itself is never touched; the ears are thick enough to stay
rod = int(sys.argv[4]) if len(sys.argv) > 4 else 2
core = ndimage.binary_opening(head, ball(6))
extra = head & ~core
head = largest(core | ndimage.binary_opening(extra, ball(rod)))
print(f"head threshold {t:.0f}, head {head.sum() / 1000:.0f} cm3")

# ---- skin surface
f = ndimage.gaussian_filter(np.pad(head, 2).astype(np.float32), 1.0)
v, fc, _, _ = measure.marching_cubes(f, 0.5)
v -= 2
m = trimesh.Trimesh(v, fc, process=True)
m = max(m.split(only_watertight=False), key=lambda x: len(x.faces))
trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=15)
m = m.simplify_quadric_decimation(face_count=160_000)
m.vertices = (m.vertices @ M.T) / 1000.0 - centre
if m.volume < 0:                                            # normals must point outwards
    m.invert()
m.metadata["name"] = "head"
size = m.extents * 1000
print(f"head mesh: {len(m.vertices)} vertices, {len(m.faces)} triangles, {size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm")
scene = trimesh.Scene()
scene.add_geometry(m, node_name="head", geom_name="head")
scene.export(outdir / "head.glb")

# ---- the MRI volume, resampled at 1 mm onto a grid aligned with the three.js axes
lo_m, hi_m = m.bounds[0] - 0.004, m.bounds[1] + 0.004              # head box in the brain frame, metres
p0 = (lo_m + centre) * 1000.0                                       # its corner in voxel-space-mm (three axes)
dims = np.ceil((hi_m - lo_m) * 1000.0).astype(int)                  # x, y, z sizes in mm
Minv = np.linalg.inv(M)
P = np.array([[0, 0, 1], [0, 1, 0], [1, 0, 0]], float)             # output index (z, y, x) -> (x, y, z)
shape = (dims[2], dims[1], dims[0])
mat, off = Minv @ P, Minv @ p0
inten = ndimage.affine_transform(vol, mat, offset=off, output_shape=shape, order=1)
lab = (ndimage.affine_transform(head.astype(np.float32), mat, offset=off, output_shape=shape, order=1) > 0.5).astype(np.uint8) * 128
lab[ndimage.affine_transform(brain.astype(np.float32), mat, offset=off, output_shape=shape, order=1) > 0.5] = 255
hi = np.percentile(inten[lab > 0], 99.5)
r8 = np.clip(inten / hi * 255, 0, 255).astype(np.uint8)
rg = np.stack([r8, lab], axis=-1)                                   # (z, y, x, 2) -> x fastest in memory
(outdir / "head_volume.bin").write_bytes(np.ascontiguousarray(rg).tobytes())
meta = {"dims": [int(x) for x in dims], "min": lo_m.tolist(), "size": (dims / 1000.0).tolist(), "format": "RG8"}
(outdir / "head_volume.json").write_text(json.dumps(meta))
print(f"volume {dims[0]} x {dims[1]} x {dims[2]} (x, y, z), {rg.nbytes / 1e6:.1f} MB")

if preview:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2, 3, figsize=(15, 10), facecolor="black")
    zc, yc, xc = shape[0] // 2, shape[1] // 2, shape[2] // 2
    sl = [(r8[:, :, xc], lab[:, :, xc], "sagittal (x = mid): z vs y"), (r8[zc], lab[zc], "coronal (z = mid): y vs x"),
          (r8[:, yc + 20, :], lab[:, yc + 20, :], "axial (y above mid): z vs x")]
    for i, (img, lb, title) in enumerate(sl):
        ax[0, i].imshow(img, cmap="gray", origin="lower"); ax[0, i].set_title(title, color="w")
        ax[1, i].imshow(lb, cmap="magma", origin="lower")
        for a in ax[:, i]: a.axis("off")
    fig.tight_layout(); fig.savefig(preview, dpi=60, facecolor="black")
    print("preview:", preview)
