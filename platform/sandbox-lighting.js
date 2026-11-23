const studioByScene = new WeakMap();
const lightingByItem = new WeakMap();
const maxLitBulbs = 4;
const spillRadius = .16;

function reflectionRoom(T, renderer) {
  const room = new T.Scene();
  room.background = new T.Color(.16, .19, .23);
  const cards = [
    [3.3, 2, [-2.6, 2.3, 2.4], [3.0, 3.15, 3.35]],
    [1.2, 3.5, [3.1, 1.3, .1], [1.05, 1.29, 1.55]],
    [3.6, .55, [0, 2.1, -3.1], [1.45, 1.50, 1.55]],
    [4.0, 2.1, [.6, -1.8, .4], [.22, .25, .29]]
  ];
  for (const [width, height, position, rgb] of cards) {
    const panel = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({
      color: new T.Color(...rgb), side: T.DoubleSide, toneMapped: false
    }));
    panel.position.fromArray(position);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  }
  const generator = new T.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, .035, .07, 12);
  } finally {
    generator.dispose();
    for (const panel of room.children) {
      panel.geometry.dispose();
      panel.material.dispose();
    }
  }
}

export function setupSandboxLighting(T, scene, renderer) {
  if (studioByScene.has(scene)) return;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  const environment = reflectionRoom(T, renderer);
  scene.environment = environment.texture;
  scene.add(new T.HemisphereLight(0xf2f7fc, 0x849093, .58));
  for (const [color, intensity, xyz] of [[0xfff3dd, 1.7, [2, 4, 3]], [0xcce3fa, .51, [-2, 2, -3]]]) {
    const light = new T.DirectionalLight(color, intensity);
    light.position.fromArray(xyz);
    scene.add(light);
  }

  const geometry = new T.PlaneGeometry(1, 1);
  const material = new T.ShaderMaterial({
    vertexShader: `varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        vec2 p = abs(vUv - 0.5) * 2.0;
        float edge = pow(pow(p.x, 4.0) + pow(p.y, 4.0), 0.25);
        float density = (1.0 - smoothstep(0.46, 0.99, edge)) * 0.36;
        gl_FragColor = vec4(0.11, 0.16, 0.19, density);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false
  });
  studioByScene.set(scene, { environment, geometry, material, lit: new Set() });
}

export function addSandboxLighting(T, item) {
  if (lightingByItem.has(item)) return;
  let scene = item.group;
  while (scene.parent) scene = scene.parent;
  const studio = studioByScene.get(scene);
  if (!studio) return;

  const center = new T.Box3().setFromObject(item.group).getCenter(new T.Vector3());
  item.group.worldToLocal(center);
  const shadow = new T.Mesh(studio.geometry, studio.material);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(center.x + .0045, -.0007, center.z - .0035);
  shadow.scale.set(item.width * 1.3 + .007, item.depth * 1.35 + .007, 1);
  shadow.raycast = () => {};
  shadow.boundingBox = new T.Box3();
  shadow.renderOrder = -1;
  item.group.add(shadow);

  const effect = { studio, shadow, light: null };
  lightingByItem.set(item, effect);
  if (item.kind === 'lamp-bulb') {
    effect.light = new T.PointLight(0xffa74c, 0, .29, 2);
    const filament = item.glow ?? item.group.getObjectByName('LampGlow');
    if (filament) {
      filament.getWorldPosition(effect.light.position);
      item.group.worldToLocal(effect.light.position);
    } else effect.light.position.set(0, .09, 0);
    const material = new T.ShaderMaterial({
      uniforms: { strength: { value: 0 }, height: { value: effect.light.position.y } },
      vertexShader: `varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying vec2 vUv;
        uniform float strength;
        uniform float height;
        void main() {
          float r = length(vUv * 2.0 - 1.0);
          float h = height / ${spillRadius};
          float falloff = pow(h / sqrt(h * h + r * r), 3.0);
          float edge = 1.0 - smoothstep(0.55, 1.0, r);
          gl_FragColor = vec4(1.0, 0.82, 0.52, strength * falloff * edge);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false
    });
    effect.spill = new T.Mesh(studio.geometry, material);
    effect.spill.rotation.x = -Math.PI / 2;
    effect.spill.position.set(effect.light.position.x, -.0014, effect.light.position.z);
    effect.spill.scale.setScalar(2 * spillRadius);
    effect.spill.renderOrder = -2;
    effect.spill.boundingBox = new T.Box3();
    effect.spill.raycast = () => {};

    effect.emitters = [];
    filament?.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material?.emissive) return;
      const material = mesh.material = mesh.material.clone();
      effect.emitters.push({ material, glass: material.transparent });
    });
  }
}

export function updateSandboxLighting(item, current) {
  const effect = lightingByItem.get(item);
  if (!effect?.light) return;
  const { studio, light, spill, emitters } = effect;
  const amps = Number.isFinite(current) ? Math.abs(current) : 0;
  if (amps <= .005) {
    if (studio.lit.delete(item)) {
      light.removeFromParent();
      spill.removeFromParent();
    }
    return;
  }
  const power = Math.min(1.5, (amps / .16) ** 2);
  for (const { material, glass } of emitters) {
    material.emissiveIntensity = (glass ? .45 : 5.5) * power;
    if (glass) material.opacity = .15 * Math.sqrt(power);
  }
  if (!studio.lit.has(item)) {
    if (studio.lit.size >= maxLitBulbs) return;
    studio.lit.add(item);
    item.group.add(light, spill);
  }
  light.intensity = .024 * power;
  spill.material.uniforms.strength.value = .48 * power;
}

export function disposeSandboxLighting(item) {
  const effect = lightingByItem.get(item);
  if (!effect) return;
  effect.studio.lit.delete(item);
  effect.light?.removeFromParent();
  effect.spill?.removeFromParent();
  effect.spill?.material.dispose();
  for (const { material } of effect.emitters ?? []) material.dispose();
  effect.shadow.removeFromParent();
  lightingByItem.delete(item);
}
