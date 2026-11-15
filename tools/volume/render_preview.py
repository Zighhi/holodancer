"""Quick software render of the GLB (z-buffered vertex splats, lit by vertex normals) to check the folds.
Usage: python render_preview.py <brain.glb> <out.png> [mesh name]"""
import sys
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

scene = trimesh.load(sys.argv[1])
name = sys.argv[3] if len(sys.argv) > 3 else "cortex"
m = scene.geometry[name]
v, n = m.vertices, m.vertex_normals
dep = m.visual.vertex_colors[:, 0] / 255.0
S = 700
views = [("left side", np.array([1., 0, 0])), ("front", np.array([0., 0, 1])), ("top", np.array([0., 1, 0])),
         ("right side", np.array([-1., 0, 0]))]
fig, ax = plt.subplots(1, 4, figsize=(20, 5.4), facecolor="black")
for a, (title, d) in zip(ax, views):
    up = np.array([0., 0, -1]) if d[1] else np.array([0., 1, 0])
    r = np.cross(up, d); r /= np.linalg.norm(r); u = np.cross(d, r)
    x, y, z = v @ r, v @ u, v @ d
    sc = (S - 20) / max(np.ptp(x), np.ptp(y))
    px = ((x - x.min()) * sc + 10).astype(int); py = (S - 10 - (y - y.min()) * sc).astype(int)
    light = np.clip(n @ (0.6 * d + 0.5 * u + 0.3 * r) / np.linalg.norm(0.6 * d + 0.5 * u + 0.3 * r), 0, 1)
    shade = (0.15 + 0.85 * light) * (1 - 0.6 * dep)
    img = np.zeros((S, S))
    order = np.argsort(-z)                                     # nearest first; keep the first point per pixel
    for dx in (0, 1):
        for dy in (0, 1):
            xx, yy = np.clip(px[order] + dx, 0, S - 1), np.clip(py[order] + dy, 0, S - 1)
            lin, first = np.unique(yy * S + xx, return_index=True)
            img.flat[lin] = np.maximum(img.flat[lin], shade[order][first])
    a.imshow(img, cmap="copper", vmin=0, vmax=1); a.axis("off"); a.set_title(title, color="w")
fig.tight_layout(); fig.savefig(sys.argv[2], dpi=70, facecolor="black")
print("saved", sys.argv[2])
