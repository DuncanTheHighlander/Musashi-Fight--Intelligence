"""Evaluate a replay JSON against candidate detections.
Usage: eval_replay.py <replay.json> <cands1,cands2,...>
Metrics: identity switches (fight portion), drift frames, mean/max tightness,
ghost frames post-cut (f>=267).
"""
import sys, json, math, os

rep_file, cand_files = sys.argv[1], sys.argv[2].split(",")
cands = []
for f in cand_files:
    cands += json.load(open(f))
cands = {c["f"]: c for c in cands}
rep = {r["f"]: r for r in json.load(open(rep_file))}
CUT = int(os.environ.get("CUT", "267"))

def col(c):
    u = c.get("color", {}).get("upper")
    return (u["r"], u["g"], u["b"]) if u else None

refs = {"L": [], "R": []}
for f in range(0, 80):
    c = cands.get(f)
    if not c or len(c["candidates"]) != 2: continue
    a, b = c["candidates"]
    if abs(a["anchor"]["x"] - b["anchor"]["x"]) < 0.15: continue
    left, right = (a, b) if a["anchor"]["x"] < b["anchor"]["x"] else (b, a)
    if col(left): refs["L"].append(col(left))
    if col(right): refs["R"].append(col(right))
mL = tuple(sum(v) / len(v) for v in zip(*refs["L"]))
mR = tuple(sum(v) / len(v) for v in zip(*refs["R"]))

def ident(c):
    cc = col(c)
    if not cc: return None
    dL = sum((x - y) ** 2 for x, y in zip(cc, mL))
    dR = sum((x - y) ** 2 for x, y in zip(cc, mR))
    if abs(dL - dR) < 0.01: return None
    return "L" if dL < dR else "R"

def anchor_of(skel):
    pts = [skel[i] for i in (11, 12, 23, 24) if i < len(skel)]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

switches = {}
for slot in ("A", "B"):
    seq = []
    for f in sorted(cands):
        if f >= CUT: continue
        c, r = cands[f], rep.get(f)
        if not r or len(c["candidates"]) != 2 or not r.get("raw" + slot) or not r.get(slot): continue
        ax, ay = anchor_of(r[slot])
        ds = [math.hypot(ax - cc["anchor"]["x"], ay - cc["anchor"]["y"]) for cc in c["candidates"]]
        if min(ds) > 0.08: continue
        i = ident(c["candidates"][ds.index(min(ds))])
        if i: seq.append(i)
    switches[slot] = sum(1 for a, b in zip(seq, seq[1:]) if a != b)

drift = {"A": 0, "B": 0}
dists = []
for f in sorted(cands):
    if f >= CUT: continue
    c, r = cands[f], rep.get(f)
    if not r or not c["candidates"]: continue
    for s in ("A", "B"):
        if not r.get(s): continue
        ax, ay = anchor_of(r[s])
        d = min(math.hypot(ax - cc["anchor"]["x"], ay - cc["anchor"]["y"]) for cc in c["candidates"])
        dists.append(d)
        if d > 0.05: drift[s] += 1

ghost = sum(1 for f, r in rep.items() if f >= CUT and r.get("A") and not r.get("rawA"))
mean_d = sum(dists) / max(1, len(dists))
p95 = sorted(dists)[int(len(dists) * 0.95)] if dists else 0
print(f"{rep_file}: switches A {switches['A']} B {switches['B']} | "
      f"drift>0.05 A {drift['A']} B {drift['B']} | "
      f"tightness mean {mean_d:.4f} p95 {p95:.4f} | ghostA post-cut {ghost}")
