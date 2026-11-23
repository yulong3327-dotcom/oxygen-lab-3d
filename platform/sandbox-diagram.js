import { SANDBOX_ELECTRICAL as spec } from './sandbox-circuit.js';

const ns = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const resistor = 'M-32 0h14m36 0h14M-18-8h36v16h-36z';
const leads = 'M-32 0h18m28 0h18';
const sourceValues = { power: spec.supplyVoltage, 'battery-single': spec.singleBatteryVoltage, 'battery-pack': spec.batteryPackVoltage };
const resistanceValues = {
  resistor: spec.resistorOhms, 'resistance-wire': spec.resistanceWireOhms, 'joule-calorimeter': spec.calorimeterOhms
};
const meterLetters = {
  ammeter: 'A', voltmeter: 'V', galvanometer: 'G', 'multimeter-current': 'A', 'multimeter-voltage': 'V'
};
const rotaryResistance = { rheostat: spec.rheostatOhms, 'pencil-rheostat': spec.pencilRheostatOhms, potentiometer: spec.potentiometerOhms };
const motorKinds = new Set(['motor-bare', 'motor-fan']);

function netGroups(wires, terminals) {
  const parents = new Map();
  const find = port => {
    if (!parents.has(port)) parents.set(port, port);
    while (parents.get(port) !== port) port = parents.get(port);
    return port;
  };
  for (const { ends: [a, b] } of wires) {
    if (terminals.has(a) && terminals.has(b) && a !== b) parents.set(find(a), find(b));
  }
  const groups = new Map();
  for (const port of terminals.keys()) {
    if (!parents.has(port)) continue;
    const root = find(port);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(port);
  }
  return [...groups.values()];
}

function detail(device) {
  const { kind } = device;
  if (Object.hasOwn(sourceValues, kind)) return sourceValues[kind] + ' V';
  if (Object.hasOwn(resistanceValues, kind)) return resistanceValues[kind] + ' Ω';
  if (kind === 'resistance-box') return (device.ohms ?? spec.resistanceBoxDefaultOhms) + ' Ω';
  if (kind === 'switch') return device.closed ? '闭合' : '断开';
  if (kind === 'switch-spdt') return ['断开', '公共端 → 1', '公共端 → 2'][device.throw ?? 0] ?? '';
  if (Object.hasOwn(rotaryResistance, kind)) {
    const position = device.position ?? .5;
    const maximum = rotaryResistance[kind];
    return `${Math.round(position * maximum)} Ω / ${Math.round((1 - position) * maximum)} Ω`;
  }
  return '';
}

function drawSymbol(host, device) {
  const path = d => host.append(svgNode('path', { d }));
  const circle = (cx, cy, r) => host.append(svgNode('circle', { cx, cy, r }));
  const { kind } = device;
  if (Object.hasOwn(sourceValues, kind)) {
    const multiple = kind === 'battery-pack';
    path(multiple
      ? 'M-32 0h17m30 0h17M-15-13v26m7-20v14m16-20v26m7-20v14M-27-13v8m-4-4h8m46 0h8'
      : 'M-32 0h27m10 0h27m-37-13v26m10-20v14M-25-13v8m-4-4h8m42 0h8');
  } else if (kind === 'switch' || kind === 'switch-spdt') {
    const double = kind === 'switch-spdt';
    path(double ? 'M-32 0h16.5m31 0H32M15.5 14H32' : 'M-32 0h16.5m31 0H32');
    circle(-13, 0, 2.5);
    circle(13, 0, 2.5);
    if (double) circle(13, 14, 2.5);
    const active = double ? (device.throw === 1 ? 0 : device.throw === 2 ? 14 : -11) : device.closed ? 0 : -11;
    path(`M-10.5 0L10.5 ${active}`);
  } else if (kind === 'lamp-bulb') {
    path(leads + 'M-9-9L9 9M9-9L-9 9');
    circle(0, 0, 14);
  } else if (Object.hasOwn(meterLetters, kind) || motorKinds.has(kind)) {
    path(leads);
    circle(0, 0, 14);
    host.append(svgNode('text', { x: 0, y: 4, stroke: 'none', fill: 'currentColor', 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700 },
      motorKinds.has(kind) ? 'M' : meterLetters[kind]));
  } else if (kind === 'led') {
    path('M-32 0h19m21 0H32M-13-9v18L8 0zm21-10v20M2-14l8-8m-5 0h5v5m4 3l8-8m-5 0h5v5');
  } else if (kind === 'solenoid') {
    path('M-32 0h10a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0h6');
  } else if (kind === 'bell' || kind === 'buzzer') {
    path(kind === 'bell' ? 'M-32 0h19l2-7q11-13 22 0l2 7h19M-15 0h30m-20 5q5 8 10 0'
      : 'M-32 0h22m20 0h22m-22-10h-20v20h20zm7-3q7 13 0 26m6-30q10 17 0 34');
  } else {
    path(resistor);
    if (Object.hasOwn(rotaryResistance, kind)) path('M-4-12l4 4 4-4m-4-9v13');
  }
}

