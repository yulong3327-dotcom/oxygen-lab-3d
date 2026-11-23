import * as T from 'three';

export function createAssembly({ slots, canvas, layer, library, project, unproject, ray, hit, feedback, changed, focusOperation, focusRecovery }) {
  let count = 0;
  let selected = false;
  let drag;
  let suppressClickUntil = 0;
  const current = () => slots[count];
  const picked = () => drag?.slot ?? current();
  const point = new T.Vector3();
  const matrix = new T.Matrix4();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const icon = new T.MeshBasicMaterial({ color: 0x5186cc, transparent: true, opacity: .15, depthWrite: false, side: T.DoubleSide });
  const hot = new T.MeshBasicMaterial({ color: 0x245bda, transparent: true, opacity: .29, depthWrite: false, side: T.DoubleSide });
  const edge = new T.LineBasicMaterial({ color: 0x4675a8, transparent: true, opacity: .55 });
  const scene = slots[0].group.parent;
  const ghost = new T.Group();
  scene.add(ghost);
  const target = document.createElement('button');
  target.type = 'button';
  target.className = 'lab-target assembly-slot';
  const index = document.createElement('span');
  index.className = 'lab-target-number';
  index.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  target.append(index, name);
  layer.append(target);

  for (const slot of slots) {
    const button = slot.button;
    button.classList.add('instrument');
    const thumbnail = document.createElement('img');
    thumbnail.className = 'instrument-preview';
    thumbnail.alt = '';
    thumbnail.draggable = false;
    thumbnail.src = slot.preview;
    slot.thumbnail = thumbnail;
    const label = document.createElement('span');
    label.textContent = slot.label;
    button.replaceChildren(thumbnail, label);
    button.addEventListener('pointerdown', e => {
      if (slot === current()) begin(e, slot);
    });
    button.addEventListener('click', e => {
      if (slot !== current() || (e.detail && performance.now() < suppressClickUntil)) return;
      choose(!selected);
      if (selected && e.detail === 0) {
        if (target.hidden) focusRecovery();
        else target.focus();
      }
    });
    slot.guide = new T.Group();
    slot.group.updateMatrixWorld(true);
    if (slot.area) {
      const [dx, dz] = slot.area;
      const geometry = new T.PlaneGeometry(2 * dx, 2 * dz);
      geometry.rotateX(-Math.PI / 2);
      const fill = new T.Mesh(geometry, icon);
      const lines = new T.LineSegments(new T.EdgesGeometry(geometry), edge);
      fill.renderOrder = lines.renderOrder = 2;
      slot.guide.add(fill, lines);
      slot.guide.position.copy(slot.start).setY(.002);
    } else {
      const inverse = matrix.copy(slot.group.matrixWorld).invert();
      slot.group.traverseVisible(node => {
        if (!node.isMesh) return;
        const shape = new T.Mesh(node.geometry, icon);
        shape.matrix.multiplyMatrices(inverse, node.matrixWorld);
        shape.matrixAutoUpdate = false;
        shape.renderOrder = 2;
        slot.guide.add(shape);
      });
    }
    ghost.add(slot.guide);
    slot.guide.visible = false;
  }

  function sync() {
    const slot = current();
    for (const [i, entry] of slots.entries()) {
      const done = i < count;
      entry.button.disabled = entry !== slot;
      entry.button.toggleAttribute('data-current', entry === slot);
      entry.button.toggleAttribute('data-placed', done);
      entry.button.setAttribute('aria-pressed', String(entry === slot && selected));
      entry.group.visible = done || drag?.slot === entry && Boolean(drag.preview && drag.inside);
      entry.guide.visible = entry === picked() && Boolean(slot);
      if (!entry.area) entry.guide.position.copy(entry.start).add(entry.parent ? entry.parent.group.position.clone().sub(entry.parent.start) : new T.Vector3());
    }
    target.hidden = !slot;
    if (slot) {
      target.dataset.slot = slot.id;
      target.setAttribute('aria-label', '放置' + slot.label);
      index.textContent = String(count + 1).padStart(2, '0');
      name.textContent = slot.label;
    } else {
      delete target.dataset.slot;
    }
    changed(count, selected);
  }

  function positionTarget() {
    const slot = current();
    if (!slot) return;
    const shown = picked();
    const near = Boolean(drag?.valid);
    for (const mesh of shown.guide.children) if (mesh.isMesh) mesh.material = near || selected ? hot : icon;
    const p = project(anchor(slot));
    if (!p.visible) {
      target.hidden = true;
      return;
    }
    target.hidden = Boolean(drag?.adjusting);
    const marginX = (target.offsetWidth || 40) / 2 + 3;
    const marginY = (target.offsetHeight || 28) / 2 + 3;
    const clamp = T.MathUtils.clamp;
    target.style.left = clamp(p.x, marginX, canvas.clientWidth - marginX) + 'px';
    target.style.top = clamp(p.y + (slot.area ? 16 : 13), marginY, canvas.clientHeight - marginY) + 'px';
    target.classList.toggle('is-target', selected);
    target.classList.toggle('is-over', near);
  }

  function home(slot) {
    return slot.parent ? slot.start.clone().add(slot.parent.group.position).sub(slot.parent.start) : slot.start.clone();
  }

  function anchor(slot) {
    return home(slot).add(slot.anchor);
  }

  function choose(value) {
    if (!current()) return;
    selected = value;
    feedback(current().hint);
    sync();
  }

  function commit(slot, position, adjusting) {
    slot.group.position.copy(position);
    const moved = new Set([slot.group]);
    for (const child of slots) {
      if (!moved.has(child.parent?.group)) continue;
      child.group.position.copy(home(child));
      moved.add(child.group);
    }
    if (!adjusting) {
      selected = false;
      count++;
    }
    feedback(current() ? slot.label + '已就位。' + current().hint : '仪器已装齐。开始实验操作。');
    sync();
  }

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
  }

  function insideMarker(e) {
    const rect = target.getBoundingClientRect();
    return !target.hidden && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  }

  function canAdjust(slot) {
    return slot?.area && slots.indexOf(slot) < count && !slots.some((entry, i) => entry.parent === slot && i < count);
  }

  function begin(e, slot, adjusting = false) {
    if (drag || e.button !== 0) return false;
    const grip = { x: 0, y: 0 };
    if (adjusting) {
      const p = project(slot.group.position);
      const start = local(e);
      grip.x = p.x - start.x;
      grip.y = p.y - start.y;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, owner: e.currentTarget, slot, adjusting, grip, start: local(e), original: slot.group.position.clone(), selected };
    return true;
  }

  function updateDrag(e) {
    if (e.pointerId !== drag?.id) return;
    const p = local(e);
    const { slot, grip } = drag;
    if (!drag.preview) {
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 5) return;
      drag.preview = slot.thumbnail.cloneNode();
      drag.preview.className = 'instrument-drag-preview';
      document.body.append(drag.preview);
      if (!drag.adjusting) selected = true;
      feedback(slot.hint);
    }
    drag.inside = p.inside;
    drag.preview.hidden = p.inside;
    drag.preview.style.left = e.clientX + 'px';
    drag.preview.style.top = e.clientY + 'px';
    drag.valid = false;
    if (p.inside) {
      const x = p.x + grip.x, y = p.y + grip.y;
      const a = project(anchor(slot));
      const marker = !drag.adjusting && insideMarker(e);
      const destination = home(slot);
      if (slot.area && ray(x, y).intersectPlane(plane, point)) {
        const [dx, dz] = slot.area;
        drag.valid = marker || Math.abs(point.x - slot.start.x) <= dx && Math.abs(point.z - slot.start.z) <= dz;
        if (!marker) destination.set(point.x, slot.start.y, point.z);
      } else {
        drag.valid = marker || Math.hypot(a.x - x, a.y - y) <= (e.pointerType === 'touch' ? 29 : 25);
        if (!drag.valid) destination.add(unproject(x, y, a.depth).sub(anchor(slot)));
      }
      slot.group.position.copy(destination);
    } else {
      slot.group.position.copy(drag.original);
    }
    sync();
  }

  function cancel() {
    if (!drag) return false;
    const held = drag;
    drag = undefined;
    selected = held.selected;
    held.preview?.remove();
    if (held.owner.hasPointerCapture(held.id)) held.owner.releasePointerCapture(held.id);
    held.slot.group.position.copy(held.original);
    sync();
    return true;
  }

  function end(e, dropped) {
    if (e.pointerId !== drag?.id) return;
    if (dropped) updateDrag(e);
    const held = drag;
    const destination = held.slot.group.position.clone();
    suppressClickUntil = performance.now() + 400;
    cancel();
    if (dropped && held.preview && held.valid) commit(held.slot, destination, held.adjusting);
    else if (dropped && !held.preview && !held.adjusting) choose(!selected);
    else if (held.preview) feedback((dropped ? '器材未放到有效位置。' : '已取消放置。') + held.slot.hint, 'wrong');
  }

  function focusCurrent() {
    const button = selected && !target.hidden ? target : current()?.button;
    button?.focus();
  }

  function clickPlace(event) {
    const slot = current();
    if (!slot) return;
    if (!selected) {
      feedback('请先选中仪器库里的仪器。', 'wrong');
      if (event.detail === 0) slot.button.focus();
      return;
    }
    commit(slot, home(slot), false);
    if (event.detail === 0) {
      if (current()) focusCurrent();
      else focusOperation();
    }
  }

  target.addEventListener('click', clickPlace);
  document.addEventListener('pointermove', updateDrag);
  document.addEventListener('pointerup', e => end(e, true));
  document.addEventListener('pointercancel', e => end(e, false));
  document.addEventListener('lostpointercapture', e => end(e, false));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !current() || !(drag || selected || library.contains(e.target) || e.target === target)) return;
    e.preventDefault();
    cancel();
    choose(false);
    focusCurrent();
  });

  function benchStart(e) {
    const slot = slots.find(entry => entry.id === hit(e));
    return canAdjust(slot) && begin(e, slot, true);
  }

  function benchTap(e) {
    const slot = current();
    if (!slot?.area || !selected) return;
    const { x, y } = local(e);
    const [dx, dz] = slot.area;
    if (ray(x, y).intersectPlane(plane, point) && Math.abs(point.x - slot.start.x) <= dx && Math.abs(point.z - slot.start.z) <= dz) {
      commit(slot, point.clone().setY(slot.start.y), false);
    } else {
      feedback('请放到标示区域内。' + slot.hint, 'wrong');
    }
  }

  function reset() {
    cancel();
    count = 0;
    selected = false;
    for (const slot of slots) slot.group.position.copy(slot.start);
    feedback(current().hint);
    sync();
  }

  const currentSlot = () => current() && { index: count, label: current().label, hint: current().hint };
  return { reset, cancel, positionTarget, benchStart, benchTap, focusCurrent, currentSlot,
    complete: () => count === slots.length,
    needsView: () => Boolean(current() && !drag?.adjusting && target.hidden) };
}
