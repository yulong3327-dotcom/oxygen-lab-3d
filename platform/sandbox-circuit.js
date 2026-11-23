export const SANDBOX_ELECTRICAL = Object.freeze({
  supplyVoltage: 6,
  supplyOhms: 0.01,
  supplyLimitAmps: 2,
  ammeterOhms: 0.01,
  voltmeterOhms: 100_000,
  resistorOhms: 10,
  rheostatOhms: 50,
  singleBatteryVoltage: 1.5,
  batteryPackVoltage: 3,
  batteryOhmsPerCell: 0.1,
  lampOhms: 30,
  ledForwardVoltage: 1.8,
  ledForwardOhms: 10,
  ledOffOhms: 100_000_000,
  resistanceWireOhms: 11,
  resistanceBoxDefaultOhms: 10,
  resistanceBoxMaxOhms: 9999,
  pencilRheostatOhms: 40,
  potentiometerOhms: 20,
  calorimeterOhms: 10,
  buzzerOhms: 100,
  motorOhms: 15,
  solenoidOhms: 10,
  galvanometerOhms: 100,
  bellOhms: 100
});

const spec = SANDBOX_ELECTRICAL;
const sourcesByKind = {
  power: [spec.supplyVoltage, spec.supplyOhms],
  'battery-single': [spec.singleBatteryVoltage, spec.batteryOhmsPerCell],
  'battery-pack': [spec.batteryPackVoltage, 2 * spec.batteryOhmsPerCell]
};
const currentMeters = {
  ammeter: spec.ammeterOhms,
  galvanometer: spec.galvanometerOhms,
  'multimeter-current': spec.ammeterOhms
};
const voltageMeters = {
  voltmeter: spec.voltmeterOhms,
  'multimeter-voltage': spec.voltmeterOhms
};
// Steady-state equivalents; thermal transients, motion, and sound are not solved.
const fixedLoads = {
  resistor: spec.resistorOhms,
  'lamp-bulb': spec.lampOhms,
  'resistance-wire': spec.resistanceWireOhms,
  'joule-calorimeter': spec.calorimeterOhms,
  buzzer: spec.buzzerOhms,
  'motor-fan': spec.motorOhms,
  'motor-bare': spec.motorOhms,
  solenoid: spec.solenoidOhms,
  bell: spec.bellOhms
};

function disjointSets() {
  const parents = new Map();
  const find = id => {
    if (!parents.has(id)) parents.set(id, id);
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    while (id !== root) {
      const next = parents.get(id);
      parents.set(id, root);
      id = next;
    }
    return root;
  };
  return {
    find,
    join: (a, b) => parents.set(find(a), find(b))
  };
}

