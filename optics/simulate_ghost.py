"""Classic Pepper's ghost in the KALLAX top-row cube: panel hung face-DOWN under the roof, flat clear sheet below it
rising towards the back. Same virtual cube and viewpoints as simulate_view.py (the cone), for comparison.
Coordinates (mm): x across, y up from the cube floor, z towards the crowd (cube opening at z=0, back at z=-382).
Run: python simulate_ghost.py -> diagrams/8-ghost-side.png, diagrams/9-ghost-sim.png
"""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon
import simulate_view as sv

CW, CH, CD, FLOOR = 335.0, 335.0, 382.0, 390.0
LID_L, LID_S, LID_T = 387.0, 245.0, 10.0
P_LONG, P_SHORT, NZ, NX = 344.16, 193.59, 1920, 1080
PITCH = P_LONG / NZ
BEZEL = (LID_L - P_LONG) / 2
PANEL_Y = CH - 12.0                 # pixel surface, facing down, ~12 mm under the roof board
PIX_Z = (-BEZEL - P_LONG, -BEZEL)   # pixel area along z (lid front flush with the opening)
ALPHA = 24.0                        # sheet angle from horizontal (rises towards the back)
SHEET_L, SHEET_W = 400.0, 300.0     # 30 x 40 cm picture-frame glass / acrylic
SHEET_Y0, SHEET_D0 = 10.0, 5.0      # front edge: 10 mm above the floor, 5 mm behind the opening
N_SHEET = 1.49                      # acrylic
A = np.radians(ALPHA)
S0 = np.array([0.0, SHEET_Y0, -SHEET_D0])
W = np.array([0.0, np.sin(A), -np.cos(A)])     # along the sheet, back and up
NRM = np.array([0.0, np.cos(A), np.sin(A)])    # sheet normal, up and towards the crowd
DESIGN = (1500.0, 1600.0, 0.0)
OUT = Path(__file__).with_name("diagrams")


def eye(dist, eye_h, side=0.0):
    return np.array([side, eye_h - FLOOR, dist])


def rays(E, n, half_fov, tgt=(0.0, 140.0, -170.0)):
    return sv.rays(E, n, half_fov, tgt=tgt)


def fresnel(cos_i):
    cos_i = np.clip(np.abs(cos_i), 1e-4, 1)
    sin_t = np.sqrt(1 - cos_i**2) / N_SHEET
    cos_t = np.sqrt(np.clip(1 - sin_t**2, 0, 1))
    rs = ((cos_i - N_SHEET * cos_t) / (cos_i + N_SHEET * cos_t)) ** 2
    rp = ((N_SHEET * cos_i - cos_t) / (N_SHEET * cos_i + cos_t)) ** 2
    r = 0.5 * (rs + rp)
    return 2 * r / (1 + r)


def trace(E, D):
    """Returns sheet hit point, reflected landing pixel indices, masks."""
    so = (0 - E[2]) / D[..., 2]
    yo, xo = E[1] + so * D[..., 1], E[0] + so * D[..., 0]
    inside = (yo < PANEL_Y) & (yo > 0) & (np.abs(xo) < CW / 2)   # above PANEL_Y: roof / lid edge
    with np.errstate(divide="ignore", invalid="ignore"):
        ss = ((S0 - E) @ NRM) / (D @ NRM)
        sp = (PANEL_Y + LID_T - E[1]) / D[..., 1]          # crossing the top (back) of the lid
    P = E + np.nan_to_num(ss)[..., None] * D
    v = (P - S0) @ W
    on_sheet = inside & (ss > 0) & (v >= 0) & (v <= SHEET_L) & (np.abs(P[..., 0]) <= SHEET_W / 2)
    Lb = E + np.nan_to_num(sp)[..., None] * D
    lid_block = inside & (sp > 0) & (np.abs(Lb[..., 0]) <= LID_S / 2) & (Lb[..., 2] <= 0) & (Lb[..., 2] >= -LID_L)
    on_sheet &= ~(lid_block & (sp < ss))
    cosi = D @ NRM
    R = D - 2 * cosi[..., None] * NRM
    k = (PANEL_Y - P[..., 1]) / np.where(R[..., 1] > 0, R[..., 1], 1)
    L = P + k[..., None] * R
    iz = np.floor((PIX_Z[1] - L[..., 2]) / PITCH).astype(int)
    ix = np.floor((L[..., 0] + P_SHORT / 2) / PITCH).astype(int)
    ok = on_sheet & (R[..., 1] > 0) & (iz >= 0) & (iz < NZ) & (ix >= 0) & (ix < NX)
    return dict(inside=inside, on_sheet=on_sheet, lid=lid_block, ok=ok, iz=np.clip(iz, 0, NZ - 1),
                ix=np.clip(ix, 0, NX - 1), cosi=cosi, virt=P + k[..., None] * D)


