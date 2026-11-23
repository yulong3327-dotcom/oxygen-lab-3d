import * as T from '../vendor/three-r160/three.module.min.js';

export function groundedCable(a, b, waypoints = [], floor = .006, exits, clearCurve) {
  const flat = point => new T.Vector3(point.x, floor, point.z);
  const start = flat(exits?.[0] ?? a), end = flat(exits?.[1] ?? b);
  const guide = [start];
  for (const next of [...waypoints.map(flat), end]) {
    if (guide.at(-1).distanceToSquared(next) > 1e-8) guide.push(next);
  }
  const path = new T.CurvePath();
  if (guide.length < 2) {
    const lift = Math.max(a.y, b.y) + .012;
    path.add(new T.CubicBezierCurve3(a, a.clone().setY(lift), b.clone().setY(lift), b));
    return path;
  }

  const buildPlug = (post, edge, next, reverse) => {
    const direction = next.clone().sub(edge);
    const run = Math.min(.026, direction.length() * .26);
    direction.normalize();
    const foot = edge.clone().addScaledVector(direction, run);
    const low = foot.clone().addScaledVector(direction, -run * .42);
    const cubic = (p, c1, c2, q) => new T.CubicBezierCurve3(p, c1, c2, q);
    const height = exits?.[Number(reverse)].y;
    const out = edge.clone().sub(post).setY(0);
    const width = out.length();
    if (!width || height === undefined) {
      const head = post.clone().addScaledVector(direction, run * .18);
      head.y += Math.min(.012, Math.max(.005, (post.y - floor) * .20));
      return { foot, curves: [cubic(post, head, low, foot)] };
    }
    out.normalize();
    const high = Math.max(post.y, height) + .007;
    const corner = edge.clone().setY(high);
    const first = post.clone().setY(high);
    const near = corner.clone().addScaledVector(out, -Math.min(.018, width * .40));
    const launch = corner.clone().addScaledVector(out, Math.min(.011, run * .44));
    return { foot, curves: [cubic(post, first, near, corner), cubic(corner, launch, low, foot)] };
  };
  function addPlug(curves, reverse) {
    if (reverse) {
      for (const { v0, v1, v2, v3 } of curves.toReversed()) path.add(new T.CubicBezierCurve3(v3, v2, v1, v0));
    } else {
      for (const curve of curves) path.add(curve);
    }
  }

  const startPlug = buildPlug(a, start, guide[1], false);
  const endPlug = buildPlug(b, end, guide.at(-2), true);
  addPlug(startPlug.curves, false);
  const floorGuide = [startPlug.foot, ...guide.slice(1, -1), endPlug.foot];
  let cursor = startPlug.foot;
  const addSpan = p => {
    const length = cursor.distanceTo(p);
    if (length < 1e-5) { cursor = p; return; }
    if (clearCurve && floorGuide.length === 2 && length > .080) {
      const tangent = p.clone().sub(cursor).normalize();
      const normal = new T.Vector3(-tangent.z, 0, tangent.x);
      const slack = Math.min(.024, length * .14);
      // Both halves share the chord tangent at the join and at the rounded corners.
      for (const side of [1, -1, .5, -.5]) {
        const midpoint = cursor.clone().lerp(p, .5).addScaledVector(normal, slack * side);
        const bowOut = new T.CubicBezierCurve3(cursor, cursor.clone().addScaledVector(tangent, length * .19),
          midpoint.clone().addScaledVector(tangent, -length * .18), midpoint);
        const bowIn = new T.CubicBezierCurve3(midpoint, midpoint.clone().addScaledVector(tangent, length * .18),
          p.clone().addScaledVector(tangent, -length * .19), p);
        if (clearCurve(bowOut) && clearCurve(bowIn)) {
          path.add(bowOut);
          path.add(bowIn);
          cursor = p;
          return;
        }
      }
    }
    path.add(new T.LineCurve3(cursor, p));
    cursor = p;
  };

  for (let i = 1; i < floorGuide.length - 1; i++) {
    const corner = floorGuide[i];
    const prev = floorGuide[i - 1].clone().sub(corner);
    const next = floorGuide[i + 1].clone().sub(corner);
    const trim = Math.min(.042, prev.length() * .42, next.length() * .42);
    prev.normalize();
    next.normalize();
    if (prev.dot(next) > -.9998 && prev.dot(next) < .9998) {
      let rounded = false;
      for (const ratio of [1, .72, .49, .28, .14, .065, .02, .005]) {
        const before = corner.clone().addScaledVector(prev, trim * ratio);
        const after = corner.clone().addScaledVector(next, trim * ratio);
        const turn = new T.QuadraticBezierCurve3(before, corner, after);
        if (clearCurve && !clearCurve(turn)) continue;
        addSpan(before);
        path.add(turn);
        cursor = after;
        rounded = true;
        break;
      }
      if (rounded) continue;
    }
    addSpan(corner);
  }
  addSpan(endPlug.foot);
  addPlug(endPlug.curves, true);
  return path;
}

