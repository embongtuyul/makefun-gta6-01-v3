// utils.js — small shared helpers: seeded RNG, math, collision.
// No three.js dependency here so the helpers stay testable on their own.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rand(rng, a, b) {
  return a + rng() * (b - a);
}

export function randInt(rng, a, b) {
  return Math.floor(rand(rng, a, b + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Frame-rate independent exponential smoothing.
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// Shortest-arc angle interpolation (radians).
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Push a circle (x, z, radius) out of a list of axis-aligned boxes.
// Each box: { minX, maxX, minZ, maxZ }. Returns { x, z, hit }.
export function collideCircleBoxes(x, z, r, boxes) {
  let hit = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pushL = x - b.minX + r;
        const pushR = b.maxX - x + r;
        const pushU = z - b.minZ + r;
        const pushD = b.maxZ - z + r;
        const m = Math.min(pushL, pushR, pushU, pushD);
        if (m === pushL) x = b.minX - r;
        else if (m === pushR) x = b.maxX + r;
        else if (m === pushU) z = b.minZ - r;
        else z = b.maxZ + r;
      }
    }
  }
  return { x, z, hit };
}

export function pointInBox(x, z, b, pad) {
  const p = pad || 0;
  return x >= b.minX - p && x <= b.maxX + p && z >= b.minZ - p && z <= b.maxZ + p;
}
