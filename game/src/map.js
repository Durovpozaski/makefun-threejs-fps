// map.js — SOLSTICE YARD: a bright sunset-desert solar relay station.
// Own layout, own sightlines. Three lanes (west / mid / east), two bomb sites
// (A = solar array, B = relay dish), crates and containers as cover.
// Ground is flat (y = 0) so movement and collision stay robust; height comes
// from walls, crates, panels and the dish. All colliders are axis-aligned boxes.

import * as THREE from 'three';

// A collider is { x0, z0, x1, z1, h } — an axis-aligned box standing on y = 0.
export const MAP = {
  bounds: { x0: -32, z0: -22, x1: 32, z1: 22 },
  sites: {
    A: { x: -22, z: -14, r: 4.5, name: 'SOLAR ARRAY' },
    B: { x: 22, z: -14, r: 4.5, name: 'RELAY DISH' },
  },
  spawns: {
    attack: [[-8, 18], [-4, 18], [0, 18], [4, 18], [8, 18]],
    defend: [[-8, -18], [-4, -18], [0, -18], [4, -18], [8, -18]],
  },
  // Perimeter walls (thick) plus interior cover. Lanes run at x = -24, 0, 24
  // and cross-connectors at z = 8 and z = -6 — nothing blocks those lines.
  colliders: [
    // perimeter (h = 4)
    { x0: -33, z0: -23, x1: 33, z1: -22, h: 4 },
    { x0: -33, z0: 22, x1: 33, z1: 23, h: 4 },
    { x0: -33, z0: -22, x1: -32, z1: 22, h: 4 },
    { x0: 32, z0: -22, x1: 33, z1: 22, h: 4 },
    // west container rows (h = 2.6) — flank the west lane, never on it
    { x0: -29, z0: 8, x1: -26, z1: 14, h: 2.6 },
    { x0: -20, z0: 10, x1: -17, z1: 13, h: 2.6 },
    { x0: -29, z0: -6, x1: -26, z1: 0, h: 2.6 },
    { x0: -20, z0: -8, x1: -17, z1: -2, h: 2.6 },
    // mid courtyard crates (h = 1.4–2.2)
    { x0: -3, z0: 6, x1: -1, z1: 8, h: 1.4 },
    { x0: 2, z0: 2, x1: 5, z1: 4, h: 2.2 },
    { x0: -5, z0: -2, x1: -2, z1: 0, h: 1.4 },
    { x0: 1, z0: -8, x1: 4, z1: -6, h: 2.2 },
    // east solar panel rows (h = 2.4) — flank the east lane
    { x0: 17, z0: 8, x1: 20, z1: 14, h: 2.4 },
    { x0: 27, z0: 8, x1: 30, z1: 14, h: 2.4 },
    { x0: 17, z0: -6, x1: 20, z1: 0, h: 2.4 },
    { x0: 27, z0: -6, x1: 30, z1: 0, h: 2.4 },
    // site A: panel blocks around the array (h = 2.4)
    { x0: -28, z0: -18, x1: -25, z1: -12, h: 2.4 },
    { x0: -19, z0: -18, x1: -16, z1: -12, h: 2.4 },
    // site B: dish pedestal (h = 3) and a crate
    { x0: 20, z0: -16, x1: 24, z1: -12, h: 3 },
    { x0: 27, z0: -18, x1: 30, z1: -15, h: 1.4 },
    // central relay mast base (h = 3)
    { x0: -1.5, z0: -11.5, x1: 1.5, z1: -8.5, h: 3 },
    // north wall niches defenders hide behind
    { x0: -12, z0: -19, x1: -9, z1: -16, h: 2.2 },
    { x0: 9, z0: -19, x1: 12, z1: -16, h: 2.2 },
  ],
  // Waypoints live in open space, never inside a collider. Routes use them.
  waypoints: {
    W1: [-24, 12], W2: [-24, 4], W3: [-24, -4], W4: [-22, -10],
    M1: [0, 12], M2: [0, 4], M3: [0, -4], M4: [0, -10],
    E1: [24, 12], E2: [24, 4], E3: [24, -4], E4: [22, -10],
    SA: [-22, -14], SB: [22, -14],
    C1: [-12, 8], C2: [12, 8], C3: [-12, -6], C4: [12, -6],
    DA: [-22, -17], DB: [22, -17], DM: [0, -4], DW: [-12, -12], DE: [12, -12],
    C3a: [-8, 0], C4a: [8, 0], DBa: [16, -17],
    SP: [0, 16],
  },
  routes: {
    toA_west: ['W1', 'W2', 'W3', 'W4', 'SA'],
    toA_mid: ['M1', 'M2', 'C3a', 'C3', 'W3', 'W4', 'SA'],
    toB_east: ['E1', 'E2', 'E3', 'E4', 'SB'],
    toB_mid: ['M1', 'M2', 'C4a', 'C4', 'E3', 'E4', 'SB'],
    mid: ['M1', 'M2', 'M3', 'M4'],
    retakeA: ['C3', 'W3', 'W4', 'SA'],
    retakeB: ['C4', 'E3', 'E4', 'SB'],
  },
};

