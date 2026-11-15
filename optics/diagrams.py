"""Dimension diagrams of the Pepper's cone in the KALLAX top-row cube. Run: python diagrams.py -> diagrams/*.png
All numbers in mm. Values marked (assumed) still need checking on the real build."""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Polygon, Circle, Wedge, Arc

# --- design values -------------------------------------------------------------------------------------------
THETA = 30.0                 # cone wall angle from the vertical axis (deg)
B = 8.0                      # bottom opening radius (Ø16)
H = 240.0                    # cone height
R_TOP = B + H * np.tan(np.radians(THETA))
SLANT = H / np.cos(np.radians(THETA))
OVERLAP = 8.0                # seam overlap
# KALLAX top-row cube (measured)
CW, CH, CD = 335.0, 335.0, 382.0
FLOOR = 390.0                # top-row cube floor above the ground
STACK = 25.0                 # panel + tray thickness under the screen surface (assumed)
# panel (measured / datasheet)
ACT_L, ACT_S = 344.2, 193.6  # active (pixel) area: long side into the depth, short side across
FRAME_L, FRAME_S = 387.0, 245.0   # whole MSI lid (bezel + webcam + hinges) used as the monitor, measured
GAP = (FRAME_L - ACT_L) / 2  # lid front flush with the cube opening -> pixels start ~21 mm behind it
AXIS = GAP + 200.0           # cube opening -> cone axis
EYE = 1600.0                 # viewer eye height (crowd 1.55-1.70 m)
DISTS = (1000.0, 1500.0, 2000.0)

OUT = Path(__file__).with_name("diagrams")
OUT.mkdir(exist_ok=True)
C_CONE, C_PANEL, C_DIM, C_WOOD = "#1f77b4", "#222222", "#c0392b", "#d9c7a7"


def dim(ax, p, q, text, off=(0, 0), side=1, fs=8, color=C_DIM):
    """Dimension line between p and q, offset by `off`, text in the middle."""
    p, q, off = np.array(p, float), np.array(q, float), np.array(off, float)
    a, b = p + off, q + off
    ax.annotate("", a, b, arrowprops=dict(arrowstyle="<->", color=color, lw=0.9, shrinkA=0, shrinkB=0))
    if np.any(off):                                   # extension lines from the measured points
        for s, e in ((p, a), (q, b)):
            ax.plot(*zip(s, e), color=color, lw=0.5)
    m = (a + b) / 2
    ang = np.degrees(np.arctan2(*(b - a)[::-1]))
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    ax.text(*m, text, color=color, fontsize=fs, ha="center", va="bottom" if side > 0 else "top",
            rotation=ang, rotation_mode="anchor", bbox=dict(fc="white", ec="none", pad=0.6, alpha=0.85))


def cone_side(ax, x_axis, y0, color=C_CONE, lw=1.6):
    """Cone as seen from the side: x_axis = position of the axis, y0 = screen level."""
    pts = [(x_axis - B, y0), (x_axis - R_TOP, y0 + H), (x_axis + R_TOP, y0 + H), (x_axis + B, y0)]
    ax.add_patch(Polygon(pts, closed=True, fc=matplotlib.colors.to_rgba(color, 0.12), ec=color, lw=lw))