// One reference node is removed before solving each electrically separate group.
function solveVoltages(nodes, branches) {
  const active = [...nodes].slice(1);
  const index = new Map(active.map((node, i) => [node, i]));
  const count = active.length;
  const rows = active.map(() => new Float64Array(count + 1));
  for (const { p, n, ohms, emf } of branches) {
    if (p === n) continue;
    const i = index.get(p);
    const j = index.get(n);
    const g = 1 / ohms;
    const injection = emf * g;
    if (i !== undefined) {
      rows[i][i] += g;
      rows[i][count] += injection;
    }
    if (j !== undefined) {
      rows[j][j] += g;
      rows[j][count] -= injection;
    }
    if (i !== undefined && j !== undefined) {
      rows[i][j] -= g;
      rows[j][i] -= g;
    }
  }
  for (let column = 0; column < count; column++) {
    let pivot = column;
    for (let row = column + 1; row < count; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const diagonal = rows[column][column];
    if (!Number.isFinite(diagonal) || Math.abs(diagonal) < 1e-12) return null;
    for (let row = column + 1; row < count; row++) {
      const factor = rows[row][column] / diagonal;
      if (factor === 0) continue;
      for (let j = column + 1; j <= count; j++) rows[row][j] -= factor * rows[column][j];
      rows[row][column] = 0;
    }
  }
  const voltages = new Float64Array(count);
  for (let row = count - 1; row >= 0; row--) {
    let value = rows[row][count];
    for (let col = row + 1; col < count; col++) value -= voltages[col] * rows[row][col];
    voltages[row] = value / rows[row][row];
  }
  return node => voltages[index.get(node)] ?? 0;
}

const forward = voltage => Math.max(0, voltage - spec.ledForwardVoltage) / spec.ledForwardOhms;

function solveNetwork(nodes, branches) {
  let potential = solveVoltages(nodes, branches);
  if (!potential || !branches.some(branch => branch.kind === 'led')) return potential;
  const g = 1 / spec.ledOffOhms + 1 / spec.ledForwardOhms;
  const conducting = (branch, values) => branch.kind === 'led' &&
    values(branch.p) - values(branch.n) > spec.ledForwardVoltage;
  for (let iteration = 0; iteration < 64; iteration++) {
    const status = branches.map(branch => conducting(branch, potential));
    const candidate = solveVoltages(nodes, branches.map((branch, i) => status[i]
      ? { ...branch, ohms: 1 / g, emf: spec.ledForwardVoltage / (g * spec.ledForwardOhms) }
      : branch));
    if (!candidate) return null;
    if (branches.every((branch, i) => status[i] === conducting(branch, candidate))) return candidate;

    // Find the minimum along the Newton step; several LEDs may change state together.
    const start = potential;
    const direction = node => candidate(node) - start(node);
    const slope = t => branches.reduce((sum, { p, n, ohms, emf, kind }) => {
      const diff = direction(p) - direction(n);
      const voltage = start(p) - start(n) + t * diff;
      const current = (voltage - emf) / ohms + (kind === 'led' ? forward(voltage) : 0);
      return sum + current * diff;
    }, 0);
    let step = 1;
    if (slope(1) > 0) {
      let lo = 0, hi = 1;
      for (let j = 0; j < 36; j++) {
        const mid = (lo + hi) / 2;
        if (slope(mid) > 0) hi = mid;
        else lo = mid;
      }
      step = (lo + hi) / 2;
    }
    potential = node => start(node) + step * direction(node);
  }
  return null;
}

/**
 * Wires, closed switches and the two wiper posts are ideal connections. Sources
 * and meters have finite resistance. Readings and two-terminal branch currents
 * are signed (p-to-n) and omitted for a group whose supply protection trips.
 * The LED uses a piecewise linear forward drop and negligible off leakage.
 */
export function solveSandbox(devices, wires) {
  const nets = disjointSets();
  const devicePorts = new Set();
  const stamps = [];
  function branch(device, p, n, ohms, emf = 0) {
    if (ohms === 0) nets.join(p, n);
    else stamps.push({ id: device.id, kind: device.kind, p, n, ohms, emf });
  }
  for (const device of devices) {
    const { id, kind } = device;
    const p = `${id}:p`, n = `${id}:n`;
    devicePorts.add(p);
    devicePorts.add(n);
    if (Object.hasOwn(sourcesByKind, kind)) {
      const [emf, ohms] = sourcesByKind[kind];
      branch(device, p, n, ohms, emf);
    } else if (Object.hasOwn(currentMeters, kind)) branch(device, p, n, currentMeters[kind]);
    else if (Object.hasOwn(voltageMeters, kind)) branch(device, p, n, voltageMeters[kind]);
    else if (Object.hasOwn(fixedLoads, kind)) branch(device, p, n, fixedLoads[kind]);
    else if (kind === 'led') branch(device, p, n, spec.ledOffOhms);
    else if (kind === 'resistance-box') {
      const selected = Number.isFinite(device.ohms) ? device.ohms : spec.resistanceBoxDefaultOhms;
      branch(device, p, n, Math.min(spec.resistanceBoxMaxOhms, Math.max(0.001, selected)));
    } else if (kind === 'switch' && device.closed) nets.join(p, n);
    else if (kind === 'switch-spdt') {
      const b = `${id}:b`;
      devicePorts.add(b);
      if (device.throw === 1) nets.join(p, n);
      if (device.throw === 2) nets.join(p, b);
    } else if (['rheostat', 'pencil-rheostat', 'potentiometer'].includes(kind)) {
      const b = `${id}:b`, c = `${id}:c`;
      devicePorts.add(c);
      const position = Number.isFinite(device.position) ? Math.min(1, Math.max(0, device.position)) : 0.5;
      const x = position < 1e-8 ? 0 : position > 1 - 1e-8 ? 1 : position;
      const resistance = kind === 'potentiometer' ? spec.potentiometerOhms
        : kind === 'pencil-rheostat' ? spec.pencilRheostatOhms : spec.rheostatOhms;
      if (kind !== 'potentiometer') {
        devicePorts.add(b);
        nets.join(c, n);
      }
      branch(device, p, c, x * resistance);
      branch(device, c, kind === 'potentiometer' ? n : b, (1 - x) * resistance);
    }
  }
  for (const [a, b] of wires) {
    if (devicePorts.has(a) && devicePorts.has(b)) nets.join(a, b);
  }

  const connected = disjointSets();
  const branches = stamps.map(edge => ({ ...edge, p: nets.find(edge.p), n: nets.find(edge.n) }));
  for (const { p, n } of branches) connected.join(p, n);
  const groups = new Map();
  for (const branch of branches) {
    const key = connected.find(branch.p);
    if (!groups.has(key)) groups.set(key, { nodes: new Set(), branches: [] });
    const group = groups.get(key);
    group.nodes.add(branch.p);
    group.nodes.add(branch.n);
    group.branches.push(branch);
  }

  const readings = new Map();
  const currents = new Map();
  const shorted = [];
  const zero = value => Math.abs(value) < 1e-10 ? 0 : value;
  for (const group of groups.values()) {
    const sources = group.branches.filter(branch => Object.hasOwn(sourcesByKind, branch.kind));
    let potential = () => 0;
    if (sources.length) {
      potential = solveNetwork(group.nodes, group.branches);
      const faults = sources.filter(source => source.p === source.n || (potential &&
        Math.abs((source.emf - (potential(source.p) - potential(source.n))) / source.ohms) > spec.supplyLimitAmps));
      if (faults.length || !potential) {
        shorted.push(...(faults.length ? faults : sources).map(source => source.id));
        continue;
      }
    }
    for (const { id, kind, p, n, ohms, emf } of group.branches) {
      const voltage = potential(p) - potential(n);
      const current = kind === 'led' ? forward(voltage) : (voltage - emf) / ohms;
      if (!['rheostat', 'pencil-rheostat', 'potentiometer'].includes(kind)) currents.set(id, zero(current));
      if (Object.hasOwn(currentMeters, kind)) readings.set(id, zero(current));
      if (Object.hasOwn(voltageMeters, kind)) readings.set(id, zero(voltage));
    }
  }
  return { readings: Object.fromEntries(readings), currents: Object.fromEntries(currents), shorted };
}
