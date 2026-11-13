// 3D slime avatar (Three.js). States: idle | listening | thinking | speaking | happy | error
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// --- compact 3D simplex noise (Stefan Gustavson, public domain) ---
const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const perm = new Uint8Array(512);
{ const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
function noise3(x, y, z) {
  const F3 = 1 / 3, G3 = 1 / 6;
  const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) { if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; } else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; } else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; } }
  else { if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; } else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; } else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; } }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const c = (gi, x, y, z) => { let t = 0.6 - x * x - y * y - z * z; if (t < 0) return 0; const g = grad3[gi % 12]; t *= t; return t * t * (g[0] * x + g[1] * y + g[2] * z); };
  return 32 * (c(perm[ii + perm[jj + perm[kk]]], x0, y0, z0) + c(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1)
    + c(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2) + c(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3));
}

const STATE_COLORS = {
  idle:      { body: 0x3ab4ff, core: 0x7df9ff },
  listening: { body: 0x45d0ff, core: 0x8dffc4 },
  thinking:  { body: 0x5a8cff, core: 0xffe07d },
  speaking:  { body: 0x3ab4ff, core: 0xa8f4ff },
  happy:     { body: 0x55c8ff, core: 0xff9ee0 },
  discuss:   { body: 0x6f8dff, core: 0xd9a8ff },
  error:     { body: 0x6a7fd0, core: 0xff6b8a },
};

