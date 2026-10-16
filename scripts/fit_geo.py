"""Fit real NYC geography onto the stylized pixel map -> public/assets/geo_fit.json

The map in map_data.json is hand-drawn with Manhattan rotated upright, so GPS
coordinates can't be projected directly. For each map region (m = Manhattan,
x = Bronx, b = Brooklyn + Queens) this fits an affine transform from local km
coordinates to grid cells by maximising overlap between the real borough
outlines and the drawn cells. It also exports simplified borough outlines so the
browser can tell which region a GPS point belongs to.

Usage (needs numpy):
    curl -sLo boroughs.geojson https://raw.githubusercontent.com/dwillis/nyc-maps/master/boroughs.geojson
    python3 scripts/fit_geo.py boroughs.geojson
"""
import json
import sys

import numpy as np

MAP = "public/assets/map_data.json"
OUT = "public/assets/geo_fit.json"
LAT0, LNG0 = 40.75, -73.95  # must match geo-locate.js
KX, KY = 111.32 * np.cos(np.radians(LAT0)), 110.57
REGION = {"Manhattan": "m", "Bronx": "x", "Brooklyn": "b", "Queens": "b"}
STEP = 0.3  # km, sample spacing
XS, YS = np.arange(-15, 25, STEP), np.arange(-25, 20, STEP)

# Rough hand-placed landmarks (lng, lat) -> (col, row), only used as a starting guess.
LANDMARKS = [
    ((-74.0153, 40.7003), (10, 39.5)),  # Battery
    ((-73.9255, 40.8735), (3.5, 7.5)),  # Inwood tip
    ((-73.97, 40.575), (28, 50)),       # Coney Island
    ((-73.874, 40.777), (30, 9.5)),     # LaGuardia
    ((-73.78, 40.645), (43, 36)),       # JFK
]


def to_km(lng, lat):
    return np.c_[(np.asarray(lng) - LNG0) * KX, (np.asarray(lat) - LAT0) * KY]


def inside(pts, rings):
    res = np.zeros(len(pts), bool)
    x, y = pts[:, 0], pts[:, 1]
    for r in rings:
        c = np.zeros(len(pts), bool)
        for (xi, yi), (xj, yj) in zip(r, np.roll(r, 1, axis=0)):
            c ^= ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        res |= c
    return res


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    n = np.hypot(*ab)
    rel = pts - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n if n > 0 else np.hypot(*rel.T)
    i = int(np.argmax(d))
    if d[i] > tol:
        return np.vstack([simplify(pts[: i + 1], tol)[:-1], simplify(pts[i:], tol)])
    return np.array([a, b])


def area(p):
    x, y = p.T
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def nelder_mead(f, x, step, iters):
    n = len(x)
    S = [x] + [x + np.eye(n)[i] * step[i] for i in range(n)]
    F = [f(s) for s in S]
    for _ in range(iters):
        order = np.argsort(F)
        S, F = [S[i] for i in order], [F[i] for i in order]
        c = np.mean(S[:-1], 0)
        xr = c + (c - S[-1]); fr = f(xr)
        if fr < F[0]:
            xe = c + 2 * (c - S[-1]); fe = f(xe)
            S[-1], F[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < F[-2]:
            S[-1], F[-1] = xr, fr
        else:
            xc = c + 0.5 * (S[-1] - c); fc = f(xc)
            if fc < F[-1]:
                S[-1], F[-1] = xc, fc
            else:
                S = [S[0]] + [S[0] + 0.5 * (s - S[0]) for s in S[1:]]
                F = [F[0]] + [f(s) for s in S[1:]]
    i = int(np.argmin(F))
    return S[i], F[i]


def main(geojson_path):
    grid = np.array(json.load(open(MAP)))
    R, C = grid.shape
    cells = np.array([(c + 0.5, r + 0.5) for r in range(R) for c in range(C)])
    cell_lab = grid.ravel()

    rings = {"m": [], "x": [], "b": []}
    for f in json.load(open(geojson_path))["features"]:
        name = f["properties"]["BoroName"]
        if name not in REGION:
            continue
        g = f["geometry"]
        for poly in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
            rings[REGION[name]].append(to_km(*np.array(poly[0]).T))

    gx, gy = np.meshgrid(XS, YS)
    P = np.c_[gx.ravel(), gy.ravel()]
    lab = np.full(len(P), "w")
    for code, rs in rings.items():
        lab[inside(P, rs)] = code
    LAB = lab.reshape(len(YS), len(XS))

    def real_label(pts):
        ix = np.round((pts[:, 0] - XS[0]) / STEP).astype(int)
        iy = np.round((pts[:, 1] - YS[0]) / STEP).astype(int)
        ok = (ix >= 0) & (ix < len(XS)) & (iy >= 0) & (iy < len(YS))
        out = np.full(len(pts), "w")
        out[ok] = LAB[iy[ok], ix[ok]]
        return out

    def unpack(p):
        return np.array([[p[0], p[1]], [p[3], p[4]]]), np.array([p[2], p[5]])

    def make_score(codes):
        real = np.isin(lab, codes)
        drawn = np.isin(cell_lab, codes)

        def score(p):
            A, t = unpack(p)
            if abs(np.linalg.det(A)) < 1e-3:
                return 1e9
            # real land -> grid: how much lands on the wrong cell type
            q = P[real] @ A.T + t
            ins = (q[:, 0] >= 0) & (q[:, 0] < C) & (q[:, 1] >= 0) & (q[:, 1] < R)
            hit = grid[q[ins, 1].astype(int), q[ins, 0].astype(int)]
            s1 = np.mean(hit != lab[real][ins]) if ins.any() else 1.0
            # drawn cells -> real: how many fall outside the real region
            back = real_label((cells[drawn] - t) @ np.linalg.inv(A).T)
            s2 = np.mean(back != cell_lab[drawn])
            return s1 + s2

        return score

    def fit(score, start, restarts, iters):
        rng = np.random.default_rng(0)
        step = np.array([0.1, 0.1, 1, 0.1, 0.1, 1])
        best = (start, score(start))
        for k in range(restarts):
            jitter = rng.normal(0, 1, 6) * step * (k > 0)
            x, v = nelder_mead(score, best[0] + jitter, step, iters)
            if v < best[1]:
                best = (x, v)
        return best

    X = np.array([[*to_km(*a)[0], 1] for a, _ in LANDMARKS])
    Y = np.array([b for _, b in LANDMARKS])
    sol = np.linalg.lstsq(X, Y, rcond=None)[0].T
    p0 = np.r_[sol[0], sol[1]]

    with np.errstate(all="ignore"):
        glob, v = fit(make_score(["m", "x", "b"]), p0, 12, 1500)
        print(f"global fit mismatch {v:.3f}", file=sys.stderr)
        affine = {}
        for code in "mxb":
            p, v = fit(make_score([code]), glob, 8, 1200)
            print(f"{code} fit mismatch {v:.3f}", file=sys.stderr)
            affine[code] = [round(float(x), 5) for x in p]

    out_rings = {}
    for code, rs in rings.items():
        out_rings[code] = []
        for r in rs:
            if area(r) < 0.02:  # drop specks; keeps Liberty and Ellis Island
                continue
            s = simplify(r, 0.08)
            latlng = np.c_[s[:, 1] / KY + LAT0, s[:, 0] / KX + LNG0]
            out_rings[code].append([round(float(v), 4) for v in latlng.ravel()])

    with open(OUT, "w") as f:
        json.dump({"rings": out_rings, "affine": affine}, f, separators=(",", ":"))
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
