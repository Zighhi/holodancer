"""Measured setup: cube 335 x 335 x 382, top-row floor at 390 mm, panel active 344 x 194 long side into the depth,
active area front edge GAP mm behind the cube opening (panel may stick out at the open back)."""
import numpy as np
P_LONG, P_SHORT = 344.16, 193.59
CW, CH, CD = 335, 335, 382
FLOOR, STACK = 390, 25            # screen plane = floor + panel/tray thickness
ROOF = CH - STACK

def trace(theta, b, h, eye_h, dist, axis_back, gap=15, n=260, cube=True):
    """axis_back: cone axis distance behind the active area's FRONT edge. dist: eye -> cube opening (horizontal)."""
    t = np.tan(np.radians(theta))
    z_pfront = axis_back                 # panel front edge in cone coords (viewer on +z)
    z_open = z_pfront + gap
    E = np.array([0.0, eye_h - FLOOR - STACK, z_open + dist])
    top_r = b + h * t
    tgt = np.array([0, h * 0.4, 0]); fwd = tgt - E; dt = np.linalg.norm(fwd); fwd /= dt
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
    span = 1.3 * max(top_r, h); u = np.linspace(-span, span, n); U, V = np.meshgrid(u, u); du = u[1] - u[0]
    D = tgt + U[..., None] * right + V[..., None] * up - E; D /= np.linalg.norm(D, axis=-1, keepdims=True)
    dx, dy, dz = D[..., 0], D[..., 1], D[..., 2]; ex, ey, ez = E
    A = dx**2 + dz**2 - (dy*t)**2; B = 2*(ex*dx + ez*dz - (b + ey*t)*dy*t); C = ex**2 + ez**2 - (b + ey*t)**2
    disc = B**2 - 4*A*C; sq = np.sqrt(np.clip(disc, 0, None))
    with np.errstate(invalid="ignore", divide="ignore"):
        cs = [(-B - sq)/(2*A), (-B + sq)/(2*A)]
    best = np.full(A.shape, np.inf)
    for s in cs:
        P = E + np.nan_to_num(s)[..., None]*D
        g = (disc > 0) & (s > 0) & (P[..., 1] >= 0) & (P[..., 1] <= h)
        best = np.where(g & (s < best), s, best)
    hit = np.isfinite(best); P = E + np.where(hit, best, 0)[..., None]*D
    rr = np.hypot(P[..., 0], P[..., 2]) + 1e-9
    N = np.stack([P[..., 0]/rr, -t*np.ones_like(rr), P[..., 2]/rr], -1); N /= np.linalg.norm(N, axis=-1, keepdims=True)
    outside = np.sum(D*N, -1) < 0
    R = D - 2*np.sum(D*N, -1, keepdims=True)*N; down = R[..., 1] < -1e-6
    k = -P[..., 1]/np.where(down, R[..., 1], -1); L = P + k[..., None]*R
    on = hit & outside & down & (np.abs(L[..., 0]) <= P_SHORT/2) & (L[..., 2] <= z_pfront) & (L[..., 2] >= z_pfront - P_LONG)
    if cube:
        sf = (z_open - ez)/dz; on &= (ey + sf*dy < ROOF) & (np.abs(ex + sf*dx) < CW/2)
    fits = (top_r <= CW/2 - 10) and (h <= ROOF - 10)
    elev = np.degrees(np.arctan2(E[1] - h*0.4, E[2]))
    return dict(area=on.sum()*du*du if fits else 0, on=on, U=U, V=V, L=L, top_r=top_r, elev=elev, z_pfront=z_pfront)

if __name__ == "__main__":
    dists, eyes = (1000, 1500, 2000), (1550, 1700)
    print(f"screen at {FLOOR+STACK} mm, roof {ROOF} mm above it")
    for theta in (35, 32.5, 30, 27.5, 25):
        t = np.tan(np.radians(theta)); hmax = min(ROOF - 10, (CW/2 - 10 - 8)/t)
        res = []
        for h in np.linspace(120, hmax, 7):
            for ab in range(60, 260, 20):
                a = [trace(theta, 8, h, e, d, ab)["area"] for e in eyes for d in dists]
                res.append((np.mean(a), min(a), h, ab, a))
        m, mn, h, ab, a = max(res)
        print(f"{theta:5.1f}°: h={h:4.0f} rim Ø{2*(8+h*t):4.0f} axis {ab:3d} mm behind panel front | mean {m/100:4.0f} cm², "
              f"worst {mn/100:4.0f} | " + " ".join(f"{x/100:4.0f}" for x in a) + "   (eye 155: 1/1.5/2 m, eye 170: 1/1.5/2 m)")
