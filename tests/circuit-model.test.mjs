import assert from 'node:assert/strict';
import test from 'node:test';
import { CIRCUIT_SPEC, checkWiring, measureCircuit } from '../platform/circuit-model.js';

const standard = [
  ['power:p', 'switch:p'],
  ['switch:n', 'ammeter:p'],
  ['ammeter:n', 'resistor:p'],
  ['resistor:n', 'rheostat:p'],
  ['rheostat:c', 'power:n'],
  ['resistor:p', 'voltmeter:p'],
  ['resistor:n', 'voltmeter:n']
];

const relabel = (wires, labels) => wires.map(wire => wire.map(id => labels[id] ?? id));
const about = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

test('wiring accepts both fixed ends and wiper posts without treating wire direction as polarity', () => {
  for (const fixed of ['rheostat:p', 'rheostat:b']) {
    for (const wiper of ['rheostat:c', 'rheostat:n']) {
      const wires = relabel(standard, { 'rheostat:p': fixed, 'rheostat:c': wiper });
      const result = checkWiring(wires.toReversed().map(wire => wire.toReversed()));
      assert.equal(result.ok, true, result.message);
      assert.equal(result.fixedTerminal, fixed);
      assert.equal(result.maxPosition, fixed === 'rheostat:p' ? 1 : 0);
    }
  }
});

test('wiring recognizes alternate series order and voltmeter leads on equivalent nodes', () => {
  const result = checkWiring([
    ['power:p', 'resistor:n'],
    ['resistor:p', 'rheostat:n'],
    ['rheostat:b', 'ammeter:p'],
    ['ammeter:n', 'switch:n'],
    ['switch:p', 'power:n'],
    ['power:p', 'voltmeter:p'],
    ['rheostat:n', 'voltmeter:n']
  ]);
  assert.equal(result.ok, true, result.message);
});

test('wiring diagnoses reversed meters without assigning a polarity to a fixed resistor', () => {
  assert.equal(checkWiring(relabel(standard, { 'ammeter:p': 'ammeter:n', 'ammeter:n': 'ammeter:p' })).code, 'ammeter-polarity');
  assert.equal(checkWiring(relabel(standard, { 'voltmeter:p': 'voltmeter:n', 'voltmeter:n': 'voltmeter:p' })).code, 'voltmeter-polarity');
  assert.equal(checkWiring(relabel(standard, { 'resistor:p': 'resistor:n', 'resistor:n': 'resistor:p' })).ok, true);
});

test('wiring rejects a bypass, open circuit, short, and unsuitable rheostat posts', () => {
  assert.equal(checkWiring([...standard, ['ammeter:p', 'ammeter:n']]).code, 'ammeter-bypassed');
  assert.equal(checkWiring(standard.slice(1)).code, 'incomplete');
  assert.equal(checkWiring([['power:p', 'power:n']]).code, 'short-circuit');
  assert.equal(checkWiring([
    ['power:p', 'ammeter:p'], ['ammeter:n', 'switch:p'], ['switch:n', 'power:n']
  ]).code, 'short-circuit');
  assert.equal(checkWiring(relabel(standard, { 'rheostat:c': 'rheostat:b' })).code, 'rheostat-ports');
  assert.equal(checkWiring(relabel(standard, { 'rheostat:p': 'rheostat:n' })).code, 'rheostat-ports');
  assert.equal(checkWiring([...standard, standard[0].toReversed()]).code, 'redundant-wire');
});

test('wiring rejects a voltmeter across other nodes and series/power branches', () => {
  assert.equal(checkWiring([
    ...standard.slice(0, 5),
    ['rheostat:p', 'voltmeter:p'],
    ['rheostat:c', 'voltmeter:n']
  ]).code, 'voltmeter-placement');
  assert.equal(checkWiring([
    ...standard.slice(0, 4),
    ['rheostat:c', 'voltmeter:p'],
    ['voltmeter:n', 'power:n']
  ]).code, 'voltmeter-placement');
  assert.equal(checkWiring([
    ['power:p', 'switch:p'],
    ['switch:n', 'ammeter:p'],
    ['switch:n', 'rheostat:p'],
    ['ammeter:n', 'resistor:p'],
    ['resistor:n', 'power:n'],
    ['rheostat:c', 'power:n'],
    ['resistor:p', 'voltmeter:p'],
    ['resistor:n', 'voltmeter:n']
  ]).code, 'series-loop');
});

test('measurements use the connected side of the slider and respect open and closed states', () => {
  const left = checkWiring(standard);
  const right = checkWiring(relabel(standard, { 'rheostat:p': 'rheostat:b' }));
  assert.deepEqual(measureCircuit(left, left.maxPosition, false), { voltage: 0, current: 0, rheostatOhms: 50 });
  assert.deepEqual(measureCircuit(checkWiring([]), 0.5, true), { voltage: 0, current: 0, rheostatOhms: null });
  for (const [position, voltage, current] of [[1, 1, 0.1], [0.4, 2, 0.2], [0.2, 3, 0.3], [0, 6, 0.6]]) {
    for (const [wiring, slider] of [[left, position], [right, 1 - position]]) {
      const reading = measureCircuit(wiring, slider, true);
      about(reading.voltage, voltage);
      about(reading.current, current);
      about(reading.voltage / reading.current, CIRCUIT_SPEC.resistorOhms);
      assert.ok(reading.voltage <= CIRCUIT_SPEC.voltmeterRange);
      assert.ok(reading.current <= CIRCUIT_SPEC.ammeterRange);
    }
  }
});