// --- collision ------------------------------------------------------------
// Circle (x, z, radius r) against every collider box. Returns true on contact.
export function circleHitsWall(x, z, r) {
  const cs = MAP.colliders;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// Ray (origin + t*dir, dir normalised) against wall boxes. Returns the
// distance to the first hit, or Infinity. Used for bullets and line of sight.
export function rayHitsWall(ox, oy, oz, dx, dy, dz, maxD) {
  let best = Infinity;
  const cs = MAP.colliders;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    let t0 = 0, t1 = maxD;
    // x slab
    if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
    else {
      let a = (c.x0 - ox) / dx, b = (c.x1 - ox) / dx;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    // z slab
    if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
    else {
      let a = (c.z0 - oz) / dz, b = (c.z1 - oz) / dz;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    // y slab (box spans 0..h)
    if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) continue; }
    else {
      let a = (0 - oy) / dy, b = (c.h - oy) / dy;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (t0 < best && t0 >= 0) best = t0;
  }
  return best;
}

// True when a wall stands between the two points.
export function losBlocked(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  return rayHitsWall(x0, y0, z0, dx / len, dy / len, dz / len, len - 0.01) < Infinity;
}

// --- visuals --------------------------------------------------------------
// Build the whole map into the scene. Bright sunset palette: sand ground,
// terracotta walls, deep-blue solar panels, white dish, amber crates.
export function buildMap(scene) {
  const sand = new THREE.MeshStandardMaterial({ color: 0xd9a95c, roughness: 1 });
  const sandDark = new THREE.MeshStandardMaterial({ color: 0xbd8a45, roughness: 1 });
  const terra = new THREE.MeshStandardMaterial({ color: 0xb4633a, roughness: 0.95 });
  const terraLight = new THREE.MeshStandardMaterial({ color: 0xd07a4a, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b30, roughness: 1 });
  const woodLight = new THREE.MeshStandardMaterial({ color: 0xc08a3e, roughness: 1 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x14335e, roughness: 0.35, metalness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a6b78, roughness: 0.5, metalness: 0.6 });
  const group = new THREE.Group();
  const add = (mesh, x, y, z, ry = 0) => { mesh.position.set(x, y, z); mesh.rotation.y = ry; group.add(mesh); return mesh; };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // ground: big sand slab + darker lane strips so lanes read at a glance
  add(new THREE.Mesh(new THREE.PlaneGeometry(66, 46), sand), 0, 0, 0).rotation.x = -Math.PI / 2;
  for (const [x, w] of [[-24, 5], [0, 5], [24, 5]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 44), sandDark);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.01, 0); group.add(strip);
  }
  // site pads: A amber, B blue, with a painted ring
  const padA = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.9 }));
  padA.rotation.x = -Math.PI / 2; padA.position.set(-22, 0.02, -14); group.add(padA);
  const padB = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), new THREE.MeshStandardMaterial({ color: 0x57c8ff, roughness: 0.9 }));
  padB.rotation.x = -Math.PI / 2; padB.position.set(22, 0.02, -14); group.add(padB);
  const ring = (x, z, c) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(4.5, 5.1, 28), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); group.add(m);
  };
  ring(-22, -14, 0xffffff); ring(22, -14, 0xffffff);

  // perimeter walls
  add(box(66, 4, 1, terra), 0, 2, -22.5);
  add(box(66, 4, 1, terra), 0, 2, 22.5);
  add(box(1, 4, 46, terra), -32.5, 2, 0);
  add(box(1, 4, 46, terra), 32.5, 2, 0);
  // wall caps (lighter top edge so walls read in bright light)
  add(box(66, 0.3, 1.2, terraLight), 0, 4.1, -22.5);
  add(box(66, 0.3, 1.2, terraLight), 0, 4.1, 22.5);

  // interior colliders as visible cover (skip the perimeter ones)
  for (let i = 4; i < MAP.colliders.length; i++) {
    const c = MAP.colliders[i];
    const w = c.x1 - c.x0, d = c.z1 - c.z0, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    let mat = wood;
    if (c.h >= 2.4) mat = (i % 2 === 0) ? panel : steel;
    else if (c.h >= 2.2) mat = terraLight;
    else mat = woodLight;
    add(box(w, c.h, d, mat), cx, c.h / 2, cz);
    // bright top edge on tall cover
    if (c.h >= 2.2) add(box(w + 0.1, 0.12, d + 0.1, white), cx, c.h + 0.06, cz);
  }

  // site A: solar panel array (tilted panels on legs, in front of the site)
  const panelGeo = new THREE.BoxGeometry(3.4, 0.12, 2.2);
  for (const [x, z] of [[-26.5, -15], [-22, -18.5], [-17.5, -15], [-22, -10.5]]) {
    const p = new THREE.Mesh(panelGeo, panel);
    p.position.set(x, 2.0, z); p.rotation.x = -0.5; p.rotation.y = (x === -22 ? 0 : 0.35);
    group.add(p);
    const leg = box(0.25, 2.0, 0.25, steel); add(leg, x, 1.0, z);
  }
  // site B: relay dish (white bowl on the pedestal)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), white);
  dish.position.set(22, 3.0, -14); dish.rotation.x = Math.PI * 0.72; dish.scale.set(1, 1, 0.55);
  group.add(dish);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 10), steel), 22, 1.7, -14);
  // central relay mast with a blinking beacon
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 9, 10), steel), 0, 4.5, -10);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a1a, emissiveIntensity: 2 }));
  add(beacon, 0, 9.2, -10);
  group.userData.beacon = beacon;

  // scattered barrels and a water tower for silhouette
  const barrel = new THREE.MeshStandardMaterial({ color: 0x3f7d4e, roughness: 0.7 });
  const barrel2 = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.7 });
  for (const [x, z, m] of [[-10, 14, barrel], [10, 14, barrel2], [-14, -2, barrel2], [14, -2, barrel], [6, 14, barrel], [-6, -14, barrel]]) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), m), x, 0.65, z);
  }
  // sun: a big warm disc low in the west sky + a few flat clouds
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }));
  sun.position.set(-60, 26, -40); sun.lookAt(0, 0, 0); group.add(sun);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, fog: false, transparent: true, opacity: 0.85 });
  for (const [x, y, z, s] of [[-20, 30, -30, 8], [15, 34, -25, 11], [30, 28, 10, 7], [-35, 32, 15, 9]]) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cloudMat);
    cl.scale.set(s, s * 0.32, s * 0.55);
    cl.position.set(x, y, z); group.add(cl);
  }
  scene.add(group);
  return group;
}

// Smoke blocks line of sight: a segment through a live cloud is blocked.
// Pure function of the segment and the cloud list, so bots and the sim share it.
export function smokeBlocks(x0, y0, z0, x1, y1, z1, smokes) {
  for (const s of smokes) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((s.x - x0) * dx + (1.2 - y0) * dy + (s.z - z0) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
    const d = Math.hypot(px - s.x, py - 1.2, pz - s.z);
    if (d < s.r) return true;
  }
  return false;
}
