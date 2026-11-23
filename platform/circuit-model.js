export const CIRCUIT_SPEC = Object.freeze({
  supplyVoltage: 6,
  resistorOhms: 10,
  rheostatMaxOhms: 50,
  ammeterRange: 0.6,
  voltmeterRange: 6
});

const power = ['power:p', 'power:n'];
const switchPorts = ['switch:p', 'switch:n'];
const ammeter = ['ammeter:p', 'ammeter:n'];
const resistor = ['resistor:p', 'resistor:n'];
const voltmeter = ['voltmeter:p', 'voltmeter:n'];
const fixedPorts = ['rheostat:p', 'rheostat:b']; // A, B: left and right ends of the resistance wire.
const wiperPorts = ['rheostat:c', 'rheostat:n']; // C, D: equivalent wiper terminals.
const terminals = new Set([...power, ...switchPorts, ...ammeter, ...resistor, ...voltmeter, ...fixedPorts, ...wiperPorts]);
export const CIRCUIT_TERMINALS = Object.freeze([...terminals]);
export const CIRCUIT_PHASES = Object.freeze(['circuit-wire', 'circuit-prepare', 'circuit-close', 'circuit-measure', 'circuit-open']);

const fail = (code, message) => ({ ok: false, code, message });

export function checkWiring(wires) {
  const parents = new Map([...terminals].map(id => [id, id]));
  const net = id => {
    while (parents.get(id) !== id) id = parents.get(id);
    return id;
  };
  const join = (from, to) => parents.set(net(from), net(to));
  const wired = new Set();
  if (!Array.isArray(wires)) return fail('invalid-wire', '导线数据无效，请重新接线。');
  for (const wire of wires) {
    if (!Array.isArray(wire) || wire.length !== 2) return fail('invalid-wire', '导线需要连接两个接线柱。');
    const [from, to] = wire;
    if (!terminals.has(from) || !terminals.has(to) || from === to) return fail('invalid-wire', '请选择两个不同的接线柱。');
    if (net(from) === net(to)) return fail('redundant-wire', '有多余的导线连接同一节点，请撤销多余导线。');
    join(from, to);
    wired.add(from);
    wired.add(to);
  }
  if (net(power[0]) === net(power[1])) return fail('short-circuit', '导线直接连通了电源正、负极，形成短路。请断开这段连接。');

  // At check time the switch is open; nevertheless reject a short it would create on closing.
  const shortNodes = new Set([net(power[0])]);
  for (let pass = 0; pass < 2; pass++) {
    for (const ports of [switchPorts, ammeter]) {
      const [from, to] = ports.map(net);
      if (shortNodes.has(from) || shortNodes.has(to)) {
        shortNodes.add(from);
        shortNodes.add(to);
      }
    }
  }
  if (shortNodes.has(net(power[1]))) return fail('short-circuit', '主回路绕过了电阻，通电会造成短路。请检查开关和电流表的串联接法。');

  const mainParts = [
    ['switch', switchPorts, '开关'],
    ['ammeter', ammeter, '电流表'],
    ['resistor', resistor, '定值电阻']
  ];
  for (const [id, [from, to], label] of mainParts) {
    if (net(from) === net(to)) {
      if (id === 'ammeter') return fail('ammeter-bypassed', '电流表被导线旁路了。请把它串联到主回路中。');
      return fail(`${id}-bypassed`, `${label}的两个接线柱被导线直接连通了。请让电流经过${label}。`);
    }
  }

  const fixed = fixedPorts.filter(id => wired.has(id));
  const wiper = wiperPorts.filter(id => wired.has(id));
  if (fixed.length > 1 || wiper.length > 1) {
    return fail('rheostat-ports', '滑动变阻器要“一上一下”：A、B 中选一个下接线柱，C、D 中选一个上接线柱。');
  }
  if (fixed.length && wiper.length && net(fixed[0]) === net(wiper[0])) {
    return fail('rheostat-bypassed', '变阻器的两个已用接线柱被导线直接连通了。请把变阻器串联到主回路中。');
  }
  if (!fixed.length || !wiper.length || [...power, ...switchPorts, ...ammeter, ...resistor].some(id => !wired.has(id))) {
    return fail('incomplete', '主回路还未接完整。请检查电源、开关、电流表、定值电阻和滑动变阻器的接线。');
  }
  if (!voltmeter.every(id => wired.has(id))) return fail('voltmeter-missing', '请把电压表的两个接线柱接到定值电阻两端。');
  if (net(voltmeter[0]) === net(voltmeter[1])) return fail('voltmeter-placement', '电压表的两个接线柱接到了同一节点。请把电压表并联在定值电阻两端。');
  if (new Set([...voltmeter, ...resistor].map(net)).size !== 2) {
    return fail('voltmeter-placement', '电压表要并联在定值电阻两端，检查是否串联或接到了别的器材两端。');
  }

  // Collapse each set of wire-connected terminals, then follow conventional current
  // through all four components. The voltmeter belongs to the measurement branch.
  mainParts.push(['rheostat', [fixed[0], wiper[0]], '滑动变阻器']);
  const graph = new Map();
  for (const [id, ports] of mainParts) {
    const nodes = ports.map(net);
    for (let i = 0; i < 2; i++) {
      const edges = graph.get(nodes[i]) ?? [];
      edges.push({ id, from: ports[i], next: nodes[1 - i] });
      graph.set(nodes[i], edges);
    }
  }
  const [positive, negative] = power.map(net);
  const visited = new Set();
  let at = positive;
  let ammeterIn;
  let resistorIn;
  while (at !== negative) {
    const choices = (graph.get(at) ?? []).filter(edge => !visited.has(edge.id));
    if (choices.length !== 1) return fail('series-loop', '电流表、开关、定值电阻和变阻器应在同一条主回路中串联。请检查分支或断点。');
    const edge = choices[0];
    visited.add(edge.id);
    if (edge.id === 'ammeter') ammeterIn = edge.from;
    if (edge.id === 'resistor') resistorIn = at;
    at = edge.next;
  }
  if (visited.size !== mainParts.length) return fail('series-loop', '主回路没有经过全部四件器材。请检查是否绕过了某件器材。');
  if (ammeterIn !== ammeter[0]) return fail('ammeter-polarity', '电流表正、负接线柱接反了。电流应从“+”接线柱流入。');
  if (net(voltmeter[0]) !== resistorIn) return fail('voltmeter-polarity', '电压表正、负接线柱接反了。“+”应接定值电阻靠近电源正极的一端。');

  return {
    ok: true, code: 'ready', message: '接线正确。闭合开关前，把变阻器调到接入电阻最大的位置。',
    fixedTerminal: fixed[0], maxPosition: fixed[0] === fixedPorts[0] ? 1 : 0
  };
}

export function measureCircuit(wiring, sliderPosition, switchClosed) {
  const zero = { voltage: 0, current: 0 };
  if (!wiring?.ok || ![0, 1].includes(wiring.maxPosition) || !Number.isFinite(sliderPosition)) {
    return { ...zero, rheostatOhms: null };
  }
  const position = Math.max(0, Math.min(1, sliderPosition));
  const rheostatOhms = CIRCUIT_SPEC.rheostatMaxOhms * (wiring.maxPosition === 1 ? position : 1 - position);
  if (!switchClosed) return { ...zero, rheostatOhms };
  const current = CIRCUIT_SPEC.supplyVoltage / (CIRCUIT_SPEC.resistorOhms + rheostatOhms);
  return { voltage: current * CIRCUIT_SPEC.resistorOhms, current, rheostatOhms };
}
