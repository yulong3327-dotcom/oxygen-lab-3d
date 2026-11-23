import assert from 'node:assert/strict';
import test from 'node:test';
import { SANDBOX_ELECTRICAL, solveSandbox } from '../platform/sandbox-circuit.js';

const pairs = (...connections) => connections.map(wire => wire.split(' '));
const about = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected}, got ${actual}`);
const { supplyOhms, ammeterOhms, voltmeterOhms } = SANDBOX_ELECTRICAL;
const parallel = (a, b) => (a * b) / (a + b);

test('unpowered and open branches have no current, and a reversed meter reports a negative reading', () => {
  const devices = [
    { id: 'e', kind: 'power' },
    { id: 's', kind: 'switch', closed: false },
    { id: 'a', kind: 'ammeter' },
    { id: 'r', kind: 'resistor' },
    { id: 'v', kind: 'voltmeter' },
    { id: 'spare', kind: 'ammeter' }
  ];
  const wires = pairs('e:p s:p', 's:n a:n', 'a:p r:p', 'r:n e:n', 'v:p r:n', 'v:n r:p');
  assert.deepEqual(solveSandbox(devices, wires), {
    readings: { a: 0, v: 0, spare: 0 }, currents: { e: 0, a: 0, v: 0, r: 0, spare: 0 }, shorted: []
  });
  const energized = solveSandbox(devices.map(device => device.id === 's' ? { ...device, closed: true } : device), wires);
  const load = parallel(10, voltmeterOhms);
  const expected = 6 / (supplyOhms + ammeterOhms + load);
  assert.deepEqual(energized.shorted, []);
  about(energized.readings.a, -expected);
  about(energized.readings.v, -expected * load);
  assert.equal(energized.readings.spare, 0);
});

test('a multi-branch network produces correct current in each branch and at the source', () => {
  const devices = [
    { id: 'e', kind: 'power' },
    { id: 'main', kind: 'ammeter' },
    { id: 'a1', kind: 'ammeter' }, { id: 'a2', kind: 'ammeter' },
    { id: 'r1', kind: 'resistor' }, { id: 'r2', kind: 'resistor' }, { id: 'r3', kind: 'resistor' },
    { id: 'v', kind: 'voltmeter' }
  ];
  const wires = pairs(
    'e:p main:p', 'main:n a1:p', 'main:n a2:p', 'a1:n r1:p', 'a2:n r2:p',
    'r2:n r3:p', 'r1:n e:n', 'r3:n e:n', 'v:p main:n', 'v:n e:n'
  );
  const result = solveSandbox(devices, wires);
  const load = parallel(parallel(10 + ammeterOhms, 20 + ammeterOhms), voltmeterOhms);
  const main = 6 / (supplyOhms + ammeterOhms + load);
  assert.deepEqual(result.shorted, []);
  about(result.readings.main, main);
  about(result.readings.v, main * load);
  about(result.readings.a1, result.readings.v / (10 + ammeterOhms));
  about(result.readings.a2, result.readings.v / (20 + ammeterOhms));
  about(result.readings.main, result.readings.a1 + result.readings.a2 + result.readings.v / voltmeterOhms);
});

test('the rheostat works end to end and as a three-terminal divider with equivalent slider posts', () => {
  const devices = [
    { id: 'e', kind: 'power' },
    { id: 'r', kind: 'rheostat', position: 0.25 },
    { id: 'a', kind: 'ammeter' },
    { id: 'v1', kind: 'voltmeter' },
    { id: 'v2', kind: 'voltmeter' }
  ];
  const wires = pairs('e:p a:p', 'a:n r:p', 'r:b e:n', 'v1:p r:c', 'v1:n r:p', 'v2:p r:n', 'v2:n r:b');
  const left = parallel(12.5, voltmeterOhms);
  const right = parallel(37.5, voltmeterOhms);
  const current = 6 / (supplyOhms + ammeterOhms + left + right);
  const result = solveSandbox(devices, wires);
  assert.deepEqual(result.shorted, []);
  about(result.readings.a, current);
  about(result.readings.v1, -current * left);
  about(result.readings.v2, current * right);

  const end = solveSandbox(devices.map(device => device.id === 'r' ? { ...device, position: 0 } : device), wires);
  assert.deepEqual(end.shorted, []);
  assert.equal(end.readings.v1, 0);
  about(end.readings.a, 6 / (supplyOhms + ammeterOhms + parallel(50, voltmeterOhms)));
});

test('current in one-up one-down rheostat wiring changes with the selected end and slider position', () => {
  const devices = [
    { id: 'e', kind: 'power' }, { id: 'a', kind: 'ammeter' },
    { id: 'r', kind: 'rheostat', position: 0.25 }
  ];
  for (const [fixed, expected] of [['p', 12.5], ['b', 37.5]]) {
    for (const wiper of ['c', 'n']) {
      const result = solveSandbox(devices, pairs('e:p a:p', `a:n r:${fixed}`, `r:${wiper} e:n`));
      assert.deepEqual(result.shorted, []);
      about(result.readings.a, 6 / (supplyOhms + ammeterOhms + expected));
    }
  }
});

test('through a shorted ammeter or closed switch, protection suppresses readings only in the affected network', () => {
  const devices = [
    { id: 'tripped', kind: 'power' }, { id: 'healthy', kind: 'power' },
    { id: 'a', kind: 'ammeter' }, { id: 'v', kind: 'voltmeter' },
    { id: 'other', kind: 'voltmeter' }, { id: 's', kind: 'switch', closed: true }
  ];
  const healthy = ['healthy:p other:p', 'other:n healthy:n'];
  for (const bad of [['tripped:p a:p', 'a:n tripped:n'], ['tripped:p s:p', 's:n tripped:n'], ['tripped:p tripped:n']]) {
    const result = solveSandbox(devices, pairs(...healthy, ...bad, 'tripped:p v:p', 'tripped:n v:n'));
    assert.deepEqual(result.shorted, ['tripped']);
    assert.equal(Object.hasOwn(result.readings, 'v'), false);
    if (bad[0].includes('a:p')) assert.equal(Object.hasOwn(result.readings, 'a'), false);
    about(result.readings.other, 6 * voltmeterOhms / (supplyOhms + voltmeterOhms));
  }
});

test('source stacks and matching parallel sources are valid, opposing sources trip protection', () => {
  const devices = [
    { id: 'e1', kind: 'power' }, { id: 'e2', kind: 'power' }, { id: 'v', kind: 'voltmeter' }
  ];
  const series = solveSandbox(devices, pairs('e1:p v:p', 'e1:n e2:p', 'e2:n v:n'));
  assert.deepEqual(series.shorted, []);
  about(series.readings.v, 12 * voltmeterOhms / (2 * supplyOhms + voltmeterOhms));

  const matched = solveSandbox(devices, pairs('e1:p e2:p', 'e1:n e2:n', 'e1:p v:p', 'e1:n v:n'));
  assert.deepEqual(matched.shorted, []);
  about(matched.readings.v, 6 * voltmeterOhms / (supplyOhms / 2 + voltmeterOhms));

  const opposed = solveSandbox(devices, pairs('e1:p e2:n', 'e1:n e2:p', 'e1:p v:p', 'e1:n v:n'));
  assert.deepEqual(opposed.shorted.toSorted(), ['e1', 'e2']);
  assert.deepEqual(opposed.readings, {});
});

test('battery variants add their cell voltages, and the three alternative meters give signed readings', () => {
  const devices = [
    { id: 'one', kind: 'battery-single' }, { id: 'two', kind: 'battery-pack' },
    { id: 'mA', kind: 'multimeter-current' }, { id: 'mV', kind: 'multimeter-voltage' },
    { id: 'g', kind: 'galvanometer' }, { id: 'box', kind: 'resistance-box', ohms: 1400 }
  ];
  const wires = pairs('two:n one:p', 'two:p mA:p', 'mA:n g:n', 'g:p box:p', 'box:n one:n', 'mV:p one:n', 'mV:n two:p');
  const result = solveSandbox(devices, wires);
  const load = 1400 + 100 + ammeterOhms;
  const equivalent = parallel(load, voltmeterOhms);
  const terminalVoltage = 4.5 * equivalent / (equivalent + 0.3);
  assert.deepEqual(result.shorted, []);
  about(result.readings.mA, terminalVoltage / load);
  about(result.readings.g, -terminalVoltage / load);
  about(result.readings.mV, -terminalVoltage);
  about(result.currents.box, terminalVoltage / load);
  about(result.currents.one, -terminalVoltage / equivalent);
  assert.deepEqual(solveSandbox(devices, [['two:p', 'two:n']]).shorted, ['two']);
});

test('SPDT connects only the selected branch and returns zero with neither throw selected', () => {
  const loads = [{ id: 'lamp', kind: 'lamp-bulb' }, { id: 'bell', kind: 'bell' }];
  const connections = pairs('e:p s:p', 's:n lamp:p', 's:b bell:p', 'lamp:n e:n', 'bell:n e:n');
  for (const position of [0, 1, 2]) {
    const result = solveSandbox([{ id: 'e', kind: 'battery-pack' }, { id: 's', kind: 'switch-spdt', throw: position }, ...loads], connections);
    assert.deepEqual(result.shorted, []);
    about(result.currents.lamp, position === 1 ? 3 / (0.2 + 30) : 0);
    about(result.currents.bell, position === 2 ? 3 / (0.2 + 100) : 0);
  }
});

test('LED conducts only forward and above threshold, including multiple LEDs in series', () => {
  const common = [{ id: 'limiter', kind: 'resistance-box', ohms: 220 }, { id: 'd', kind: 'led' }];
  const devices = kind => [{ id: 'e', kind }, ...common];
  const forward = pairs('e:p limiter:p', 'limiter:n d:p', 'd:n e:n');
  const reverse = pairs('e:p limiter:p', 'limiter:n d:n', 'd:p e:n');
  assert.equal(solveSandbox(devices('battery-single'), forward).currents.d, 0);
  assert.equal(solveSandbox(devices('battery-pack'), reverse).currents.d, 0);
  about(solveSandbox(devices('battery-pack'), forward).currents.d, (3 - 1.8) / (220 + 10 + 0.2));
  const chain = solveSandbox([...devices('power'), { id: 'd2', kind: 'led' }],
    pairs('e:p limiter:p', 'limiter:n d:p', 'd:n d2:p', 'd2:n e:n'));
  assert.deepEqual(chain.shorted, []);
  about(chain.currents.d, (6 - 2 * 1.8) / (220 + 2 * 10 + supplyOhms));
  about(chain.currents.d2, chain.currents.d);
});

test('the potentiometer divider and pencil rheostat keep different terminal layouts', () => {
  const divider = solveSandbox([
    { id: 'e', kind: 'battery-pack' }, { id: 'pot', kind: 'potentiometer', position: 0.25 },
    { id: 'v', kind: 'multimeter-voltage' }
  ], pairs('e:p pot:p', 'pot:n e:n', 'v:p pot:c', 'v:n pot:n'));
  const lower = parallel(15, voltmeterOhms);
  about(divider.readings.v, 3 * lower / (0.2 + 5 + lower));

  for (const side of ['p', 'b']) {
    const pencil = solveSandbox([
      { id: 'e', kind: 'battery-pack' }, { id: 'pencil', kind: 'pencil-rheostat', position: 0.25 },
      { id: 'lamp', kind: 'lamp-bulb' }
    ], pairs('e:p lamp:p', `lamp:n pencil:${side}`, 'pencil:n e:n'));
    about(pencil.currents.lamp, 3 / (0.2 + 30 + (side === 'p' ? 10 : 30)));
  }
});

test('each additional two-terminal load reports its equivalent DC branch current', () => {
  const loads = [
    ['resistance-wire', 11], ['joule-calorimeter', 10], ['buzzer', 100],
    ['motor-fan', 15], ['motor-bare', 15], ['solenoid', 10]
  ];
  const devices = [{ id: 'e', kind: 'battery-pack' }, ...loads.map(([kind]) => ({ id: kind, kind }))];
  const wires = pairs(...loads.flatMap(([id], index) => index % 2 === 0
    ? [`e:p ${id}:p`, `${id}:n e:n`] : [`e:p ${id}:n`, `${id}:p e:n`]));
  const terminalVoltage = 3 / (1 + 0.2 * loads.reduce((sum, [, resistance]) => sum + 1 / resistance, 0));
  const result = solveSandbox(devices, wires);
  assert.deepEqual(result.shorted, []);
  loads.forEach(([id, resistance], index) => about(result.currents[id], (index % 2 ? -1 : 1) * terminalVoltage / resistance));
});