export function createLiveDiagram(button) {
  const panel = document.createElement('section');
  panel.className = 'sandbox-diagram';
  panel.id = 'free-diagram-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '实时电路图');
  const header = document.createElement('h3');
  header.textContent = '实时电路图';
  const summary = document.createElement('p');
  summary.className = 'sandbox-diagram-summary';
  const board = document.createElement('div');
  board.className = 'sandbox-diagram-scroll';
  board.setAttribute('role', 'region');
  board.setAttribute('aria-label', '电路图绘图区');
  board.tabIndex = 0;
  panel.append(header, summary, board);
  button.setAttribute('aria-controls', panel.id);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-pressed', 'false');

  function toggle() {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    button.setAttribute('aria-pressed', String(!panel.hidden));
  }

  function update(devices, wires, terminals) {
    if (panel.hidden) return;
    const groups = netGroups(wires, terminals);
    summary.textContent = devices.length
      ? `${devices.length} 件器材 · ${groups.length} 个接线节点`
      : '台面上还没有器材。';
    if (!devices.length) {
      board.replaceChildren();
      return;
    }
    const nets = groups.map((ports, index) => ({ ports, x: 24 + index * 29, id: `N${index + 1}`, last: 40 }));
    const portNets = new Map(nets.flatMap(net => net.ports.map(port => [port, net])));
    const center = Math.max(125, 24 + nets.length * 29 + 60);
    const width = center + 76 + Math.max(92, ...devices.map(device =>
      [...(device.name ?? device.id)].reduce((size, character) => size + (character.codePointAt(0) > 255 ? 14 : 8), 0)));
    const height = 40 + devices.length * 66;
    const svg = svgNode('svg', { xmlns: ns, viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': '元件及接线节点' });
    svg.style.display = 'block';
    const vertical = svgNode('g', { class: 'sandbox-diagram-nets', 'aria-hidden': 'true' });
    const rows = svgNode('g');
    svg.append(vertical, rows);
    devices.forEach((device, index) => {
      const y = 68 + index * 66;
      const entry = svgNode('g', { class: 'sandbox-diagram-device', 'data-circuit-device': device.id });
      const route = svgNode('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.35, opacity: .8 });
      const body = svgNode('g', {
        transform: `translate(${center} ${y})`,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      });
      const mark = svgNode('g', { class: 'sandbox-diagram-junctions' });
      const right = center + 49;
      const displayed = [];
      function lead(port, x, from, lane, marker = x) {
        const full = `${device.id}:${port}`;
        const terminal = terminals.get(full);
        if (!terminal) return;
        const net = portNets.get(full);
        displayed.push(`${terminal.name ?? port}：${net?.id ?? '未连接'}`);
        const margin = net?.x ?? marker;
        const routeName = net?.id ?? 'open';
        route.append(svgNode('path', { d: `M${x} ${from}H${marker}V${lane}H${margin}`, 'data-circuit-port': full, 'data-net': routeName }));
        if (net) {
          net.last = Math.max(net.last, lane);
          mark.append(svgNode('circle', { cx: margin, cy: lane, r: 3, fill: 'currentColor' }));
        } else {
          mark.append(svgNode('circle', { cx: margin, cy: lane, r: 2.5, fill: 'none', stroke: 'currentColor' }));
        }
      }
      lead('p', center - 32, y, y, center - 41);
      const { kind } = device;
      if (kind === 'rheostat' || kind === 'pencil-rheostat') {
        lead('b', center + 32, y, y + 18, right);
        lead('c', center, y - 21, y - 21, center - 15);
        lead('n', center, y - 21, y - 33, center);
      } else {
        if (kind === 'switch-spdt') lead('b', center + 32, y + 14, y + 29, right - 8);
        if (kind === 'potentiometer') lead('c', center, y - 21, y - 21, center - 15);
        lead('n', center + 32, y, y + 18, right);
      }
      drawSymbol(body, device);
      const name = device.name ?? device.id;
      const description = detail(device);
      entry.append(svgNode('title', {}, [name, description, ...displayed].filter(Boolean).join('；')), route, mark, body,
        svgNode('text', { x: right + 14, y: y - 3, 'font-size': 14, fill: 'currentColor' }, name));
      if (description) entry.append(svgNode('text', { x: right + 14, y: y + 15, 'font-size': 12, fill: 'currentColor', opacity: .75 }, description));
      rows.append(entry);
    });
    for (const net of nets) vertical.append(
      svgNode('text', { x: net.x, y: 23, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 11, 'font-weight': 700 }, net.id),
      svgNode('path', { d: `M${net.x} 30V${net.last + 4}`, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.35, opacity: .48 })
    );
    board.replaceChildren(svg);
  }

  return { panel, toggle, update };
}
