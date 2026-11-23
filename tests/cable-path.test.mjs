import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, Vector3 } from '../vendor/three-r160/three.module.min.js';
import { cableCrosses, cableDetour, createCableRouter, groundedCable } from '../platform/cable-path.js';

const point = (x, z, y = 0) => new Vector3(x, y, z);
const flat = ({ x, z }) => [x, z];
const floor = .004;

function checkTangents(path) {
  for (let i = 1; i < path.curves.length; i++) {
    const prior = path.curves[i - 1], next = path.curves[i];
    assert.ok(prior.getPoint(1).distanceTo(next.getPoint(0)) < 1e-8, `disconnected join ${i}`);
    const dot = prior.getTangent(1).dot(next.getTangent(0));
    assert.ok(dot > .999, `tangent mismatch at join ${i}: ${dot}`);
  }
}

test('the cable leaves its terminal and settles into a rounded turn without a directional kink', () => {
  const a = point(-.16, -.025, .033), b = point(.18, .1, .044);
  const exits = [point(-.12, -.025, .04), point(.14, .1, .044)];
  const path = groundedCable(a, b, [point(-.095, -.085), point(.078, -.083)], floor, exits, () => true);
  assert.deepEqual(path.getPoint(0), a);
  assert.ok(path.getPoint(1).distanceTo(b) < 1e-8);
  assert.ok(path.getPoints(200).every(p => p.y >= floor - 1e-8));
  checkTangents(path);
});

test('a rounded detour stays outside the equipment footprint and remains smooth', () => {
  const padded = [-.072, .072, -.072, .072];
  const footprint = [-.054, .054, -.054, .054];
  const a = point(-.17, 0, .034), b = point(.17, 0, .034);
  const exits = [point(-.128, 0, .04), point(.128, 0, .04)];
  const detour = cableDetour(flat(exits[0]), flat(exits[1]), [padded]);
  assert.ok(detour.length >= 2);
  const isClear = points => !points.some((p, i) => i && cableCrosses(flat(points[i - 1]), flat(p), footprint));
  const path = groundedCable(a, b, detour.map(([x, z]) => point(x, z)), floor, exits, curve => isClear(curve.getPoints(24)));
  checkTangents(path);
  assert.ok(isClear(path.getPoints(350)));
});

test('the shared router finds a grounded route around apparatus without preferred waypoints', () => {
  function box(x, z, width, depth) {
    const group = new Group();
    const body = new Mesh(new BoxGeometry(width, .035, depth));
    body.position.y = .0175;
    group.add(body);
    group.position.set(x, 0, z);
    return group;
  }
  const left = box(-.16, 0, .07, .07);
  const right = box(.16, 0, .07, .07);
  const middle = box(0, 0, .09, .16);
  const apparatus = [left, right, middle].map(group => ({ group }));
  const a = { group: left, position: point(-.142, 0, .037) };
  const b = { group: right, position: point(.142, 0, .037) };
  const path = createCableRouter(apparatus)(a, b);
  const samples = path.getPoints(350);
  assert.ok(path.getPoint(0).distanceTo(a.position) < 1e-8);
  assert.ok(path.getPoint(1).distanceTo(b.position) < 1e-8);
  assert.ok(samples.some(p => p.y <= floor + 1e-7));
  assert.ok(!samples.some((p, i) => i && cableCrosses(flat(samples[i - 1]), flat(p), [-.048, .048, -.083, .083])));
  checkTangents(path);
});
