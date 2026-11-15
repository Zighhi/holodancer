"""Simulate what viewers see: a virtual cube shown in the Pepper's cone inside the KALLAX top-row cube.

1. For the DESIGN viewpoint (1.5 m away, eye 1.60 m) trace each eye ray to the cone, reflect it to the panel and
   store there the colour of the virtual cube along that ray -> the warped image the panel shows.
2. For other viewpoints, trace their eye rays: reflection off the cone (PETG Fresnel, ~10 %) shows the panel image,
   and rays passing through the clear cone also see the panel DIRECTLY (that light is ~10x brighter).
3. Optional louvered privacy film on the panel: passes near-vertical light (to the cone), blocks oblique light
   (to the crowd) along the panel's long axis.
Run: python simulate_view.py -> diagrams/6-panel-image.png, diagrams/7-viewer-sim.png
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# geometry (mm), same as diagrams.py; cone coordinates: y up from the screen, cone axis = y axis, crowd on +z
THETA, B, H = 30.0, 8.0, 240.0
T = np.tan(np.radians(THETA))
R_TOP = B + H * T
P_LONG, P_SHORT, NZ, NX = 344.16, 193.59, 1920, 1080
PITCH = P_LONG / NZ
GAP, AXIS_BACK = 21.4, 200.0            # opening -> pixels; pixel front edge -> cone axis
FLOOR, STACK, CW, CH = 390.0, 25.0, 335.0, 335.0
ROOF = CH - STACK
Z_PFRONT = AXIS_BACK                    # pixel area front edge (cone coords)
Z_OPEN = Z_PFRONT + GAP
N_PETG = 1.57
DESIGN = (1500.0, 1600.0, 0.0)          # distance from the opening, eye height, sideways offset
OUT = Path(__file__).with_name("diagrams")


def eye(dist, eye_h, side=0.0):
    return np.array([side, eye_h - FLOOR - STACK, Z_OPEN + dist])


def rays(E, n, half_fov_deg, tgt=(0.0, H * 0.45, 0.0)):
    tgt = np.array(tgt)
    fwd = (tgt - E) / np.linalg.norm(tgt - E)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    a = np.tan(np.radians(half_fov_deg)) * np.linspace(-1, 1, n)
    U, V = np.meshgrid(a, a[::-1])
    D = fwd + U[..., None] * right + V[..., None] * up
    return D / np.linalg.norm(D, axis=-1, keepdims=True)


def cone_hits(E, D):
    """Both intersections with the cone wall (0 <= y <= H); np.inf where missing. Sorted s1 <= s2."""
    dx, dy, dz = D[..., 0], D[..., 1], D[..., 2]
    ex, ey, ez = E
    A = dx**2 + dz**2 - (dy * T) ** 2
    Bq = 2 * (ex * dx + ez * dz - (B + ey * T) * dy * T)
    C = ex**2 + ez**2 - (B + ey * T) ** 2
    disc = Bq**2 - 4 * A * C
    sq = np.sqrt(np.clip(disc, 0, None))
    out = []
    with np.errstate(invalid="ignore", divide="ignore"):
        for s in ((-Bq - sq) / (2 * A), (-Bq + sq) / (2 * A)):
            y = ey + s * dy
            out.append(np.where((disc > 0) & (s > 1e-6) & (y >= 0) & (y <= H), s, np.inf))
    return np.minimum(*out), np.maximum(*out)


def normal(P):
    r = np.hypot(P[..., 0], P[..., 2]) + 1e-9
    N = np.stack([P[..., 0] / r, -T * np.ones_like(r), P[..., 2] / r], -1)
    return N / np.linalg.norm(N, axis=-1, keepdims=True)


def fresnel_sheet(cos_i):
    """Reflectance of a thin clear sheet (both faces, incoherent), unpolarised."""
    cos_i = np.clip(np.abs(cos_i), 1e-4, 1)
    sin_t = np.sqrt(1 - cos_i**2) / N_PETG
    cos_t = np.sqrt(np.clip(1 - sin_t**2, 0, 1))
    rs = ((cos_i - N_PETG * cos_t) / (cos_i + N_PETG * cos_t)) ** 2
    rp = ((N_PETG * cos_i - cos_t) / (N_PETG * cos_i + cos_t)) ** 2
    r = 0.5 * (rs + rp)
    return 2 * r / (1 + r)


def to_pixel(L):
    """Panel pixel indices for landing points L (cone coords) + validity mask."""
    iz = np.floor((Z_PFRONT - L[..., 2]) / PITCH).astype(int)          # 0 = front edge (crowd side)
    ix = np.floor((L[..., 0] + P_SHORT / 2) / PITCH).astype(int)
    ok = (iz >= 0) & (iz < NZ) & (ix >= 0) & (ix < NX)
    return np.clip(iz, 0, NZ - 1), np.clip(ix, 0, NX - 1), ok


def privacy(dirs, cutoff_deg=40.0, base=0.7):
    """Louver film transmission for light leaving the panel along `dirs` (pointing away from the panel)."""
    phi_tan = np.abs(dirs[..., 2]) / np.maximum(np.abs(dirs[..., 1]), 1e-6)
    return base * np.clip(1 - phi_tan / np.tan(np.radians(cutoff_deg)), 0, 1)


# ------------------------------------------------------------------ virtual object: a lit cube with glowing edges
def make_object(E0):
    D = rays(E0, 900, 12)
    s1, _ = cone_hits(E0, D)
    P = E0 + np.where(np.isfinite(s1), s1, 0)[..., None] * D
    N = normal(P)
    R = D - 2 * np.sum(D * N, -1, keepdims=True) * N
    k = -P[..., 1] / np.where(R[..., 1] < 0, R[..., 1], -1)
    _, _, ok = to_pixel(P + k[..., None] * R)
    vis = np.isfinite(s1) & (np.sum(D * N, -1) < 0) & (R[..., 1] < 0) & ok
    # place the cube where the visible image region is: centroid of the region, at the cone axis depth
    pts = P[vis]
    c = np.array([0.0, np.percentile(pts[:, 1], 42), 0.0])
    height = np.percentile(pts[:, 1], 95) - np.percentile(pts[:, 1], 5)
    width = np.percentile(pts[:, 0], 95) - np.percentile(pts[:, 0], 5)
    half = 0.36 * min(height, width * 1.2)
    a, b = np.radians(35), np.radians(20)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return c, half, Ry @ Rx


def shade_object(E, D, obj):
    c, half, Rm = obj
    o = (E - c) @ Rm                     # into the cube's local frame
    d = D @ Rm
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (-half - o) / d; t2 = (half - o) / d
    tmin = np.nanmax(np.minimum(t1, t2), -1); tmax = np.nanmin(np.maximum(t1, t2), -1)
    hit = (tmax >= tmin) & (tmax > 0)
    p = o + tmin[..., None] * d
    ap = np.abs(p) / half
    face = np.argmax(ap, -1)
    n_local = np.zeros_like(p); np.put_along_axis(n_local, face[..., None], np.sign(np.take_along_axis(p, face[..., None], -1)), -1)
    light = np.array([0.4, 0.8, 0.5]) @ Rm
    light /= np.linalg.norm(light)
    lam = np.clip(n_local @ light, 0, 1)
    face_cols = np.array([[0.0, 0.85, 1.0], [1.0, 0.2, 0.8], [0.4, 0.3, 1.0]])
    col = (0.25 + 0.75 * lam)[..., None] * face_cols[face]
    edge = (np.sort(ap, -1)[..., 1] > 0.9)          # two coordinates near the surface -> on an edge
    col = np.where(edge[..., None], 1.0, col)
    return np.where(hit[..., None], col, 0.0)


def panel_image(E0, obj):
    img = np.zeros((NZ, NX, 3)); cov = np.zeros((NZ, NX), bool)
    for half_fov, n in ((12, 2400),):
        D = rays(E0, n, half_fov)
        s1, _ = cone_hits(E0, D)
        P = E0 + np.where(np.isfinite(s1), s1, 0)[..., None] * D
        N = normal(P)
        R = D - 2 * np.sum(D * N, -1, keepdims=True) * N
        k = -P[..., 1] / np.where(R[..., 1] < 0, R[..., 1], -1)
        iz, ix, ok = to_pixel(P + k[..., None] * R)
        vis = np.isfinite(s1) & (np.sum(D * N, -1) < 0) & (R[..., 1] < 0) & ok
        col = shade_object(E0, D, obj)
        img[iz[vis], ix[vis]] = col[vis]; cov[iz[vis], ix[vis]] = True
    for _ in range(6):                               # fill small holes between splatted samples
        acc = np.zeros_like(img); cnt = np.zeros((NZ, NX))
        for dz in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(img * cov[..., None], dz, 0), dx, 1)
                cnt += np.roll(np.roll(cov, dz, 0), dx, 1)
        fill = ~cov & (cnt > 0)
        img[fill] = acc[fill] / cnt[fill, None]; cov |= fill
    return img


def view(E, img, n=520, film=False, half_fov=9, parts=("refl", "direct")):
    D = rays(E, n, half_fov)
    out = np.zeros(D.shape)
    # KALLAX front: rays above the roof or beside the walls at the opening plane see the shelf (dim grey)
    so = (Z_OPEN - E[2]) / D[..., 2]
    yo, xo = E[1] + so * D[..., 1], E[0] + so * D[..., 0]
    inside = (yo < ROOF) & (yo > -STACK) & (np.abs(xo) < CW / 2)
    out[~inside] = 0.03
    s1, s2 = cone_hits(E, D)
    # 1) reflection off the outer cone face
    P = E + np.where(np.isfinite(s1), s1, 0)[..., None] * D
    N = normal(P)
    cosi = np.sum(D * N, -1)
    R = D - 2 * cosi[..., None] * N
    k = -P[..., 1] / np.where(R[..., 1] < 0, R[..., 1], -1)
    iz, ix, ok = to_pixel(P + k[..., None] * R)
    refl = inside & np.isfinite(s1) & (cosi < 0) & (R[..., 1] < 0) & ok
    f = fresnel_sheet(cosi)[..., None] * img[iz, ix]
    if film:
        f = f * privacy(-R)[..., None]
    if "refl" in parts:
        out += np.where(refl[..., None], f, 0)
    # 2) direct view of the panel through the clear cone
    sg = np.where(D[..., 1] < 0, -E[1] / np.where(D[..., 1] < 0, D[..., 1], -1), np.inf)
    G = E + np.where(np.isfinite(sg), sg, 0)[..., None] * D
    gz, gx, gok = to_pixel(G)
    crossings = (s1 < sg).astype(int) + (s2 < sg).astype(int)
    trans = (1 - 0.1) ** crossings
    direct = inside & np.isfinite(sg) & gok
    dcol = trans[..., None] * img[gz, gx]
    if film:
        dcol = dcol * privacy(-D)[..., None]
    if "direct" in parts:
        out += np.where(direct[..., None], dcol, 0)
    # faint outline of the cone so you can see where it is
    out += np.where((inside & np.isfinite(s1))[..., None], 0.02, 0)
    return np.clip(out, 0, 1) ** (1 / 2.2)            # display gamma: dim light looks like it does to the eye


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    E0 = eye(*DESIGN)
    obj = make_object(E0)
    img = panel_image(E0, obj)
    fig, ax = plt.subplots(figsize=(5, 8))
    ax.imshow(img ** (1 / 2.2), extent=[-P_SHORT / 2, P_SHORT / 2, Z_PFRONT - P_LONG, Z_PFRONT])
    ax.add_patch(plt.Circle((0, 0), R_TOP, fill=False, ec="w", ls="--", lw=0.8))
    ax.add_patch(plt.Circle((0, 0), B, fill=False, ec="w", lw=0.8))
    ax.set_title("6. What the panel shows (seen from above)\ncrowd at the TOP of this picture; dashed = cone rim",
                 fontsize=9)
    ax.set_xlabel("mm across"); ax.set_ylabel("mm along the depth (cone axis = 0)")
    fig.tight_layout(); fig.savefig(OUT / "6-panel-image.png", dpi=120); plt.close(fig)

    views = [((1000, 1600, 0), "1.0 m"), ((1500, 1600, 0), "1.5 m  (design point)"), ((2000, 1600, 0), "2.0 m"),
             ((1500, 1750, 0), "1.5 m, taller person (eye 1.75)"), ((1500, 1600, 300), "1.5 m, 30 cm to the side")]
    cols = [("hologram only\n(reflection, ideal)", "refl"), ("realistic: hologram +\nscreen seen through the cone",
                                                              "real"), ("realistic + privacy film\non the panel", "film")]
    fig, axes = plt.subplots(len(views), 3, figsize=(12, 4 * len(views)))
    for r, (v, name) in enumerate(views):
        E = eye(*v)
        for c, (cname, mode) in enumerate(cols):
            if mode == "refl":
                # reflection only, normalised so the shape is easy to judge
                # reflection only, brightened 8x so the shape is easy to judge
                im = view(E, img * 8, parts=("refl",))
            else:
                im = view(E, img, film=(mode == "film"))
            axes[r, c].imshow(im)
            axes[r, c].set_xticks([]); axes[r, c].set_yticks([])
            if r == 0:
                axes[r, c].set_title(cname, fontsize=10)
        axes[r, 0].set_ylabel(name, fontsize=10)
    fig.suptitle("7. Simulated view of a virtual cube (same field of view in every picture, so farther = smaller)",
                 fontsize=11)
    fig.tight_layout(); fig.savefig(OUT / "7-viewer-sim.png", dpi=95); plt.close(fig)
    print("done")
