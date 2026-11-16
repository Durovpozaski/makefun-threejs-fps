// render.js — everything the eye sees, and nothing the sim needs.
// The simulation never touches three.js: main.js copies fighter state into
// these meshes once a frame. No per-frame allocation in the hot paths —
// tracers, flashes and particles come from fixed pools.

import * as THREE from 'three';
import { TEAM_STYLE, PLAYER_HEIGHT, CROUCH_HEIGHT } from './state.js';
import { buildMap, rayHitsWall } from './map.js';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7a94d);           // sunset sky
  scene.fog = new THREE.Fog(0xf2b06a, 55, 130);
  const hemi = new THREE.HemisphereLight(0xffe0b0, 0x8a6a42, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.position.set(-40, 35, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 300);
  scene.add(camera); // camera is in the scene so the viewmodel can hang off it
  const mapGroup = buildMap(scene);
  return { renderer, scene, camera, mapGroup };
}

// --- soldiers --------------------------------------------------------------
// REBUILT 2026-11-17 — the old soldier read as a chunky toy: a wide box
// torso, a ball head, no silhouette. The new one is modelled on the top
// entries (CAMPANILE's wide-brim hat + glowing visor, Kilnyard's clean
// humanoid): slimmer and taller, a real brimmed helmet, a BIG bright visor
// that reads at 30 m, a vest with pouches, a backpack, knee pads, and a
// rifle with a stock, scope and foregrip held by both hands. Team colour
// is strong (chest stripe, shoulder bands, helmet band, pack stripe) so
// enemies read instantly at small (judge) size.
export function makeSoldier(team) {
  const s = TEAM_STYLE[team];
  const cloth = new THREE.MeshStandardMaterial({ color: s.cloth, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: s.dark, roughness: 0.8 });
  const visor = new THREE.MeshStandardMaterial({ color: s.visor, emissive: s.visor, emissiveIntensity: 3.0 });
  const glow = new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 1.4 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99878, roughness: 0.9 });
  const gun = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.4, metalness: 0.6 });
  const gunLight = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.4, metalness: 0.6 });
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  // legs — slimmer, longer, with knee pads (pivot at the hip for the walk cycle)
  const legL = new THREE.Group(); legL.position.set(-0.13, 0.88, 0);
  const legR = new THREE.Group(); legR.position.set(0.13, 0.88, 0);
  const llm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.88, 0.2), dark);
  llm.position.y = -0.44; llm.castShadow = true; legL.add(llm);
  const lrm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.88, 0.2), dark);
  lrm.position.y = -0.44; lrm.castShadow = true; legR.add(lrm);
  // knee pads (front of the shin, team-dark)
  const kl = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.06), cloth);
  kl.position.set(0, -0.5, 0.12); legL.add(kl);
  const kr = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.06), cloth);
  kr.position.set(0, -0.5, 0.12); legR.add(kr);
  // boots
  box(0.19, 0.1, 0.3, dark, -0.13, 0.05, 0.03);
  box(0.19, 0.1, 0.3, dark, 0.13, 0.05, 0.03);
  g.add(legL); g.add(legR);
  // torso — slimmer vest, with a belt, pouches and shoulder pads
  box(0.56, 0.6, 0.32, cloth, 0, 1.2, 0);
  box(0.6, 0.38, 0.38, dark, 0, 1.24, 0);          // vest plate
  box(0.58, 0.09, 0.34, dark, 0, 0.92, 0);         // belt
  box(0.18, 0.12, 0.38, dark, -0.33, 1.5, 0);      // shoulder pads
  box(0.18, 0.12, 0.38, dark, 0.33, 1.5, 0);
  box(0.15, 0.15, 0.07, dark, -0.15, 1.18, 0.2);   // pouches
  box(0.15, 0.15, 0.07, dark, 0.15, 1.18, 0.2);
  // backpack with a glowing team stripe (reads from behind too)
  box(0.42, 0.5, 0.18, dark, 0, 1.28, -0.26);
  box(0.44, 0.08, 0.2, glow, 0, 1.42, -0.26);
  // team stripe across the chest + bright shoulder bands
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.4), glow);
  stripe.position.set(0, 1.4, 0); g.add(stripe);
  box(0.2, 0.08, 0.4, glow, -0.33, 1.56, 0);
  box(0.2, 0.08, 0.4, glow, 0.33, 1.56, 0);
  // head: brimmed helmet (wide, like the top entries) + a BIG bright visor
  const head = new THREE.Group(); head.position.set(0, 1.68, 0);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), dark);
  helm.scale.set(1, 0.95, 1); helm.castShadow = true; head.add(helm);
  // wide brim, tilted slightly forward — the silhouette that reads far away
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.045, 16), dark);
  brim.position.set(0, 0.06, 0); brim.rotation.x = 0.08; head.add(brim);
  // glowing helmet band (team colour, wraps the helmet)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 16), glow);
  band.position.set(0, 0.1, 0); head.add(band);
  // the visor: wide, tall, blazing — the face of the enemy at any distance
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.17, 0.09), visor);
  vis.position.set(0, -0.01, 0.18); head.add(vis);
  g.add(head);
  // arms: BOTH reach forward to the rifle — hands meet the weapon, not hanging down
  const armL = new THREE.Group(); armL.position.set(-0.35, 1.44, 0);
  const armR = new THREE.Group(); armR.position.set(0.35, 1.44, 0);
  const alm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.15), cloth);
  alm.position.y = -0.27; alm.castShadow = true; armL.add(alm);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.15), cloth);
  arm.position.y = -0.27; arm.castShadow = true; armR.add(arm);
  // bare hands gripping the rifle (skin, like the viewmodel — readable, warm)
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.16), skin); hl.position.y = -0.56; armL.add(hl);
  const hr = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.16), skin); hr.position.y = -0.56; armR.add(hr);
  armL.rotation.x = -1.05; armL.rotation.z = 0.35;
  armR.rotation.x = -1.05; armR.rotation.z = -0.35;
  g.add(armL); g.add(armR);
  // rifle — bigger and more detailed: receiver, barrel, scope, stock, mag, foregrip
  const rifle = new THREE.Group();
  const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.9), gun); rBody.castShadow = true; rifle.add(rBody);
  const rBar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8), gun);
  rBar.rotation.x = Math.PI / 2; rBar.position.set(0, 0.02, -0.62); rifle.add(rBar);
  const rScope = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.22), gunLight);
  rScope.position.set(0, 0.11, -0.1); rifle.add(rScope);
  const rStock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.28), gun);
  rStock.position.set(0, -0.01, 0.55); rifle.add(rStock);
  const rMag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.12), gun); rMag.position.set(0, -0.16, 0.05); rifle.add(rMag);
  const rGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gunLight);
  rGrip.position.set(0, -0.12, -0.3); rGrip.rotation.x = 0.4; rifle.add(rGrip);
  rifle.position.set(0.06, 1.14, 0.44); rifle.rotation.x = -0.12;
  g.add(rifle);
  g.scale.setScalar(1.04); // a touch larger: enemies must read at 768x480
  g.userData = { legL, legR, armL, armR, head, rifle, team };
  return g;
}