# --- 1. whole scene, side view -------------------------------------------------------------------------------
def scene():
    fig, ax = plt.subplots(figsize=(13, 6.2))
    # x: horizontal distance from the cube opening (crowd towards +x); y: height above the ground
    ax.axhline(0, color="k", lw=1)
    ax.add_patch(Rectangle((-CD - 20, 0), CD + 20, 770, fc=C_WOOD, ec="k", lw=1, alpha=0.5))
    ax.add_patch(Rectangle((-CD, FLOOR), CD, CH, fc="white", ec="k", lw=0.8))           # top cube
    ax.add_patch(Rectangle((-CD, 20), CD, CH, fc="white", ec="k", lw=0.8))              # bottom cube (laptop)
    ax.text(-CD / 2, 20 + CH / 2, "bottom cube\n(laptop etc.)", ha="center", va="center", fontsize=8, color="gray")
    ax.text(-CD / 2 - 10, 785, "DJ gear on top", ha="center", fontsize=8, color="gray")
    scr = FLOOR + STACK
    ax.add_patch(Rectangle((-GAP - ACT_L, FLOOR), ACT_L, STACK, fc=C_PANEL))
    cone_side(ax, -AXIS, scr)
    # viewer
    for d, ls in zip(DISTS, (":", "--", ":")):
        tgt = np.array([-AXIS + R_TOP * 0.35, scr + H * 0.4])
        ax.plot([d, tgt[0]], [EYE, tgt[1]], color="#e67e22", lw=0.9, ls=ls)
        el = np.degrees(np.arctan2(EYE - tgt[1], d - tgt[0]))
        ax.text(d, EYE + 25, f"{d/1000:.1f} m\nlooks down {el:.0f}°", ha="center", fontsize=8, color="#e67e22")
    xs = 1500
    ax.add_patch(Circle((xs, EYE), 90, fc="none", ec="gray"))                               # head
    ax.plot([xs, xs], [EYE - 90, 900], color="gray"); ax.plot([xs, xs - 120], [900, 0], color="gray")
    ax.plot([xs, xs + 120], [900, 0], color="gray"); ax.plot([xs - 150, xs + 150], [1350, 1250], color="gray")
    dim(ax, (2250, 0), (2250, EYE), f"eye {EYE/1000:.2f} m", off=(0, 0), side=1)
    dim(ax, (-CD - 120, 0), (-CD - 120, FLOOR), f"{FLOOR:.0f}", side=1)
    dim(ax, (-CD - 120, FLOOR), (-CD - 120, scr), f"{STACK:.0f}", side=1, fs=7)
    dim(ax, (0, 300), (1500, 300), "1.5 m (crowd 1-2 m)", side=1)
    ax.set_xlim(-CD - 250, 2450); ax.set_ylim(-60, 1900); ax.set_aspect("equal")
    ax.set_title("1. Side view of the whole scene (to scale, mm). Crowd on the right, DJ behind the KALLAX on the left.",
                 fontsize=10)
    ax.set_xlabel("distance from the cube opening (mm)"); ax.set_ylabel("height above the floor (mm)")
    fig.tight_layout(); fig.savefig(OUT / "1-scene-side.png", dpi=130); plt.close(fig)


# --- 2. cube close-up, side view -----------------------------------------------------------------------------
def cube_side():
    fig, ax = plt.subplots(figsize=(9, 7.5))
    # x = 0 at the cube opening, negative = into the cube (towards the DJ); y = 0 at the cube floor
    ax.add_patch(Rectangle((-CD, 0), CD, CH, fc="white", ec="k", lw=1.5))
    ax.add_patch(Rectangle((-CD - 30, CH), CD + 30, 30, fc=C_WOOD, ec="k"))
    ax.add_patch(Rectangle((-CD - 30, -30), CD + 30, 30, fc=C_WOOD, ec="k"))
    ax.add_patch(Rectangle((-GAP - (FRAME_L + ACT_L) / 2, 0), FRAME_L, STACK, fc="#888", ec="k", lw=0.6))
    ax.add_patch(Rectangle((-GAP - ACT_L, STACK - 3), ACT_L, 3, fc=C_PANEL))
    ax.text(-GAP - ACT_L / 2, STACK / 2 - 2, "tray + panel (board, cable behind/under)", ha="center", va="center",
            fontsize=7, color="white")
    cone_side(ax, -AXIS, STACK)
    ax.plot([-AXIS, -AXIS], [STACK - 10, STACK + H + 20], color=C_CONE, lw=0.6, ls="-.")
    ax.text(-AXIS, STACK + H + 25, "cone axis", ha="center", fontsize=7, color=C_CONE)
    ax.text(15, CH * 0.75, "OPEN FRONT\n→ crowd", fontsize=9, color="gray", va="center")
    ax.text(-CD - 15, CH * 0.75, "OPEN BACK\nDJ ←", fontsize=9, color="gray", va="center", ha="right")
    # dims
    dim(ax, (-CD, CH + 45), (0, CH + 45), f"cube depth {CD:.0f}", side=1)
    dim(ax, (40, 0), (40, CH), f"cube height {CH:.0f}", side=1)
    dim(ax, (-AXIS, -60), (0, -60), f"opening → axis {AXIS:.0f}", side=-1)
    dim(ax, (-GAP, -100), (0, -100), f"{GAP:.0f}", side=-1, fs=7)
    dim(ax, (-GAP - ACT_L, -100), (-GAP, -100), f"pixel area {ACT_L:.0f} (long side)", side=-1)
    dim(ax, (-AXIS - R_TOP, STACK + H + 55), (-AXIS + R_TOP, STACK + H + 55), f"rim Ø{2*R_TOP:.0f}", side=1)
    xl = -AXIS - R_TOP - 15
    dim(ax, (xl, STACK), (xl, STACK + H), f"cone height {H:.0f}", side=1)
    dim(ax, (xl, STACK + H), (xl, CH), f"{CH - STACK - H:.0f} to roof", side=1, fs=7)
    dim(ax, (-AXIS + R_TOP, STACK + H - 12), (0, STACK + H - 12), f"rim to opening {AXIS - R_TOP:.0f}", side=-1, fs=7)
    ax.set_xlim(-CD - 120, 140); ax.set_ylim(-150, CH + 110); ax.set_aspect("equal")
    ax.set_title("2. Top-row cube, side section (mm). Panel lies flat, cone stands on it upside down.", fontsize=10)
    fig.tight_layout(); fig.savefig(OUT / "2-cube-side.png", dpi=130); plt.close(fig)


