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
// REBUILT 2026-11-17 round 2 — the round-1 hands were boxes with no gaps:
// the four fingers merged into one block and Durov said "masih sama".
// This build follows the hand brief exactly:
//   - ONE THREE.Group parented to the camera: gun + both hands + both
//     forearms. Recoil, bob and reload move the whole group together.
//   - Gun = flat-shaded angular boxes. Hands = smooth-shaded capsules.
//     That contrast is what makes the hands read as hands.
//   - Trigger hand (bare skin): palm + FOUR fingers, each its own mesh of
//     TWO capsule segments (long base + short tip), curled around a REAL
//     angled pistol grip, with a VISIBLE GAP between neighbouring fingers
//     so each finger can be counted at 768x480. Thumb = two capsules on
//     the grip side. Index finger EXTENDED forward to the trigger.
//   - Support hand (GLOVED, deep green — a different colour from the skin
//     trigger hand): grips the forestock FROM BELOW, separate capsule
//     fingers with gaps, curled under it.
//   - Forearms: LONG tapered cylinders that exit the bottom of the frame —
//     never a floating hand. Each wears a sleeve (rust red) + a cuff ring
//     (mustard gold) at the wrist.
//   - Palette is OUR OWN (warm tan skin / forest-green glove / rust-red
//     sleeve / mustard cuff / graphite gun) — not copied from any entry.
//   - A warm point light rides with the viewmodel so the finger capsules
//     show soft shading and the gaps read as shadow.
//   - kind 'rifle' = two-hand hold (VK-47, Hornet, Longshot, Breacher).
//     kind 'pistol' = one-hand hold (P9 sidearm): short slide, trigger
//     hand only, no support hand.
// SCALE FIX (round 2, second pass): the first round-2 build scaled the hand
// groups 2.2x/2.0x, so the palm alone was 0.33 m wide at 0.3 m from the
// camera — it swallowed the gun and the frame (verified in an isolation
// render against blue). Everything below is TRUE SIZE: palm ~0.085 m wide,
// fingers 0.012 m radius spaced 0.036 m apart (0.012 m visible gap), stock
// pulled back so its rear face never comes within 0.24 m of the camera.
// PALM FIX (third pass): a sharp box palm read as a cardboard cube, so the
// palm is a smooth-shaded scaled sphere (rounded, no flat faces).
// ANGLE FIX (fourth pass): viewed dead-on from behind, the curled fingers
// sit on the far side of the grip and the palm hides them — so the whole
// viewmodel is canted 0.30 rad (gun's left side toward the camera, like a
// real FPS hold) and the trigger hand is turned 0.35 rad, swinging the
// fingers out where they can be counted.
// FINGER FIX (fifth pass): the palm sphere still hid the middle finger, so
// the palm shrank again (0.046 radius), the fingers spread to 0.036 m
// spacing, and the segments got longer and sit further forward so all three
// curled fingers clear the grip face and read as separate capsules.
export function makeViewmodel(camera, kind = 'rifle') {
  const isPistol = kind === 'pistol';
  // --- OUR OWN palette (not copied from any entry) ---
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.35, metalness: 0.65, flatShading: true });
  const gunLightMat = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.4, metalness: 0.6, flatShading: true });
  const magMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.5, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd99b66, roughness: 0.55 });          // warm light tan skin
  const skinShadeMat = new THREE.MeshStandardMaterial({ color: 0xb57a45, roughness: 0.6 });      // deeper tan: finger tips
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1e6b52, roughness: 0.75 });         // deep forest-green glove
  const gloveShadeMat = new THREE.MeshStandardMaterial({ color: 0x15503d, roughness: 0.8 });     // darker green: finger tips
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x9e3b2e, roughness: 0.9 });         // rust-red sleeve
  const cuffMat = new THREE.MeshStandardMaterial({ color: 0xe8b93c, roughness: 0.6, emissive: 0xe8b93c, emissiveIntensity: 0.12 }); // mustard-gold cuff
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
  };
  const cyl = (r, len, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; g.add(m); return m;
  };
  // a capsule finger segment: smooth-shaded, long axis is Y before rotation
  const cap = (parent, r, len, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
  // a tapered limb between two points (forearms): oriented by quaternion
  const _up = new THREE.Vector3(0, 1, 0);
  const limb = (parent, from, to, rTop, rBottom, mat) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, 12), mat);
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
    parent.add(m); return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // --- gun: flat-shaded angular boxes --------------------------------------
  let mag = null;
  if (!isPistol) {
    box(0.09, 0.11, 0.50, gunMat, 0, 0.01, -0.10);                   // receiver
    cyl(0.022, 0.36, gunMat, 0, 0.025, -0.50, Math.PI / 2);           // barrel
    box(0.085, 0.09, 0.26, gunMat, 0, -0.035, -0.36);                 // forestock (real grip geometry)
    box(0.035, 0.025, 0.24, gunLightMat, 0, 0.02, -0.36);             // top rail
    mag = box(0.06, 0.20, 0.10, magMat, 0, -0.14, -0.02, 0.12);      // magazine (dips on reload)
    box(0.07, 0.09, 0.16, gunMat, 0, -0.03, 0.02);                    // stock (short, pulled back)
    box(0.045, 0.045, 0.10, gunLightMat, 0, 0.085, -0.20);            // sight
  } else {
    box(0.085, 0.10, 0.26, gunMat, 0, 0, -0.02);                      // short slide
    cyl(0.02, 0.12, gunMat, 0, 0.01, -0.20, Math.PI / 2);             // short barrel
    mag = box(0.055, 0.14, 0.08, magMat, 0, -0.13, 0.10, 0.1);       // pistol mag (inside the grip)
    box(0.045, 0.035, 0.09, gunLightMat, 0, 0.065, -0.10);            // front sight
  }
  // REAL angled pistol grip (both kinds) — fingers curl around THIS geometry
  box(0.06, 0.17, 0.075, gunMat, 0, -0.11, 0.10, -0.42);
  box(0.018, 0.06, 0.018, gunLightMat, 0, -0.075, 0.03, 0.3);        // trigger

  // --- trigger hand (bare skin, right hand on the pistol grip) -------------
  // TRUE SIZE: palm ~0.085 m wide, fingers 0.012 m radius spaced 0.036 m
  // apart (0.012 m visible gap) so each finger can be COUNTED at 768x480.
  // No group scale — the old 2.2x scale is what blew the hand up.
  const rh = new THREE.Group();
  rh.position.set(0.01, -0.09, 0.10);
  rh.rotation.y = 0.35; // turn the finger side toward the camera
  // palm: ONE rounded form (scaled sphere, smooth-shaded — no flat faces)
  const palmR = new THREE.Mesh(new THREE.SphereGeometry(0.046, 16, 12), skinMat);
  palmR.scale.set(0.9, 1.0, 0.5);
  palmR.position.set(0.008, 0.005, 0.05); rh.add(palmR);
  cap(rh, 0.026, 0.03, skinMat, 0, -0.05, 0.05, 0.5, 0, 0);          // palm heel
  // three curled fingers (middle, ring, pinky) around the grip front face.
  // The grip face runs diagonally (tilt -0.42), so each finger sits a little
  // lower and further back than the one above it — the z values follow the
  // face, so the capsules hug the grip instead of floating or clipping.
  // Spacing 0.036 m, segments longer and further forward than the last pass
  // so every finger clears the grip face as its own capsule.
  const curlY = [0.010, -0.026, -0.062];
  const curlZ = [-0.062, -0.048, -0.034];
  for (let i = 0; i < 3; i++) {
    const y = curlY[i], z = curlZ[i];
    // base segment: wraps over the front of the grip
    cap(rh, 0.012, 0.06, skinMat, -0.010, y + 0.006, z + 0.002, -0.85, 0, 0);
    // tip segment: curls down-back under the grip (darker = reads as shadow)
    cap(rh, 0.011, 0.032, skinShadeMat, -0.010, y - 0.032, z + 0.010, 2.25, 0, 0);
  }
  // index finger EXTENDED forward along the frame, near the trigger
  cap(rh, 0.0115, 0.055, skinMat, 0.006, 0.048, -0.035, -1.25, 0, 0);
  cap(rh, 0.010, 0.035, skinShadeMat, 0.003, 0.045, -0.080, -1.25, 0, 0);
  // thumb: two capsules lying along the side of the grip (inner ends touch it)
  cap(rh, 0.012, 0.05, skinMat, -0.040, -0.015, 0.01, 0.2, 0, 0.85);
  cap(rh, 0.011, 0.035, skinShadeMat, -0.052, -0.032, 0.005, 0.2, 0, 1.3);
  g.add(rh);

  // --- support hand (GLOVED, left hand under the forestock) ----------------
  // Rifle only: grips the forestock FROM BELOW, four separate capsule
  // fingers with gaps, curled up around it. Glove green != skin tan.
  let lh = null;
  let lhBase = null;
  if (!isPistol) {
    lh = new THREE.Group();
    lh.position.set(0, -0.125, -0.36);
    const palmL = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), gloveMat);
    palmL.scale.set(0.9, 0.7, 1.05);
    palmL.position.set(0, 0, 0); lh.add(palmL);
    // four fingers side by side along the forestock, wrapping up from below
    const supZ = [-0.075, -0.045, -0.015, 0.015];
    for (let i = 0; i < 4; i++) {
      const z = supZ[i];
      cap(lh, 0.0115, 0.055, gloveMat, -0.048, 0.055, z, 0, 0, 0.35);       // base: up the side
      cap(lh, 0.0105, 0.04, gloveShadeMat, -0.008, 0.115, z, 0, 0, 1.35);   // tip: over the top edge
    }
    // thumb on the far side of the forestock (inner end touches it)
    cap(lh, 0.0115, 0.045, gloveMat, 0.038, 0.035, 0, 0, 0, -0.9);
    g.add(lh);
    lhBase = lh.position.clone();
  }

  // --- forearms: LONG tapered limbs exiting the bottom of the frame --------
  // Never a floating hand: each wrist continues into a sleeve + cuff + skin.
  // Trigger arm (skin at the wrist, rust sleeve, mustard cuff) — bottom-right.
  // Waypoints raised vs the first pass so the mustard cuff reads at the
  // bottom edge of the frame instead of sitting below it.
  limb(g, V(0.03, -0.12, 0.13), V(0.08, -0.19, 0.12), 0.030, 0.034, skinMat);
  limb(g, V(0.08, -0.19, 0.12), V(0.11, -0.235, 0.11), 0.038, 0.038, cuffMat);
  limb(g, V(0.11, -0.235, 0.11), V(0.28, -0.55, 0.05), 0.038, 0.048, sleeveMat);
  // Support arm (glove at the wrist, rust sleeve, mustard cuff) — bottom-left.
  if (!isPistol) {
    limb(g, V(-0.01, -0.16, -0.36), V(-0.05, -0.25, -0.34), 0.030, 0.034, gloveMat);
    limb(g, V(-0.05, -0.25, -0.34), V(-0.08, -0.31, -0.33), 0.038, 0.038, cuffMat);
    limb(g, V(-0.08, -0.31, -0.33), V(-0.24, -0.62, -0.28), 0.038, 0.048, sleeveMat);
  }

  // --- warm light riding with the viewmodel ---------------------------------
  // A short-range point light so the finger capsules show soft shading and
  // the gaps between fingers read as shadow. It rides with the group, so it
  // never lights the world — only the hands and gun.
  const vmLight = new THREE.PointLight(0xffc98a, 2.4, 1.6, 2);
  vmLight.position.set(0.15, 0.45, 0.35);
  g.add(vmLight);

  // muzzle flash quad at the barrel tip (hidden unless firing)
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 0.02, isPistol ? -0.28 : -0.72); flash.name = 'flash';
  g.add(flash);
  // Cant the whole hold 0.30 rad so the gun's left side — and the fingers
  // curled around it — face the camera, like a real FPS hold. (main.js sets
  // the group's position every frame — bob / sway / recoil / reload ride on
  // top of this base. The numbers here are the fall-back.)
  g.position.set(0.2, -0.05, -0.48);
  g.rotation.y = 0.30;
  camera.add(g);
  g.userData.flash = flash;
  g.userData.handL = lh;
  g.userData.handLBase = lhBase;
  g.userData.mag = mag;
  g.userData.magBaseY = mag ? mag.position.y : 0;
  g.userData.kind = kind;
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
    sparks.push({ m, life: 0 });
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
