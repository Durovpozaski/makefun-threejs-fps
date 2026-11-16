// main.js — the entry point. Boots the game, runs the fixed-step loop, and
// copies simulation state into the three.js scene once a frame.
// The simulation (sim.js) never touches the DOM or three.js; this file is
// the only bridge. Rendering is separate from the 60 Hz simulation.

import * as THREE from 'three';
import { SIM_DT, PLAYER_HEIGHT, CROUCH_HEIGHT, WEAPONS } from './state.js';
import { createSim, stepSim, currentWeapon, equipWeapon, switchSlot, fireWeapon } from './sim.js';
import { createRenderer, makeSoldier, makeViewmodel, makeEffects, spawnTracer, spawnSparks, updateEffects, spectateCamera } from './render.js';
import { AudioBank } from './audio.js';
import { UI } from './ui.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot'); // 'cover' | 'buy' | 'plant' — stages a real game state for screenshots
window.addEventListener('error', (e) => { window.__solsticeErrors = window.__solsticeErrors || []; window.__solsticeErrors.push(String(e.message)); });

const audio = new AudioBank();
const match = createSim();
const { renderer, scene, camera } = createRenderer(document.getElementById('game'));
const viewmodel = makeViewmodel(camera);
const fx = makeEffects(scene);

// one soldier mesh per fighter, created once and reused (no per-frame allocation)
const soldiers = new Map();
for (const f of match.fighters) {
  const g = makeSoldier(f.team);
  g.visible = f.id !== 'player'; // the player never sees their own body
  scene.add(g);
  soldiers.set(f.id, g);
}
// the spike: a small amber box with a blinking light
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff8800, emissiveIntensity: 0.6 }));
bombMesh.add(bombBox);
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
bombLight.position.y = 0.22; bombMesh.add(bombLight);
bombMesh.visible = false; scene.add(bombMesh);

const ui = new UI(match, audio, () => { /* play/resume: nothing extra; the loop is always running */ });
ui.onBuyWeapon = (id) => { const p = match.fighters[0]; equipWeapon(p, id); };
ui.bind(renderer.domElement);

// --- screenshot staging ------------------------------------------------------
// A real running game, pre-configured: the state is live (bots move, the
// timer runs); the shot only chooses where the player stands and what is
// open. No mockups: every pixel is the game's own render.
function stageShot(kind) {
  // the shot is the running game, not the menu: hide the start overlay
  document.getElementById('start').hidden = true;
  const player = match.fighters[0];
  if (kind === 'cover') {
    // live round, player mid-lane facing three defenders, rifle ready
    match.phase = 'buy'; match.phaseTime = 5;
    player.x = 0; player.z = 14; player.yaw = 0.45; player.pitch = 0;
    ui.yaw = 0.45; ui.pitch = 0;
    const defs = match.fighters.filter((f) => f.team === 'defend');
    // three defenders ahead of the player, FACING the camera so the bright
    // visors and team colours read — the nearest one only ~6 m out.
    // They hold their staged spots (home = here) so the shot keeps all three
    // in frame; the round is live around them. No staged firing: the shots
    // only killed defenders and the tracers were gone before the screenshot.
    const spots = [[-4, 8], [2, 0], [0, -4]];
    defs.forEach((d, i) => {
      const s = spots[i % spots.length];
      d.x = s[0]; d.z = s[1];
      d.yaw = Math.atan2(-(player.x - d.x), -(player.z - d.z));
      d.hp = 100; d.alive = true;
      d.home = [d.x, d.z]; d.state = 'hold'; d.route = [];
    });
    player.mag = 30;
  } else if (kind === 'buy') {
    // buy phase with the menu open and money to spend
    match.phase = 'buy'; match.phaseTime = 5;
    match.money = 4200;
    setTimeout(() => ui.toggleBuy(true), 300);
  } else if (kind === 'plant') {
    // player carries the spike, standing on site A, mid-plant
    match.phase = 'buy'; match.phaseTime = 5;
    const carrier = match.fighters[1];
    carrier.hasBomb = false;
    player.hasBomb = true;
    match.bomb.state = 'carried';
    // face NORTH into site A: the array panels flank the frame, the pad is
    // underfoot, two defenders close in through the panel gap, visors lit
    player.x = -22; player.z = -13; player.yaw = 0; player.pitch = -0.05;
    ui.yaw = player.yaw; ui.pitch = player.pitch;
    player.plantProgress = 2.2; // almost planted: the bar and the site read clearly
    const defs = match.fighters.filter((f) => f.team === 'defend');
    const pspots = [[-22, -17], [-24, -17]];
    defs.slice(0, 2).forEach((d, i) => {
      d.x = pspots[i][0]; d.z = pspots[i][1];
      d.yaw = Math.atan2(-(player.x - d.x), -(player.z - d.z));
      d.hp = 100; d.alive = true;
      d.home = [d.x, d.z]; d.state = 'hold'; d.route = [];
    });
  }
}
function firePlayerShot() {
  const p = match.fighters[0];
  if (!p.alive || match.phase !== 'live') return;
  // fire through the sim so the tracer, sound and damage are all real
  const w = currentWeapon(p);
  if (w && p.mag > 0) {
    p.fireCooldown = 0;
    // temporarily point at the nearest visible defender so the shot connects
    const defs = match.fighters.filter((f) => f.alive && f.team === 'defend');
    if (defs.length) {
      const d = defs[0];
      const wantYaw = Math.atan2(-(d.x - p.x), -(d.z - p.z));
      p.yaw = wantYaw; ui.yaw = wantYaw;
    }
    stepSimFireOnly();
  }
}
// fire one shot without advancing the whole sim (used only by staging)
function stepSimFireOnly() {
  const p = match.fighters[0];
  fireWeapon(match, p);
  audio.shot(currentWeapon(p).id, 0, false);
  flashViewmodel();
}

