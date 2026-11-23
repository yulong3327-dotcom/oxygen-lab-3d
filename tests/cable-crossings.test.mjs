import assert from 'node:assert/strict';
import test from 'node:test';
import { CurvePath, LineCurve3, QuadraticBezierCurve3, TubeGeometry, Vector3 } from '../vendor/three-r160/three.module.min.js';
import { buildCableStack } from '../platform/cable-crossings.js';

const point = (x, z, y = .004) => new Vector3(x, y, z);
const line = (a, b) => new LineCurve3(a, b);
const radius = .0028;
const floor = .004;

test('only the later cable lifts over a projected crossing and keeps its original ends', () => {
  const a = line(point(-.12, 0), point(.12, 0));
  const b = line(point(0, -.12), point(0, .12));
  const [under, over] = buildCableStack([a, b], radius);
  assert.equal(under, a);
  assert.notEqual(over, b);
  assert.ok(over.getPoint(.5).y - under.getPoint(.5).y > 2 * radius);
  assert.equal(over.getPoint(.25).y, floor);
  assert.deepEqual(over.getPoint(0), b.getPoint(0));
  assert.deepEqual(over.getPoint(1), b.getPoint(1));
  assert.ok(over.getPoint(.48).y < over.getPoint(.5).y);
  assert.ok(over.getPoint(.48).y > floor);
  const mesh = new TubeGeometry(over, 60, radius, 8, false);
  try {
    const vertices = mesh.getAttribute('position').array;
    assert.ok(vertices.every(Number.isFinite));
    mesh.computeBoundingBox();
    assert.ok(mesh.boundingBox.max.y > floor + 3 * radius);
  } finally {
    mesh.dispose();
  }
});

test('a third cable clears the previous bridge at a shared projected crossing', () => {
  const a = line(point(-.12, 0), point(.12, 0));
  const b = line(point(0, -.12), point(0, .12));
  const c = line(point(-.12, -.12), point(.12, .12));
  const stack = buildCableStack([a, b, c], radius).map(curve => curve.getPoint(.5));
  assert.ok(stack[1].y - stack[0].y > 2 * radius);
  assert.ok(stack[2].y - stack[1].y > 2 * radius);
});

test('common terminal endpoints, offset parallel routes and already separated heights stay untouched', () => {
  const a = line(point(0, 0), point(.2, 0));
  const b = line(point(0, 0), point(0, .2));
  const c = line(point(0, .02), point(.2, .02));
  const d = line(point(.08, -.12, .06), point(.08, .12, .06));
  const originals = [a, b, c, d];
  const result = buildCableStack(originals, radius);
  assert.ok(originals.every((curve, index) => result[index] === curve));
});

test('curved routes lift only near the actual intersection', () => {
  const a = line(point(-.1, 0), point(.1, 0));
  const b = new CurvePath();
  b.add(line(point(-.08, -.1, .03), point(-.04, -.055)));
  b.add(new QuadraticBezierCurve3(point(-.04, -.055), point(.05, -.016), point(.04, .055)));
  b.add(line(point(.04, .055), point(.04, .1, .03)));
  const [, result] = buildCableStack([a, b], radius);
  const original = Array.from({ length: 401 }, (_, i) => b.getPointAt(i / 400));
  const raised = Array.from({ length: 401 }, (_, i) => result.getPoint(i / 400));
  const crossing = original.findIndex(p => Math.abs(p.z) < .0003);
  assert.ok(crossing > 0);
  assert.ok(raised[crossing].y - original[crossing].y > 2 * radius);
  assert.deepEqual(raised[30], original[30]);
  assert.deepEqual(raised[370], original[370]);
});