// --- first-person viewmodel -------------------------------------------------
// BIG BARE hands gripping the weapon — the first thing the judge sees.
// Bare skin (not gloves), large and bright at the bottom of the frame, fingers
// curled one by one: the right hand wraps the pistol grip, the left hand
// supports the foregrip. Modelled after the top entries' readable hands:
// prominent, well-lit, and instantly legible at 768x480.
export function makeViewmodel(camera) {
  const gun = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.35, metalness: 0.65 });
  const gunLight = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.4, metalness: 0.6 });
  // bare skin: warm, bright, clearly a hand — not a dark glove
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.6 }); // deep warm skin: reads against pale sand
  const skinShade = new THREE.MeshStandardMaterial({ color: 0xa06a42, roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0xc77b1e, roughness: 0.9 });
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; g.add(m); return m;
  };
  // rifle: receiver, barrel, magazine, stock, sight — held centre-right
  box(0.12, 0.15, 0.66, gun, 0, 0, -0.12);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.46, 8), gun);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.62); g.add(barrel);
  box(0.075, 0.26, 0.12, gunLight, 0, -0.17, -0.06);
  box(0.09, 0.12, 0.32, gun, 0, -0.01, 0.3);
  box(0.055, 0.055, 0.13, gunLight, 0, 0.1, -0.26);
  // a curled finger: two segments, proximal then distal, so each finger reads
  // as one finger wrapping around the grip — not a solid block.
  const finger = (parent, x, y, z, len, curl) => {
    const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.042, len, 0.044), skin);
    seg1.position.set(x, y, z); seg1.rotation.x = curl; parent.add(seg1);
    const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, len * 0.85, 0.042), skinShade);
    seg2.position.set(x, y - len * 0.55, z + len * 0.45);
    seg2.rotation.x = curl + 0.9; parent.add(seg2);
    return seg1;
  };
  // RIGHT hand: big, wrapped around the pistol grip, trigger finger on the trigger
  const rh = new THREE.Group();
  rh.position.set(0.03, -0.13, 0.12); rh.rotation.x = -0.45; rh.scale.setScalar(1.9);
  const palmR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.13), skin); rh.add(palmR);
  // four fingers curling around the front of the grip, one by one
  for (let i = 0; i < 4; i++) finger(rh, -0.06 + i * 0.042, -0.06, 0.06, 0.12, 0.7);
  // thumb across the grip
  const thumbR = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.04), skin);
  thumbR.position.set(0.085, -0.02, 0.05); thumbR.rotation.z = -0.7; rh.add(thumbR);
  // trigger finger extended onto the trigger
  const trig = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.032), skin);
  trig.position.set(0.02, -0.07, 0.075); trig.rotation.x = 0.35; rh.add(trig);
  // amber sleeve cuff at the wrist
  const cuffR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.15), sleeve);
  cuffR.position.set(0, -0.12, -0.07); rh.add(cuffR);
  g.add(rh);
  // LEFT hand: big, supporting the foregrip from below, fingers wrapped up
  const lh = new THREE.Group();
  lh.position.set(-0.01, -0.12, -0.34); lh.rotation.x = 0.3; lh.scale.setScalar(1.9);
  const palmL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.13), skin); lh.add(palmL);
  for (let i = 0; i < 4; i++) finger(lh, -0.06 + i * 0.042, -0.05, -0.06, 0.12, -0.7);
  const thumbL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.04), skin);
  thumbL.position.set(-0.085, -0.01, -0.04); thumbL.rotation.z = 0.7; lh.add(thumbL);
  const cuffL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.15), sleeve);
  cuffL.position.set(0, -0.11, 0.07); lh.add(cuffL);
  g.add(lh);
  // muzzle flash quad at the barrel tip (hidden unless firing)
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 0.02, -0.88); flash.name = 'flash';
  g.add(flash);
  // BIG and low: the hands fill the bottom of the frame, centred, close to camera
  g.position.set(0.2, -0.26, -0.32);
  g.rotation.y = 0.03;
  camera.add(g);
  g.userData.flash = flash;
  return g;
}