if (SHOT) setTimeout(() => stageShot(SHOT), 400);

// --- WebGL context loss -------------------------------------------------------
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  document.getElementById('ctxlost').hidden = false;
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  document.getElementById('ctxlost').hidden = true;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- per-frame state ------------------------------------------------------------
let lastTime = performance.now();
let acc = 0;
let lastPhase = match.phase;
let lastBeepAt = 0;
let flashUntil = 0;
const prevHp = new Map();
const prevAlive = new Map();
for (const f of match.fighters) { prevHp.set(f.id, f.hp); prevAlive.set(f.id, f.alive); }

function flashViewmodel() {
  flashUntil = performance.now() + 70;
  viewmodel.userData.flash.material.opacity = 0.95;
}

function syncFighters(dt, now) {
  for (const f of match.fighters) {
    const g = soldiers.get(f.id);
    if (!g) continue;
    if (f.id === 'player') { g.visible = false; continue; }
    g.visible = true;
    const eyeY = (f.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT);
    g.position.set(f.x, f.airY || 0, f.z);
    g.rotation.y = f.yaw;
    if (!f.alive) {
      // fallen: lie on the side, rifle dropped beside
      g.rotation.x = 0; g.rotation.z = Math.PI / 2;
      g.position.y = 0.25;
      continue;
    }
    g.rotation.z = 0;
    // walk cycle: legs and arms swing with speed
    const speed = Math.hypot(f.vx, f.vz);
    const phase = now * 0.008 * Math.max(1, speed);
    const swing = Math.min(0.7, speed * 0.14) * Math.sin(phase);
    g.userData.legL.rotation.x = swing;
    g.userData.legR.rotation.x = -swing;
    g.userData.armL.rotation.x = -swing * 0.6;
    g.userData.armR.rotation.x = swing * 0.6;
    // aim the rifle where the bot looks
    g.userData.head.rotation.x = f.pitch * 0.5;
  }
}