def make_object(E0):
    D = rays(E0, 900, 12)
    t = trace(E0, D)
    V = t["virt"][t["ok"]]
    lo, hi = np.percentile(V, 8, 0), np.percentile(V, 92, 0)
    c = (lo + hi) / 2
    half = 0.3 * min(hi[0] - lo[0], np.hypot(hi[1] - lo[1], hi[2] - lo[2]))
    a, b = np.radians(35), np.radians(20)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return c, half, Ry @ Rx


def panel_image(E0, obj):
    img = np.zeros((NZ, NX, 3)); cov = np.zeros((NZ, NX), bool)
    D = rays(E0, 2400, 12)
    t = trace(E0, D)
    col = sv.shade_object(E0, D, obj)
    img[t["iz"][t["ok"]], t["ix"][t["ok"]]] = col[t["ok"]]; cov[t["iz"][t["ok"]], t["ix"][t["ok"]]] = True
    for _ in range(6):
        acc = np.zeros_like(img); cnt = np.zeros((NZ, NX))
        for dz in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(img * cov[..., None], dz, 0), dx, 1)
                cnt += np.roll(np.roll(cov, dz, 0), dx, 1)
        fill = ~cov & (cnt > 0)
        img[fill] = acc[fill] / cnt[fill, None]; cov |= fill
    return img


def view(E, img, n=520, half_fov=9, gain=1.0):
    D = rays(E, n, half_fov)
    t = trace(E, D)
    out = np.zeros(D.shape)
    out[~t["inside"]] = 0.03                                # KALLAX front
    out[t["lid"]] = 0.025                                   # back of the lid (dark)
    refl = fresnel(t["cosi"])[..., None] * img[t["iz"], t["ix"]] * gain
    out += np.where(t["ok"][..., None], refl, 0)
    out += np.where((t["on_sheet"] & ~t["lid"])[..., None], 0.012, 0)   # faint sheet so you can see where it is
    return np.clip(out, 0, 1) ** (1 / 2.2)