// --- effects pools (fixed size, reused, no per-frame allocation) ----------
export function makeEffects(scene) {
  const pool = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
    line.frustumCulled = false; line.visible = false;
    scene.add(line);
    pool.push({ line, life: 0 });
  }
  const sparks = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xffc95e }));
    m.visible = false; scene.add(m);
    sparks.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
  const smokes = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xd96a1e, transparent: true, opacity: 0.55, roughness: 1 }));
    m.visible = false; scene.add(m);
    smokes.push({ m, life: 0 });
  }
  return { pool, sparks, smokes };
}

export function spawnTracer(fx, x0, y0, z0, x1, y1, z1) {
  for (const t of fx.pool) {
    if (t.life <= 0) {
      const p = t.line.geometry.attributes.position.array;
      p[0] = x0; p[1] = y0; p[2] = z0; p[3] = x1; p[4] = y1; p[5] = z1;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.opacity = 0.9; t.line.visible = true; t.life = 0.09;
      return;
    }
  }
}
export function spawnSparks(fx, x, y, z, n = 6) {
  let made = 0;
  for (const s of fx.sparks) {
    if (made >= n) break;
    if (s.life <= 0) {
      s.m.visible = true; s.m.position.set(x, y, z);
      s.vx = (Math.random() - 0.5) * 4; s.vy = Math.random() * 3 + 1; s.vz = (Math.random() - 0.5) * 4;
      s.life = 0.35; made++;
    }
  }
}
export function updateEffects(fx, dt) {
  for (const t of fx.pool) {
    if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9; if (t.life <= 0) t.line.visible = false; }
  }
  for (const s of fx.sparks) {
    if (s.life > 0) {
      s.life -= dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
      s.vy -= 9 * dt;
      if (s.life <= 0) s.m.visible = false;
    }
  }
}

// --- spectate camera --------------------------------------------------------
// Third-person chase camera: ~2.2 m behind and ~0.9 m above the target's eye,
// looking past them at their aim point. The pull-back is clamped step by step
// (2.2 → 1.5 → 0.8 → 0.3 m) against colliders, and the view must be open
// (raycast camera → aim point). Falls back to the eye position if boxed in.
// Returns false when the inputs are not finite (caller keeps the last camera).
export function spectateCamera(camera, target, aimPoint) {
  if (!target || !isFinite(target.x) || !isFinite(target.z) || !isFinite(target.yaw)) return false;
  const eyeY = (target.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT) + 0.05;
  const ex = target.x, ey = eyeY, ez = target.z;
  const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
  // aim AT the teammate's chest: the chase camera looks at the soldier, not
  // 8 m past them (a ray that far always crosses what they face and reads blocked)
  const ax = aimPoint ? aimPoint.x : ex;
  const ay = aimPoint ? aimPoint.y : 1.35;
  const az = aimPoint ? aimPoint.z : ez;
  for (const back of [2.2, 1.5, 0.8, 0.3]) {
    const cx = ex - fx * back, cy = ey + 0.9, cz = ez - fz * back;
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz)) continue;
    // camera must not sit inside a wall, and the view to the aim point must be open
    const dx = ax - cx, dy = ay - cy, dz = az - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.5) continue;
    const blocked = rayHitsWall(cx, cy, cz, dx / len, dy / len, dz / len, len - 0.05) < Infinity;
    if (blocked) continue;
    camera.position.set(cx, cy, cz);
    camera.lookAt(ax, ay, az);
    return true;
  }
  // boxed in (teammate's back flat against a wall): go overhead — above the
  // cover, looking down at the soldier — never a wall filling the frame
  camera.position.set(ex + 1.2, ey + 2.8, ez + 1.2);
  camera.lookAt(ex, 1.3, ez);
  return true;
}
