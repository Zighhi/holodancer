"""Brain surfaces from the skull-stripped T1 -> one GLB for the visuals.
Usage: python make_mesh.py work/brain.npz work/t1.npz <out.glb> [preview.png]
Meshes: "cortex" (grey matter / CSF boundary, the folds) and "white" (white / grey matter boundary).
Vertex colour R = sulcal depth (0 on the gyri crowns, 1 deep in the sulci), used by the shaders.
Coordinates in metres, centred, three.js axes: +X patient left, +Y up, +Z face/front. No face, no skull."""
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

brain_npz, t1_npz, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
preview = Path(sys.argv[4]) if len(sys.argv) > 4 else None
d, t = np.load(brain_npz), np.load(t1_npz)
vol, mask = d["vol"], d["mask"].astype(bool)
o, normal = t["orientation"], t["normal"]

# tissue levels inside the mask: 3-class k-means on intensity (CSF < GM < WM)
vals = vol[mask]
c = np.percentile(vals, [10, 50, 90]).astype(float)
for _ in range(30):
    lab = np.argmin(np.abs(vals[:, None] - c[None]), axis=1)
    c = np.array([vals[lab == k].mean() for k in range(3)])
csf, gm, wm = np.sort(c)
print(f"levels: CSF {csf:.0f}  GM {gm:.0f}  WM {wm:.0f}")

sm = ndimage.gaussian_filter(vol, 0.6)
inner = ndimage.binary_erosion(mask, iterations=1)


def solid(level, fill=True):
    s = (sm > level) & inner
    lab, n = ndimage.label(s)
    s = lab == (1 + int(np.argmax(ndimage.sum(s, lab, range(1, n + 1)))))
    return ndimage.binary_fill_holes(s) if fill else s       # fill = no ventricle surfaces inside


# sulcal depth: distance inside a heavily closed hull of the brain
hull = ndimage.binary_closing(np.pad(mask, 12), iterations=10)[12:-12, 12:-12, 12:-12]
depth = ndimage.distance_transform_edt(hull)

# voxel axes -> patient LPS directions -> three.js (L, S, A)
axes = np.stack([normal, o[3:], o[:3]])                    # axis0, axis1 (rows), axis2 (cols)
to_three = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])     # LPS -> (x=L, y=S, z=A)
M = (to_three @ axes.T)


def surface(seg, tris, name):
    f = ndimage.gaussian_filter(seg.astype(np.float32), 0.7)
    v, fc, _, _ = measure.marching_cubes(f, 0.5)
    m = trimesh.Trimesh(v, fc, process=True)
    m = max(m.split(only_watertight=False), key=lambda x: len(x.faces))
    trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=12)
    if len(m.faces) > tris:
        m = m.simplify_quadric_decimation(face_count=tris)
    idx = np.clip(np.round(m.vertices).astype(int), 0, np.array(depth.shape) - 1)
    dep = depth[idx[:, 0], idx[:, 1], idx[:, 2]]
    dep = np.clip((dep - 1.0) / max(1e-3, np.percentile(dep, 98) - 1.0), 0, 1)
    m.vertices = (m.vertices @ M.T) / 1000.0                   # mm -> m, three.js axes
    if m.volume < 0:                                            # normals must point outwards
        m.invert()
    col = np.zeros((len(dep), 4), np.uint8)
    col[:, 0] = (dep * 255).astype(np.uint8); col[:, 3] = 255
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=col)
    m.metadata["name"] = name
    print(f"{name}: {len(m.vertices)} vertices, {len(m.faces)} triangles")
    return m


cortex = surface(solid(0.5 * (csf + gm)), 260_000, "cortex")
white = surface(solid(0.5 * (gm + wm)), 120_000, "white")
centre = cortex.bounds.mean(axis=0)
for m in (cortex, white):
    m.apply_translation(-centre)
size = cortex.extents * 1000
print(f"size {size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm (width x height x length)")

out.parent.mkdir(parents=True, exist_ok=True)
# the shared frame: make_head.py puts the head and the MRI volume in exactly the same place as these meshes
import json
(out.parent / "frame.json").write_text(json.dumps({"centre_m": centre.tolist(), "M": M.tolist()}))
scene = trimesh.Scene()
scene.add_geometry(cortex, node_name="cortex", geom_name="cortex")
scene.add_geometry(white, node_name="white", geom_name="white")
scene.export(out)
print("glb:", out, f"{out.stat().st_size / 1e6:.1f} MB")

if preview:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    fig, ax = plt.subplots(1, 3, figsize=(15, 5.2), facecolor="black")
    v, f = cortex.vertices, cortex.faces
    for a, (i, j, view, title) in zip(ax, [(2, 1, 0, "left side (from +X)"), (0, 1, 2, "front (from +Z)"),
                                          (0, 2, 1, "top (from +Y)")]):
        n = cortex.face_normals[:, view]
        order = np.argsort(v[f].mean(axis=1)[:, view])           # painter's order, nearest last
        tri = v[f[order]][:, :, [i, j]]
        shade = np.clip(n[order], 0, 1) ** 0.8
        from matplotlib.collections import PolyCollection
        a.add_collection(PolyCollection(tri, facecolors=plt.cm.copper(0.15 + 0.85 * shade), edgecolors="none"))
        a.set_xlim(v[:, i].min(), v[:, i].max()); a.set_ylim(v[:, j].min(), v[:, j].max())
        a.set_aspect("equal"); a.axis("off"); a.set_title(title, color="w")
    fig.tight_layout(); fig.savefig(preview, dpi=80, facecolor="black")
    print("preview:", preview)