# --- 3. cube, top view ---------------------------------------------------------------------------------------
def cube_top():
    fig, ax = plt.subplots(figsize=(8, 9))
    # x across the cube (centre 0), y = depth: 0 at the opening, negative into the cube
    ax.add_patch(Rectangle((-CW / 2, -CD), CW, CD, fc="white", ec="k", lw=1.5))
    ax.add_patch(Rectangle((-CW / 2 - 30, -CD), 30, CD, fc=C_WOOD, ec="k"))
    ax.add_patch(Rectangle((CW / 2, -CD), 30, CD, fc=C_WOOD, ec="k"))
    fy = -GAP - (FRAME_L + ACT_L) / 2
    ax.add_patch(Rectangle((-FRAME_S / 2, fy), FRAME_S, FRAME_L, fc="#bbb", ec="k", lw=0.6, ls="--"))
    ax.add_patch(Rectangle((-ACT_S / 2, -GAP - ACT_L), ACT_S, ACT_L, fc="#333", ec="k"))
    ax.add_patch(Circle((0, -AXIS), R_TOP, fc=C_CONE, alpha=0.15, ec=C_CONE, lw=1.6))
    ax.add_patch(Circle((0, -AXIS), B, fc=C_CONE, ec=C_CONE))
    ax.text(0, -AXIS - 25, "cone tip Ø16\nstands here", ha="center", va="top", fontsize=7, color="white")
    ax.text(0, 40, "CROWD this side", ha="center", fontsize=10, color="gray")
    ax.text(0, -CD - 45, "DJ side (open back)", ha="center", fontsize=9, color="gray")
    dim(ax, (-CW / 2, -CD - 15), (CW / 2, -CD - 15), f"cube width {CW:.0f}", side=-1)
    dim(ax, (-ACT_S / 2, -GAP - ACT_L + 30), (ACT_S / 2, -GAP - ACT_L + 30), f"pixels {ACT_S:.0f}", side=1, color="white")
    dim(ax, (-R_TOP, -AXIS), (R_TOP, -AXIS), f"rim Ø{2*R_TOP:.0f}", side=1)
    dim(ax, (R_TOP, -AXIS + 40), (CW / 2, -AXIS + 40), f"{CW/2 - R_TOP:.0f}", side=1, fs=7)
    dim(ax, (CW / 2 + 45, 0), (CW / 2 + 45, -AXIS), f"opening → axis {AXIS:.0f}", side=1)
    dim(ax, (CW / 2 + 90, 0), (CW / 2 + 90, -CD), f"depth {CD:.0f}", side=1)
    dim(ax, (-CW / 2 - 50, -GAP), (-CW / 2 - 50, -GAP - ACT_L), f"pixels {ACT_L:.0f}", side=1)
    ax.text(-FRAME_S / 2 + 4, fy + 4, f"MSI lid {FRAME_L:.0f} x {FRAME_S:.0f}, hinge side to the back\n"
            f"(sticks out {FRAME_L - CD:.0f} mm at the open back)", fontsize=6.5, va="bottom")
    ax.set_xlim(-CW / 2 - 110, CW / 2 + 140); ax.set_ylim(-CD - 80, 80); ax.set_aspect("equal")
    ax.set_title("3. Top-row cube seen from above (mm). Panel long side runs into the depth.", fontsize=10)
    fig.tight_layout(); fig.savefig(OUT / "3-cube-top.png", dpi=130); plt.close(fig)