export function createSlime(canvas, { onTap } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.6, 6.2);
  camera.lookAt(0, 0.1, 0);

  scene.add(new THREE.HemisphereLight(0x9fdcff, 0x0a1430, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7df9ff, 1.6); rim.position.set(-3, 1, -2); scene.add(rim);

  const group = new THREE.Group(); scene.add(group);

  // Body: high-detail sphere we deform every frame
  // mergeVertices -> indexed mesh: ~8k shared vertices, smooth normals, cheap enough for phones
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 28).deleteAttribute("normal").deleteAttribute("uv"));
  const base = geo.attributes.position.array.slice();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: STATE_COLORS.idle.body, roughness: 0.08, metalness: 0,
    transmission: 0.55, thickness: 1.6, ior: 1.33,
    attenuationColor: new THREE.Color(0x1a7fd6), attenuationDistance: 1.4,
    clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.4, sheenColor: new THREE.Color(0x9fe8ff),
    transparent: true, opacity: 0.96,
  });
  const body = new THREE.Mesh(geo, bodyMat); group.add(body);

  // Glowing core inside
  const coreMat = new THREE.MeshBasicMaterial({ color: STATE_COLORS.idle.core, transparent: true, opacity: 0.85 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 32), coreMat);
  core.position.set(0, -0.05, 0); group.add(core);
  const glow = new THREE.PointLight(STATE_COLORS.idle.core, 2.5, 3); core.add(glow);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050a18, roughness: 0.2 });
  const eyeGeo = new THREE.CapsuleGeometry(0.075, 0.16, 8, 16);
  const eyes = new THREE.Group(); group.add(eyes);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat), eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.28, 0.12, 0.93); eyeR.position.set(0.28, 0.12, 0.93);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const shineL = shine.clone(), shineR = shine.clone();
  shineL.position.set(0.025, 0.07, 0.06); shineR.position.set(0.025, 0.07, 0.06);
  eyeL.add(shineL); eyeR.add(shineR); eyes.add(eyeL, eyeR);

  // Soft ground shadow
  const sc = document.createElement("canvas"); sc.width = sc.height = 128;
  const g = sc.getContext("2d"); const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(0,0,0,0.55)"); rg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.78; scene.add(shadow);

  // Floating particles (magic essence)
  const pCount = 120, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(pCount * 3), pSeed = new Float32Array(pCount);
  for (let i = 0; i < pCount; i++) { pPos[i*3] = (Math.random()-0.5)*6; pPos[i*3+1] = Math.random()*4-1; pPos[i*3+2] = (Math.random()-0.5)*4-1; pSeed[i] = Math.random(); }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x7df9ff, size: 0.035, transparent: true, opacity: 0.6, depthWrite: false }));
  scene.add(particles);

  // --- state ---
  let state = "idle";
  let level = 0;          // speaking amplitude 0..1 (set from outside)
  let levelSmooth = 0;
  let nextBlink = 2, blinkT = -1;
  const look = new THREE.Vector2();
  const target = { body: new THREE.Color(STATE_COLORS.idle.body), core: new THREE.Color(STATE_COLORS.idle.core) };
  let squash = 0; // tap squish impulse

  function setState(s) {
    state = STATE_COLORS[s] ? s : "idle";
    target.body.setHex(STATE_COLORS[state].body);
    target.core.setHex(STATE_COLORS[state].core);
    if (s === "listening" || s === "happy") squash = 1;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep slime nicely sized on tall phone screens
    // fit ~1.9 units of half-width horizontally, so the slime fills ~65% of a phone's width
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    camera.position.z = Math.max(6.2, 1.9 / Math.tan(halfH));
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  canvas.addEventListener("pointermove", (e) => {
    look.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  });
  canvas.addEventListener("click", () => { squash = 1; onTap?.(); });

  const pos = geo.attributes.position;
  const clock = new THREE.Clock();
  const v = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    levelSmooth += (level - levelSmooth) * Math.min(1, dt * 18);
    squash *= Math.pow(0.02, dt);

    const speed = { discuss: 0.6, idle: 0.5, listening: 0.9, thinking: 1.8, speaking: 1.1, happy: 1.4, error: 0.3 }[state];
    const amp = { discuss: 0.04, idle: 0.035, listening: 0.055, thinking: 0.08, speaking: 0.045 + levelSmooth * 0.08, happy: 0.06, error: 0.025 }[state];
    const breathe = Math.sin(t * 1.6) * 0.03 + (state === "listening" ? Math.sin(t * 5) * 0.03 : 0);
    const bounce = state === "speaking" ? levelSmooth * 0.12 : state === "happy" ? Math.abs(Math.sin(t * 6)) * 0.15 : 0;

    for (let i = 0; i < pos.count; i++) {
      v.set(base[i*3], base[i*3+1], base[i*3+2]);
      const n = noise3(v.x * 0.9 + t * speed * 0.6, v.y * 0.9 + t * speed * 0.4, v.z * 0.9 + t * speed * 0.5);
      let r = 1 + n * amp + breathe;
      v.multiplyScalar(r);
      // slime-drop silhouette: flat bottom, wider base, softly pointed top
      if (v.y < -0.35) { v.y = -0.35 + (v.y + 0.35) * 0.25; }
      const widen = 1 + Math.max(0, 0.1 - v.y) * 0.15;
      v.x *= widen; v.z *= widen;
      v.y *= 0.97 + bounce * 0.6 - squash * 0.18;
      v.x *= 1 + squash * 0.1; v.z *= 1 + squash * 0.1;
      if (v.y > 0.6) v.y += (v.y - 0.6) * 0.18; // little peak
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    group.position.y = bounce * 0.5 + Math.sin(t * 1.6) * 0.015;
    group.rotation.y += ((look.x * 0.35) - group.rotation.y) * dt * 3 + (state === "thinking" ? Math.sin(t * 2) * 0.004 : 0);
    group.rotation.x += ((-look.y * 0.12) - group.rotation.x) * dt * 3;
    shadow.scale.setScalar(1 - bounce * 0.4 + squash * 0.1);

    bodyMat.color.lerp(target.body, dt * 3);
    coreMat.color.lerp(target.core, dt * 3);
    glow.color.copy(coreMat.color);
    const corePulse = state === "thinking" ? 1 + Math.sin(t * 8) * 0.25 : state === "speaking" ? 1 + levelSmooth * 0.6 : 1 + Math.sin(t * 2) * 0.08;
    core.scale.setScalar(corePulse);
    core.position.x = state === "thinking" ? Math.sin(t * 3) * 0.12 : core.position.x * 0.95;
    glow.intensity = 1.5 + corePulse * 1.5;

    // eyes: follow squash, look around while thinking, blink
    const eyeY = 0.12 * (0.97 + bounce * 0.6 - squash * 0.18);
    eyes.position.y = eyeY - 0.12;
    eyes.position.x = state === "thinking" ? Math.sin(t * 1.3) * 0.06 : look.x * 0.05;
    nextBlink -= dt;
    if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2 + Math.random() * 3; }
    let ey = state === "happy" ? 0.35 : state === "error" ? 0.5 : 1;
    if (blinkT >= 0) { blinkT += dt; ey *= Math.abs(Math.cos(Math.min(blinkT / 0.16, 1) * Math.PI)); if (blinkT > 0.16) blinkT = -1; }
    eyeL.scale.y = eyeR.scale.y = Math.max(0.08, ey);

    // particles drift upward; faster while thinking
    const pa = pGeo.attributes.position;
    for (let i = 0; i < pCount; i++) {
      let y = pa.getY(i) + dt * (0.1 + pSeed[i] * 0.2) * (state === "thinking" ? 3 : 1);
      if (y > 3) y = -1;
      pa.setY(i, y);
      pa.setX(i, pa.getX(i) + Math.sin(t + pSeed[i] * 10) * dt * 0.05);
    }
    pa.needsUpdate = true;
    particles.material.color.copy(coreMat.color);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setState,
    setLevel(x) { level = Math.max(0, Math.min(1, x)); },
    get state() { return state; },
  };
}
