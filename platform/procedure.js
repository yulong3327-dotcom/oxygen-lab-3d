const MARKER_RADIUS = 24;
const MARKER_GAP = 54;
const DROP_RADIUS = 30;
const DRAG_THRESHOLD = 5;

function marker(role, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `procedure-${role} lab-action-${role}`;
  button.dataset.action = role;
  const glyph = document.createElement('i');
  glyph.dataset.lucide = icon;
  glyph.setAttribute('aria-hidden', 'true');
  button.append(glyph);
  return button;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const place = (element, { x, y }) => {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
};

export function createProcedure({ layer, canvas, project, active, complete, wrong, observe, reducedMotion, onChange, focusFallback }) {
  const source = marker('source', 'hand');
  const destination = marker('destination', 'crosshair');
  const line = document.createElement('div');
  line.className = 'procedure-line lab-action-line';
  line.setAttribute('aria-hidden', 'true');
  layer.append(line, source, destination);

  let step;
  let pending;
  let pointer;
  let selected = false;
  let destinationPoint;
  let sourcePoint;
  let restoreFocus = false;
  let suppressClickUntil = 0;

  function releasePointer() {
    if (!pointer) return;
    const { id } = pointer;
    pointer = undefined;
    if (source.hasPointerCapture(id)) source.releasePointerCapture(id);
  }

  function stopWaiting() {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
  }

  function markerPosition(point, width, height) {
    return {
      x: clamp(point.x, MARKER_RADIUS, width - MARKER_RADIUS),
      y: clamp(point.y, MARKER_RADIUS, height - MARKER_RADIUS)
    };
  }

  function separateMarkers(from, to, width, height) {
    if (distance(from, to) >= MARKER_GAP) return to;
    // Keep two touch targets usable when their scene anchors project to the same spot.
    const alternatives = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([x, y]) => markerPosition({ x: from.x + x * MARKER_GAP, y: from.y + y * MARKER_GAP }, width, height))
      .filter(point => distance(point, from) >= MARKER_GAP - 0.1);
    return alternatives.sort((a, b) => distance(a, to) - distance(b, to))[0] ?? to;
  }

  function draw() {
    const { width, height } = canvas.getBoundingClientRect();
    const action = step?.action;
    const from = action?.type === 'transfer' ? project(action.from) : undefined;
    const to = action?.type === 'transfer' ? project(action.to) : undefined;
    const markerReady = from && to && from.visible && to.visible && width >= MARKER_RADIUS * 2 && height >= MARKER_RADIUS * 2;
    source.hidden = destination.hidden = line.hidden = !markerReady;
    layer.hidden = action?.type !== 'transfer' && action?.type !== 'observe';
    layer.dataset.kind = action?.type === 'transfer' ? 'drag' : 'observe';
    layer.toggleAttribute('data-dragging', Boolean(pointer?.point));
    source.setAttribute('aria-pressed', String(selected));
    destination.classList.toggle('is-near', Boolean(pointer?.near || selected && !pointer?.point));
    if (!markerReady) {
      sourcePoint = destinationPoint = undefined;
      return;
    }

    sourcePoint = markerPosition(from, width, height);
    destinationPoint = separateMarkers(sourcePoint, markerPosition(to, width, height), width, height);
    const current = pointer?.point ? markerPosition(pointer.point, width, height) : sourcePoint;
    place(source, current);
    place(destination, destinationPoint);
    place(line, current);
    line.style.width = `${distance(current, destinationPoint)}px`;
    line.style.transform = `rotate(${Math.atan2(destinationPoint.y - current.y, destinationPoint.x - current.x)}rad)`;
  }

  function focusCurrent() {
    if (step?.action.type === 'transfer' && !source.hidden) source.focus();
    else focusFallback(step?.action.type === 'transfer' ? 'recovery' : 'instruction');
  }

  function startObservation(current) {
    const duration = current.action.durationMs;
    const delay = reducedMotion?.matches ? Math.min(duration, 650) : duration;
    const token = { timer: undefined };
    pending = token;
    token.timer = setTimeout(() => {
      if (pending !== token || active() !== current) return;
      pending = undefined;
      complete(current);
      render();
    }, delay);
    observe?.(current);
  }

  function render() {
    const next = active();
    const changed = next !== step;
    if (changed) {
      releasePointer();
      stopWaiting();
      selected = false;
      step = next;
      if (next?.action.type === 'transfer') {
        const { fromLabel, toLabel } = next.action;
        source.title = fromLabel;
        source.setAttribute('aria-label', `选取${fromLabel}`);
        destination.title = toLabel;
        destination.setAttribute('aria-label', `放到${toLabel}`);
      }
      if (next?.action.type === 'observe') startObservation(next);
    }
    draw();
    if (changed && restoreFocus) {
      restoreFocus = next?.action.type === 'observe';
      queueMicrotask(() => { if (step === next) focusCurrent(); });
    }
  }

  function changeSelection(value) {
    selected = value;
    draw();
    onChange?.(value);
  }

  function accept(keyboard = false) {
    const current = active();
    if (current !== step || current?.action.type !== 'transfer') return;
    selected = false;
    restoreFocus = keyboard;
    complete(current);
    render();
  }

  function cancelPointer() {
    if (!pointer && !selected) return false;
    if (pointer) suppressClickUntil = performance.now() + 400;
    releasePointer();
    changeSelection(false);
    return true;
  }

  function reset() {
    releasePointer();
    stopWaiting();
    step = undefined;
    restoreFocus = selected = false;
    draw();
  }

  function localPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height };
  }

  function movePointer(event) {
    if (pointer?.id !== event.pointerId) return;
    const point = localPoint(event);
    if (!pointer.point && distance(pointer.start, point) < DRAG_THRESHOLD) return;
    pointer.point = { x: pointer.origin.x + point.x - pointer.start.x, y: pointer.origin.y + point.y - pointer.start.y };
    const inside = point.x >= 0 && point.x <= point.width && point.y >= 0 && point.y <= point.height;
    pointer.near = inside && Boolean(destinationPoint && distance(pointer.point, destinationPoint) <= DROP_RADIUS);
    draw();
  }

  source.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer || !sourcePoint || active() !== step) return;
    event.preventDefault();
    source.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, start: localPoint(event), origin: sourcePoint };
  });
  source.addEventListener('pointermove', movePointer);
  source.addEventListener('pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    movePointer(event);
    const { point, near } = pointer;
    suppressClickUntil = performance.now() + 400;
    releasePointer();
    if (near) accept();
    else if (point) { changeSelection(false); wrong(step); }
    else changeSelection(!selected);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    source.addEventListener(type, event => {
      if (pointer?.id !== event.pointerId) return;
      const moved = Boolean(pointer.point);
      cancelPointer();
      if (moved) wrong('已取消操作，请从当前步骤的起点重试。');
    });
  }
  source.addEventListener('click', event => {
    if (active() !== step || source.hidden || event.detail && performance.now() < suppressClickUntil) return;
    changeSelection(!selected);
    if (selected && event.detail === 0) destination.focus({ preventScroll: true });
  });
  destination.addEventListener('click', event => {
    if (active() !== step || destination.hidden || pointer) return;
    if (selected) accept(event.detail === 0);
    else {
      wrong(step);
      if (event.detail === 0) source.focus({ preventScroll: true });
    }
  });
  layer.ownerDocument.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (pointer || layer.contains(event.target)) && cancelPointer()) {
      event.preventDefault();
      source.focus({ preventScroll: true });
    }
  });
  return { render, reset, cancelPointer, focusCurrent,
    needsView: () => step?.action.type === 'transfer' && source.hidden };
}
