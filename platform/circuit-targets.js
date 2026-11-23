export function sizeTerminalTargets(terminals) {
  const preferred = matchMedia('(pointer: coarse)').matches ? 28 : 26;
  for (const pin of terminals) {
    let size = preferred;
    for (const other of terminals) {
      if (other === pin) continue;
      const separation = Math.max(Math.abs(other.x - pin.x), Math.abs(other.y - pin.y));
      size = Math.min(size, separation * .74);
    }
    pin.button.style.setProperty('--terminal-size', Math.max(6, size - 1) + 'px');
  }
}