export function cableCrosses(from, to, bounds) {
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = to[axis] - from[axis];
    const min = bounds[axis * 2] + .0001, max = bounds[axis * 2 + 1] - .0001;
    if (Math.abs(delta) < 1e-7) {
      if (from[axis] <= min || from[axis] >= max) return false;
      continue;
    }
    const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (hi <= lo) return false;
  }
  return true;
}

export function cableDetour(start, finish, bounds) {
  const clear = (a, b) => !bounds.some(box => cableCrosses(a, b, box));
  if (clear(start, finish)) return [];
  const corners = bounds.flatMap(([left, right, back, front]) =>
    [[left, back], [right, back], [left, front], [right, front]]);
  const nodes = [start, finish, ...corners.filter(([x, z]) =>
    !bounds.some(([l, r, b, f]) => x > l && x < r && z > b && z < f))];
  const costs = nodes.map((_, i) => i ? Infinity : 0);
  const previous = nodes.map(() => -1), visited = new Set();
  for (;;) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited.has(i) && costs[i] < (costs[current] ?? Infinity)) current = i;
    }
    if (current < 0) return null;
    if (current === 1) break;
    visited.add(current);
    const p = nodes[current];
    for (let i = 1; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const q = nodes[i], distance = costs[current] + Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (distance < costs[i] && clear(p, q)) {
        costs[i] = distance;
        previous[i] = current;
      }
    }
  }
  const result = [];
  for (let i = previous[1]; i > 0; i = previous[i]) result.unshift(nodes[i]);
  return result;
}

/** Build one routing snapshot for the current positions of the 3D apparatus. */
export function createCableRouter(devices) {
  const flat = ({ x, z }) => [x, z];
  const within = ([x, z], [l, r, b, f]) => x > l && x < r && z > b && z < f;
  const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const bodies = [...devices].map(({ group, faceFront }) => {
    const { min, max } = new T.Box3().setFromObject(group);
    const box = margin => [min.x - margin, max.x + margin, min.z - margin, max.z + margin];
    return { group, faceFront, box: box(.006), clearance: box(.004), top: max.y };
  });
  const byGroup = new Map(bodies.map(body => [body.group, body]));
  const boxes = bodies.map(body => body.box);

  function exits({ group, position: p }) {
    const own = byGroup.get(group);
    const [l, r, back, front] = own.box;
    const directions = [[l, p.z], [r, p.z], [p.x, back], [p.x, front]];
    const origin = flat(p);
    const nearest = Math.min(...directions.map(at => distance(origin, at)));
    const face = new T.Vector3(0, 0, 1).transformDirection(group.matrixWorld);
    return directions.map(at => {
      const span = distance(origin, at);
      const towardFace = (at[0] - p.x) * face.x + (at[1] - p.z) * face.z > .001;
      const across = own.faceFront ? !towardFace : span > nearest + .038;
      return {
        at, cost: span + (across ? .33 : 0),
        height: across ? Math.max(p.y, own.top) : p.y,
        safe: !bodies.some(body => body !== own && cableCrosses(origin, at, body.box))
      };
    }).filter(exit => exit.safe);
  }

  function clearCurve(curve) {
    const samples = curve.getPoints(14).map(flat);
    return !samples.some((p, i) => i && bodies.some(body => cableCrosses(samples[i - 1], p, body.clearance)));
  }

  return function route(from, to, preferred = []) {
    const a = from.position, b = to.position;
    const guides = preferred.filter(at => !boxes.some(box => within(at, box)));
    const attempts = exits(from).flatMap(start => exits(to).map(end => ({
      start, end, cost: start.cost + end.cost + (guides.length
        ? distance(start.at, guides[0]) + distance(guides.at(-1), end.at)
        : distance(start.at, end.at))
    }))).sort((a, b) => a.cost - b.cost);
    for (const { start, end } of attempts) {
      const targets = [start.at, ...guides, end.at];
      const path = [];
      let possible = true;
      for (let i = 1; i < targets.length; i++) {
        const bends = cableDetour(targets[i - 1], targets[i], boxes);
        if (!bends) { possible = false; break; }
        path.push(...bends);
        if (i < targets.length - 1) path.push(targets[i]);
      }
      if (!possible) continue;
      const exitPoint = ({ at: [x, z], height }) => new T.Vector3(x, height, z);
      return groundedCable(a, b, path.map(([x, z]) => new T.Vector3(x, 0, z)), .004,
        [exitPoint(start), exitPoint(end)], clearCurve);
    }
    const lift = Math.max(...bodies.map(body => body.top), a.y, b.y) + .015;
    return new T.CubicBezierCurve3(a, a.clone().setY(lift * 1.45), b.clone().setY(lift * 1.45), b);
  };
}