# --- 4. the cone ---------------------------------------------------------------------------------------------
def cone():
    fig, ax = plt.subplots(figsize=(8, 7))
    cone_side(ax, 0, 0)
    ax.plot([0, 0], [-15, H + 20], color=C_CONE, lw=0.6, ls="-.")
    ax.add_patch(Rectangle((-200, -12), 400, 12, fc="#333"))
    ax.text(0, -30, "screen (panel surface)", ha="center", va="top", fontsize=8)
    dim(ax, (-R_TOP, H + 25), (R_TOP, H + 25), f"rim Ø{2*R_TOP:.1f}", side=1)
    ax.annotate(f"bottom opening Ø{2*B:.0f}", (0, 2), (-150, -75), fontsize=8, color=C_DIM,
                arrowprops=dict(arrowstyle="->", color=C_DIM, lw=0.8))
    dim(ax, (R_TOP + 30, 0), (R_TOP + 30, H), f"height {H:.0f}", side=1)
    wall = np.array([-R_TOP + B, H]); nrm = np.array([-wall[1], wall[0]]) / np.linalg.norm(wall)
    dim(ax, (-B, 0), (-R_TOP, H), f"wall (slant) {SLANT:.1f}", off=30 * nrm, side=1)
    ax.plot([B, B], [0, 90], color="gray", lw=0.6, ls=":")
    a = np.radians(np.linspace(90 - THETA, 90, 20))
    ax.plot(B + 80 * np.cos(a), 80 * np.sin(a), color="k", lw=0.8)
    ax.text(B + 30, 95, f"{THETA:.0f}°", fontsize=9)
    ax.text(-60, H * 0.72, "0.5 mm clear PETG,\nrolled from one piece,\nseam overlap 8 mm", fontsize=8)
    ax.set_xlim(-R_TOP - 90, R_TOP + 110); ax.set_ylim(-110, H + 80); ax.set_aspect("equal")
    ax.set_title(f"4. The cone (mm): {THETA:.0f}° wall to the axis, upside down on the screen", fontsize=10)
    fig.tight_layout(); fig.savefig(OUT / "4-cone.png", dpi=130); plt.close(fig)


# --- 5. flat pattern -----------------------------------------------------------------------------------------
def pattern():
    th = np.radians(THETA)
    r_in, r_out = B / np.sin(th), B / np.sin(th) + SLANT
    ang = 360 * np.sin(th)
    ang_ov = np.degrees(OVERLAP / r_out)
    fig, ax = plt.subplots(figsize=(11, 6.5))
    start = 180 - (ang - 180) / 2 - 180     # symmetric about the vertical
    ax.add_patch(Wedge((0, 0), r_out, start, start + ang, width=r_out - r_in, fc=C_CONE, alpha=0.15, ec=C_CONE, lw=1.5))
    # glue tab: a strip of constant width along one straight edge (here the left one, along -x)
    ax.add_patch(Polygon([(-r_in, 0), (-r_out, 0), (-r_out, -OVERLAP), (-r_in, -OVERLAP)], closed=True,
                         fc=matplotlib.colors.to_rgba("#e67e22", 0.35), ec="#e67e22", lw=1))
    ax.text(-(r_in + r_out) / 2, -OVERLAP - 6, f"glue tab {OVERLAP:.0f} mm (overlaps the other straight edge)",
            fontsize=7, color="#e67e22", ha="center", va="top")
    dim(ax, (0, 0), (-r_out, 0), f"outer radius {r_out:.1f}", off=(0, -25), side=-1)
    dim(ax, (0, 0), (0, r_in), f"inner r {r_in:.1f}", off=(30, 0), side=1, fs=7)
    w, hgt = 2 * r_out, r_out
    ax.add_patch(Rectangle((-r_out, 0), w, hgt, fill=False, ls=":", ec="gray"))
    dim(ax, (-r_out, r_out + 20), (r_out, r_out + 20), f"needs ~{w/10:.1f} cm", side=1)
    dim(ax, (r_out + 25, 0), (r_out + 25, r_out), f"~{hgt/10:.1f} cm", side=1)
    ax.text(0, r_out * 0.45, f"cut {ang:.0f}° (+{ang_ov:.1f}° overlap)\nroll so the straight edges meet\n"
                             f"→ cone 30°, height {H:.0f}, rim Ø{2*R_TOP:.0f}", ha="center", fontsize=9)
    ax.set_xlim(-r_out - 60, r_out + 80); ax.set_ylim(-70, r_out + 60); ax.set_aspect("equal")
    ax.set_title("5. Flat cutout from the PETG sheet (mm). Half a ring: the two straight edges become the seam.",
                 fontsize=10)
    fig.tight_layout(); fig.savefig(OUT / "5-flat-pattern.png", dpi=130); plt.close(fig)


if __name__ == "__main__":
    for f in (scene, cube_side, cube_top, cone, pattern):
        f()
    print(f"cone: theta {THETA}°, h {H}, rim Ø{2*R_TOP:.1f}, slant {SLANT:.1f}, axis {AXIS} mm behind the opening")
    print("written to", OUT)
