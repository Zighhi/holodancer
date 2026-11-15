"""Build drawing for the Pepper's ghost in the KALLAX top-row cube: lid taped under the roof, acrylic sheet taped
to the side walls along a marked 24-degree line. Run: python ghost_build.py -> diagrams/10-ghost-build.png"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon
from diagrams import dim, C_WOOD, C_DIM
from simulate_ghost import CW, CH, CD, LID_L, LID_S, LID_T, PANEL_Y, ALPHA, SHEET_L, SHEET_Y0, SHEET_D0, OUT

A = np.radians(ALPHA)
SHEET_W = 330.0                     # 2 mm acrylic cut to 330 x 400: fills the 335 mm cube width
TAPE = "#c0392b"
MARKS = (5, 100, 200, 300, 382)     # depth behind the opening (mm) where the line is marked on both side walls


def height_at(depth):
    return SHEET_Y0 + (depth - SHEET_D0) * np.tan(A)


def build():
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(16, 7.5), gridspec_kw=dict(width_ratios=[1.15, 1]))
    # ---------------- side section (looking at the left wall from inside the cube) -------------------------
    ax.add_patch(Rectangle((-CD, 0), CD, CH, fc="#f4f4f4", ec="k", lw=1.5))
    ax.add_patch(Rectangle((-CD - 30, CH), CD + 30, 30, fc=C_WOOD, ec="k"))
    ax.add_patch(Rectangle((-CD - 30, -30), CD + 30, 30, fc=C_WOOD, ec="k"))
    ax.add_patch(Rectangle((-LID_L, PANEL_Y), LID_L, LID_T, fc="#555", ec="k"))
    ax.add_patch(Rectangle((-LID_L + 20, PANEL_Y + LID_T), LID_L - 40, CH - PANEL_Y - LID_T, fc="#f1c40f"))
    ax.text(-LID_L / 2, PANEL_Y - 14, "lid, screen DOWN; foam mounting tape on its back (yellow) + gaffer backup",
            ha="center", fontsize=7.5)
    s0 = np.array([-SHEET_D0, SHEET_Y0])
    s1 = s0 + SHEET_L * np.array([-np.cos(A), np.sin(A)])
    ax.plot([s0[0], s1[0]], [s0[1], s1[1]], color="#1f77b4", lw=3.5)
    ax.text(*((s0 + s1) / 2 + np.array([15, 22])), "2 mm acrylic, 330 x 400", color="#1f77b4", fontsize=8,
            rotation=ALPHA, rotation_mode="anchor")
    for dep in MARKS:                                      # pencil marks on the wall
        y = height_at(dep)
        ax.plot([-dep, -dep], [0, y], color="gray", lw=0.6, ls=":")
        ax.plot(-dep, y, "o", color="k", ms=4)
        ax.text(-dep, -45, f"{dep}\n→{y:.0f}", ha="center", fontsize=7)
    ax.text(-CD - 20, -45, "depth\n→height", ha="right", fontsize=7)
    for frac in (0.12, 0.5, 0.88):                         # gaffer L-strips sheet edge -> wall
        p = s0 + frac * (s1 - s0)
        ax.add_patch(Rectangle((p[0] - 18, p[1] - 22), 36, 44, angle=0, fc=TAPE, alpha=0.55, ec=TAPE))
    ax.add_patch(Rectangle((-SHEET_D0 - 25, 0), 50, 16, fc=TAPE, alpha=0.55, ec=TAPE))
    ax.text(-SHEET_D0 - 30, 22, "front edge taped\nto the floor (hinge)", fontsize=7, color=TAPE, ha="right")
    ax.text(-CD * 0.5, 165, "3 gaffer L-strips per side:\nsheet edge -> side wall (red)", fontsize=8, color=TAPE)
    ax.add_patch(Rectangle((-CD + 5, 0), CD - 10, 4, fc="k"))
    ax.text(-CD / 2, 8, "black felt on the floor", ha="center", fontsize=7, color="w",
            bbox=dict(fc="k", ec="none", pad=1))
    dim(ax, (-CD, CH + 45), (0, CH + 45), f"cube depth {CD:.0f}")
    dim(ax, (-CD - 40, PANEL_Y), (-CD - 40, CH), f"{CH - PANEL_Y:.0f}", fs=7)
    ax.text(-SHEET_D0 - 80, SHEET_Y0 + 14, f"{ALPHA:.0f}°", fontsize=10, color=C_DIM)
    ax.text(18, CH * 0.6, "OPEN FRONT\n→ crowd", fontsize=9, color="gray")
    ax.text(-CD - 55, CH * 0.6, "OPEN BACK\n(black fabric)", fontsize=8, color="gray", ha="right")
    ax.set_xlim(-CD - 190, 140); ax.set_ylim(-75, CH + 90); ax.set_aspect("equal")
    ax.set_title("10a. Side section: mark the line on BOTH side walls (dots, mm), tape the sheet along it",
                 fontsize=10)
    # ---------------- front view -------------------------------------------------------------------------
    bx.add_patch(Rectangle((-CW / 2, 0), CW, CH, fc="#1b1b1b", ec="k", lw=1.5))
    bx.add_patch(Rectangle((-CW / 2 - 30, -30), CW + 60, 30, fc=C_WOOD, ec="k"))
    bx.add_patch(Rectangle((-CW / 2 - 30, CH), CW + 60, 30, fc=C_WOOD, ec="k"))
    bx.add_patch(Rectangle((-CW / 2 - 30, 0), 30, CH, fc=C_WOOD, ec="k"))
    bx.add_patch(Rectangle((CW / 2, 0), 30, CH, fc=C_WOOD, ec="k"))
    bx.add_patch(Rectangle((-LID_S / 2, PANEL_Y), LID_S, LID_T, fc="#555", ec="k"))
    bx.add_patch(Rectangle((-LID_S / 2 + 10, PANEL_Y + LID_T), LID_S - 20, CH - PANEL_Y - LID_T, fc="#f1c40f"))
    top = height_at(CD)
    bx.add_patch(Rectangle((-SHEET_W / 2, SHEET_Y0), SHEET_W, top - SHEET_Y0, fc="#1f77b4", alpha=0.2,
                           ec="#1f77b4", lw=1.5))
    bx.text(0, (SHEET_Y0 + top) / 2, "acrylic sheet\n(seen at an angle,\nrising to the back)", ha="center",
            va="center", fontsize=8, color="w")
    for s in (-1, 1):
        for y in (40, 95, 150):
            bx.add_patch(Rectangle((s * CW / 2 - (22 if s > 0 else 0), y), 22, 18, fc=TAPE, alpha=0.7))
    bx.add_patch(Rectangle((-80, 0), 160, 14, fc=TAPE, alpha=0.7))
    bx.add_patch(Rectangle((CW / 2 - 75, 200), 60, 35, fc="#2e7d32", ec="k"))
    bx.text(CW / 2 - 45, 217, "board", ha="center", va="center", fontsize=7, color="w")
    bx.text(CW / 2 - 45, 245, "(taped to the side\nwall, near the eDP cable)", ha="center", fontsize=6.5, color="w")
    dim(bx, (-CW / 2, -55), (CW / 2, -55), f"cube width {CW:.0f}", side=-1)
    dim(bx, (-SHEET_W / 2, top + 20), (SHEET_W / 2, top + 20), f"sheet {SHEET_W:.0f} (2-3 mm gap each side)", fs=7)
    dim(bx, (-LID_S / 2, PANEL_Y - 18), (LID_S / 2, PANEL_Y - 18), f"lid {LID_S:.0f}", side=-1, fs=7)
    bx.set_xlim(-CW / 2 - 60, CW / 2 + 60); bx.set_ylim(-90, CH + 60); bx.set_aspect("equal")
    bx.set_title("10b. Front view, as the crowd sees the cube (red = gaffer tape)", fontsize=10)
    fig.suptitle("10. Holding the panel and the sheet with tape only", fontsize=11)
    fig.tight_layout(); fig.savefig(OUT / "10-ghost-build.png", dpi=120); plt.close(fig)


if __name__ == "__main__":
    build()
    print("marks (depth -> height):", ", ".join(f"{d}->{height_at(d):.0f}" for d in MARKS))