def side_diagram():
    fig, ax = plt.subplots(figsize=(10, 7.5))
    ax.add_patch(Rectangle((-CD, 0), CD, CH, fc="white", ec="k", lw=1.5))
    ax.add_patch(Rectangle((-CD - 30, CH), CD + 30, 30, fc=sv_wood, ec="k"))
    ax.add_patch(Rectangle((-CD - 30, -30), CD + 30, 30, fc=sv_wood, ec="k"))
    ax.add_patch(Rectangle((-LID_L, PANEL_Y), LID_L, LID_T, fc="#555", ec="k"))
    ax.add_patch(Rectangle((PIX_Z[0], PANEL_Y - 1.5), P_LONG, 1.5, fc="#2b8cff"))
    ax.text(-LID_L / 2, PANEL_Y + LID_T + 6, "MSI lid, screen facing DOWN (hung under the roof)", ha="center",
            fontsize=8)
    s_end = S0 + SHEET_L * W
    ax.plot([S0[2], s_end[2]], [S0[1], s_end[1]], color="#1f77b4", lw=3)
    # a few light rays: straight down from the panel, reflected towards a viewer at 1.5 m
    E = eye(*DESIGN)
    for zp in np.linspace(PIX_Z[0] + 30, PIX_Z[1] - 20, 5):
        Pp = np.array([0, PANEL_Y, zp])
        # find the sheet point whose reflection goes from Pp to the eye: mirror the eye in the sheet plane
        Em = E - 2 * ((E - S0) @ NRM) * NRM
        d = Em - Pp; s = ((S0 - Pp) @ NRM) / (d @ NRM); H = Pp + s * d
        if 0 <= (H - S0) @ W <= SHEET_L:
            ax.plot([Pp[2], H[2]], [Pp[1], H[1]], color="#e67e22", lw=0.7)
            ax.plot([H[2], H[2] + (E[2] - H[2]) * 0.25], [H[1], H[1] + (E[1] - H[1]) * 0.25], color="#e67e22", lw=0.7)
    # virtual image of the panel (mirror of the pixel plane in the sheet)
    pts = []
    for zp in PIX_Z:
        Pp = np.array([0, PANEL_Y, zp]); pts.append(Pp - 2 * ((Pp - S0) @ NRM) * NRM)
    ax.plot([pts[0][2], pts[1][2]], [pts[0][1], pts[1][1]], color="#2b8cff", ls="--", lw=1.2)
    ax.text(pts[0][2] + 15, pts[0][1] - 10, "where the image appears to be\n(mirror of the screen,\nbehind the sheet)",
            color="#2b8cff", fontsize=8, ha="left", va="top")
    dimf = sv_dim
    dimf(ax, (-CD, CH + 45), (0, CH + 45), f"cube depth {CD:.0f}")
    dimf(ax, (45, 0), (45, CH), f"cube height {CH:.0f}")
    dimf(ax, (-30 - CD, PANEL_Y), (-30 - CD, CH), f"{CH - PANEL_Y:.0f}", fs=7)
    dimf(ax, (S0[2] + 8, 0), (S0[2] + 8, S0[1]), f"{SHEET_Y0:.0f}", fs=7)
    dimf(ax, (s_end[2] - 14, 0), (s_end[2] - 14, s_end[1]), f"back edge {s_end[1]:.0f} high", fs=7)
    dimf(ax, (S0[2], -60), (s_end[2], -60), f"sheet {SHEET_L:.0f} long at {ALPHA:.0f}°, {SHEET_W:.0f} wide",
         side=-1)
    ax.text(15, CH * 0.6, "OPEN FRONT\n→ crowd", fontsize=9, color="gray")
    ax.text(-CD - 15, CH * 0.45, "OPEN BACK\nDJ ←", fontsize=9, color="gray", ha="right")
    ax.set_xlim(-CD - 180, 150); ax.set_ylim(-260, CH + 90); ax.set_aspect("equal")
    ax.set_title("8. Classic Pepper's ghost in the top-row cube, side section (mm).\n"
                 "Orange: light from the screen, reflected by the sheet towards a viewer at 1.5 m.", fontsize=10)
    fig.tight_layout(); fig.savefig(OUT / "8-ghost-side.png", dpi=130); plt.close(fig)


if __name__ == "__main__":
    import diagrams as dg
    sv_wood, sv_dim = dg.C_WOOD, dg.dim
    side_diagram()
    E0 = eye(*DESIGN)
    g_img = panel_image(E0, make_object(E0))
    c_E0 = sv.eye(*sv.DESIGN)
    c_img = sv.panel_image(c_E0, sv.make_object(c_E0))
    views = [((1000, 1600, 0), "1.0 m"), ((1500, 1600, 0), "1.5 m  (design point)"), ((2000, 1600, 0), "2.0 m"),
             ((1500, 1750, 0), "1.5 m, taller (eye 1.75)"), ((1500, 1600, 300), "1.5 m, 30 cm to the side"),
             ((1500, 1600, 600), "1.5 m, 60 cm to the side")]
    fig, axes = plt.subplots(len(views), 3, figsize=(12, 4 * len(views)))
    for r, (v, name) in enumerate(views):
        ims = [view(eye(*v), g_img, gain=8), view(eye(*v), g_img), sv.view(sv.eye(*v), c_img)]
        for c, im in enumerate(ims):
            axes[r, c].imshow(im); axes[r, c].set_xticks([]); axes[r, c].set_yticks([])
        axes[r, 0].set_ylabel(name, fontsize=10)
    for c, t in enumerate(["GHOST: reflection brightened 8x\n(to judge the shape)", "GHOST: realistic brightness",
                           "CONE 30° for comparison: realistic\n(no privacy film)"]):
        axes[0, c].set_title(t, fontsize=10)
    fig.suptitle("9. Classic Pepper's ghost vs Pepper's cone, same virtual cube, same framing", fontsize=11)
    fig.tight_layout(); fig.savefig(OUT / "9-ghost-sim.png", dpi=95); plt.close(fig)
    print("done")