function syncBomb() {
  const b = match.bomb;
  if (b.state === 'planted' || b.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(b.x, 0.15, b.z);
    // blink faster as the timer runs down
    const blink = b.state === 'planted' ? (Math.sin(performance.now() * 0.02) > 0 ? 1 : 0.2) : 1;
    bombLight.material.color.setHex(blink > 0.5 ? 0xff2a1a : 0x551111);
  } else bombMesh.visible = false;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(250, now - lastTime);
  lastTime = now;
  const dt = dtMs / 1000;
  // sample input once per frame; edge triggers apply to the first tick only
  const input = ui.getInput();
  const player = match.fighters[0];
  const held = { ...input, reload: false, throwGrenade: false, cycleGrenade: false, switchSlot: 0, jump: false, fireEdge: false };
  acc += dt;
  let ticks = 0;
  while (acc >= SIM_DT && ticks < 5) {
    stepSim(match, ticks === 0 ? input : held, SIM_DT);
    acc -= SIM_DT; ticks += 1;
  }
  if (ticks === 5) acc = 0; // spiral-of-death guard: drop time, never hang

  // weapon switching / semi-auto gating lives here (input → sim)
  // (switchSlot is applied by sim via input.switchSlot; Q / wheel resolve here)
  if (input.switchSlot === -1) { // Q: last weapon
    const target = player.slot === 1 ? 2 : 1;
    if (player.weapons.primary || target === 2) switchSlot(player, target);
  } else if (input.switchSlot === -2 || input.switchSlot === -3) {
    const order = [1, 2, 3];
    const i = order.indexOf(player.slot);
    switchSlot(player, order[(i + (input.switchSlot === -2 ? 1 : order.length - 1)) % order.length]);
  } else if (input.switchSlot === 4) {
    // slot 4: knife (not a weapon) — fall back to pistol
    switchSlot(player, 2);
  }
  // semi-auto weapons fire only on the click edge, not while held
  // (auto weapons already fire while held inside stepSim)

  // --- audio + feedback from state changes -------------------------------------
  for (const f of match.fighters) {
    const prev = prevHp.get(f.id);
    if (f.hp < prev) {
      if (f.lastDamageFrom === 'player') {
        ui.showHitmarker(!!f.lastHitHead);
        audio.hit(!!f.lastHitHead);
        if (!f.alive) audio.kill();
      } else if (f.id === 'player') {
        audio.hurt();
      }
    }
    if (prevAlive.get(f.id) && !f.alive && f.id === 'player') {
      // player died: hide the viewmodel, spectate takes over
      viewmodel.visible = false;
    }
    prevHp.set(f.id, f.hp);
    prevAlive.set(f.id, f.alive);
  }
  // tracers fired this tick
  for (const b of match.bullets) {
    if (!b._shown) { b._shown = true; spawnTracer(fx, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1); spawnSparks(fx, b.x1, b.y1, b.z1, 3); }
  }
  // gunshot sounds: the player's own shot is loud; bots fall off with distance
  // (we detect shots by the fighter's fireCooldown resetting — approximated by
  //  tracing the bullets list: each new bullet with a shooter is a shot)
  // Simpler and exact: shots are sounded in stepSimFireOnly and by a hook below.
  // bomb beeps speed up as the timer runs down
  if (match.bomb.state === 'planted') {
    const interval = Math.max(0.35, match.bomb.timer * 0.03);
    if (now - lastBeepAt > interval * 1000) {
      lastBeepAt = now;
      audio.beep(match.bomb.timer < 5);
    }
  }
  // smoke clouds: show one sphere per active cloud
  fx.smokes.forEach((s, i) => {
    const c = match.smokes[i];
    if (c) {
      s.m.visible = true;
      s.m.position.set(c.x, 1.2, c.z);
      s.m.scale.setScalar(c.r);
    } else s.m.visible = false;
  });

  // --- phase transitions -------------------------------------------------------
  if (match.phase !== lastPhase) {
    if (match.phase === 'ended') {
      const won = match.scoreAtk > match.scoreDef || (match.winner === 'attack');
      const playerWon = match.roundEndReason.includes('Solstice') || match.roundEndReason.includes('SITE CLEARED') || match.roundEndReason.includes('DETONATED');
      ui.showBanner(playerWon, match.roundEndReason);
      if (playerWon) audio.roundWin(); else audio.roundLose();
    }
    if (match.phase === 'buy') ui.hideBanner();
    if (match.phase === 'over') {
      const won = match.winner === 'attack';
      ui.showBanner(won, won ? 'SOLSTICE takes the match!' : 'DUSK WARDENS take the match.');
    }
    lastPhase = match.phase;
  }
  // drain the event feed into the HUD
  for (const e of match.events) ui.pushEvent(e);
  match.events.length = 0;

  // --- camera ------------------------------------------------------------------
  const eyeY = (player.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT) + (player.airY || 0);
  if (player.alive) {
    viewmodel.visible = true;
    camera.position.set(player.x, eyeY, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = 0;
    // recoil: the viewmodel kicks with the pitch
    viewmodel.position.y = -0.24 + player.recoilPitch * 0.35;
    viewmodel.position.z = -0.55 + player.recoilPitch * 0.2;
    viewmodel.rotation.x = player.recoilPitch * 0.9;
  } else {
    // dead: third-person spectate chase camera (see render.js)
    const target = ui.spectateTarget();
    if (target) {
      const aim = { x: target.x - Math.sin(target.yaw) * 8, y: 1.4, z: target.z - Math.cos(target.yaw) * 8 };
      spectateCamera(camera, target, aim);
    }
  }
  // muzzle flash fades fast
  if (performance.now() > flashUntil) viewmodel.userData.flash.material.opacity = 0;

  soundShots();
  syncFighters(dt, now);
  syncBomb();
  updateEffects(fx, dt);
  ui.updateHUD();
  renderer.render(scene, camera);
}

// click / Q cycles the spectate target while dead (never fires a shot)
document.addEventListener('mousedown', (e) => {
  const player = match.fighters[0];
  if (!player.alive && match.phase === 'live' && e.button === 0) {
    if (e.target && e.target.closest && e.target.closest('button, .overlay')) return;
    ui.cycleSpectate();
  }
});

// Gunshot sounds: a magazine dropping by one means a shot was fired this
// frame (reload only raises it). The player's own shot is loud and flashes
// the viewmodel; bot shots fall off with distance.
const prevMag = new Map();
for (const f of match.fighters) prevMag.set(f.id, f.mag);
function soundShots() {
  const player = match.fighters[0];
  for (const f of match.fighters) {
    const prev = prevMag.get(f.id);
    if (f.mag < prev) {
      const w = currentWeapon(f);
      if (f.id === 'player') { audio.shot(w ? w.id : 'vk47', 0, false); flashViewmodel(); }
      else {
        const d = Math.hypot(f.x - player.x, f.z - player.z);
        audio.shot(w ? w.id : 'vk47', d, true);
      }
    }
    prevMag.set(f.id, f.mag);
  }
}
requestAnimationFrame(frame);

// expose a small debug handle for the playtest scripts (read-only state)
window.__solstice = { match, ui, version: 'solstice-yard-1' };
