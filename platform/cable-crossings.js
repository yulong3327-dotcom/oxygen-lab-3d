import { Curve, Vector3 } from '../vendor/three-r160/three.module.min.js';

const mix = (a, b, t) => a + (b - a) * t;
const gridSize = .045;

function* cells({ a, b }) {
  const bin = value => Math.floor(value / gridSize);
  for (let x = bin(Math.min(a.x, b.x)); x <= bin(Math.max(a.x, b.x)); x++) {
    for (let z = bin(Math.min(a.z, b.z)); z <= bin(Math.max(a.z, b.z)); z++) yield x + ':' + z;
  }
}

function crossing(first, second) {
  const rx = first.b.x - first.a.x, rz = first.b.z - first.a.z;
  const sx = second.b.x - second.a.x, sz = second.b.z - second.a.z;
  const qx = second.a.x - first.a.x, qz = second.a.z - first.a.z;
  const determinant = rx * sz - rz * sx;
  const scale = Math.hypot(rx, rz) * Math.hypot(sx, sz);
  if (!scale || Math.abs(determinant) < scale * .015) return null;
  const u = (qx * sz - qz * sx) / determinant;
  const v = (qx * rz - qz * rx) / determinant;
  const epsilon = 1e-7;
  if (u < -epsilon || u > 1 + epsilon || v < -epsilon || v > 1 + epsilon) return null;
  return [u, v, Math.abs(determinant) / scale];
}

function bridgeAt(bridges, at) {
  let lift = 0;
  for (const { center, rise, halfWidth } of bridges) {
    const ratio = Math.abs(at - center) / halfWidth;
    if (ratio < 1) lift = Math.max(lift, rise * (1 + Math.cos(Math.PI * ratio)) / 2);
  }
  return lift;
}

class BridgedCable extends Curve {
  constructor(base, length, bridges, radius) {
    super();
    this.base = base;
    this.length = length;
    this.bridges = bridges;
    this.arcLengthDivisions = Math.max(200, Math.ceil(length / (radius * .65)));
  }

  getPoint(t, target = new Vector3()) {
    const point = this.base.getPointAt(t, target);
    point.y += bridgeAt(this.bridges, t * this.length);
    return point;
  }
}

/** Later cables pass over earlier ones where their projected routes cross at the same height. */
export function buildCableStack(curves, radius = .0028) {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Cable radius must be positive.');
  if (curves.length < 2) return [...curves];
  const bins = new Map();
  const clearance = radius * 2.2;
  const endMargin = radius * 4;
  return curves.map(curve => {
    const length = curve.getLength();
    if (!(length > 0)) return curve;
    const steps = Math.max(4, Math.ceil(length / (radius * 2)));
    const points = Array.from({ length: steps + 1 }, (_, i) => curve.getPointAt(i / steps, new Vector3()));
    const bridges = [];
    const segments = points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1], start: i * length / steps, span: length / steps, length, bridges }));
    for (const segment of segments) {
      const candidates = new Set();
      for (const key of cells(segment)) for (const other of bins.get(key) ?? []) candidates.add(other);
      for (const other of candidates) {
        const hit = crossing(segment, other);
        if (!hit) continue;
        const [u, v, angle] = hit;
        const center = segment.start + u * segment.span;
        const previous = other.start + v * other.span;
        const available = Math.min(center, length - center);
        if (available <= endMargin || Math.min(previous, other.length - previous) <= endMargin) continue;
        const base = mix(segment.a.y, segment.b.y, u);
        const lower = mix(other.a.y, other.b.y, v);
        if (Math.abs(base - lower) > clearance) continue;
        const rise = lower + bridgeAt(other.bridges, previous) + clearance - base;
        if (rise <= 0) continue;
        const halfWidth = Math.min(available * .97, Math.max(radius * 5, 1.5 * clearance / Math.max(angle, .22)));
        const nearby = bridges.find(bridge => Math.abs(bridge.center - center) < radius * .1);
        if (nearby) {
          nearby.rise = Math.max(nearby.rise, rise);
          nearby.halfWidth = Math.max(nearby.halfWidth, halfWidth);
        } else bridges.push({ center, rise, halfWidth });
      }
    }
    for (const segment of segments) for (const key of cells(segment)) {
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(segment);
    }
    return bridges.length ? new BridgedCable(curve, length, bridges, radius) : curve;
  });
}
