// sim.js — the fixed-step simulation (60 Hz), fully separate from rendering.
// It knows nothing about three.js or the DOM: it moves fighters, resolves
// shots, grenades, the bomb and the rounds, and main.js renders the result.
// One job, one file. Bots are stepped by bots.js (called from stepSim).

import {
  SIM_DT, ROUND_WIN_SCORE, MAX_ROUNDS, BUY_SECONDS, ROUND_SECONDS, BOMB_SECONDS,
  PLANT_SECONDS, DEFUSE_SECONDS, START_MONEY, KILL_MONEY, WIN_MONEY, LOSS_MONEY,
  PLAYER_RADIUS, PLAYER_HEIGHT, CROUCH_HEIGHT, KEVLAR_REDUCTION,
  WEAPONS, GRENADES, makeFighter, createMatch,
} from './state.js';
import { MAP, circleHitsWall, rayHitsWall, losBlocked, smokeBlocks } from './map.js';
import { stepBots } from './bots.js';

const ATK_NAMES = ['Dune', 'Mesa', 'Sol', 'Ash'];
const DEF_NAMES = ['Kite', 'Flint', 'Vale', 'Rune'];

export function createSim() {
  const match = createMatch();
  spawnRound(match, true);
  return match;
}

// Reset every fighter to its spawn for a new round. first = match start.
export function spawnRound(match, first = false) {
  match.fighters = [];
  const atkSpawns = MAP.spawns.attack, defSpawns = MAP.spawns.defend;
  const player = makeFighter('player', 'attack', 'You', atkSpawns[2]);
  player.weapons.primary = 'vk47';
  equipWeapon(player, 'vk47');
  match.fighters.push(player);
  for (let i = 0; i < 4; i++) {
    const b = makeFighter('atk' + i, 'attack', ATK_NAMES[i], atkSpawns[i < 2 ? i : i + 1]);
    b.weapons.primary = i % 2 === 0 ? 'vk47' : 'hornet';
    equipWeapon(b, b.weapons.primary);
    b.vy = 0; b.airY = 0;
    match.fighters.push(b);
  }
  for (let i = 0; i < 4; i++) {
    const b = makeFighter('def' + i, 'defend', DEF_NAMES[i], defSpawns[i]);
    b.weapons.primary = i % 2 === 0 ? 'vk47' : 'longshot';
    equipWeapon(b, b.weapons.primary);
    b.vy = 0; b.airY = 0;
    match.fighters.push(b);
  }
  player.vy = 0; player.airY = 0;
  // the bomb rides with attacker bot 0; if it dies, it drops and can be picked up
  const carrier = match.fighters[1];
  carrier.hasBomb = true;
  match.bomb = { state: 'carried', x: carrier.x, z: carrier.z, site: null, timer: 0, planter: null };
  match.phase = 'buy';
  match.phaseTime = BUY_SECONDS;
  match.roundEndReason = '';
  // fresh bot routes for this round
  for (const f of match.fighters) {
    if (!f.isBot) continue;
    f.route = []; f.routeIndex = 0; f.state = 'route'; f.stateUntil = 0;
    f.holdUntil = 0; f.target = null; f.hp = 100; f.alive = true;
    f.plantProgress = 0; f.defuseProgress = 0; f.stuckSince = 0;
  }
}

export function currentWeapon(f) {
  if (f.slot === 2) return WEAPONS[f.weapons.secondary];
  if (f.slot === 3) return null;
  return WEAPONS[f.weapons.primary] || WEAPONS[f.weapons.secondary];
}

export function equipWeapon(f, id) {
  const w = WEAPONS[id];
  f.mag = w.mag; f.reserve = w.reserve; f.reloading = 0; f.fireCooldown = 0;
}

export function switchSlot(f, slot) {
  if (slot === 1 && !f.weapons.primary) return false;
  if (slot === 3) {
    const has = f.weapons.grenades.frag + f.weapons.grenades.flash + f.weapons.grenades.smoke;
    if (has <= 0) return false;
  }
  f.slot = slot;
  if (slot !== 3) equipWeapon(f, slot === 1 ? f.weapons.primary : f.weapons.secondary);
  f.reloading = 0;
  return true;
}

// --- movement ---------------------------------------------------------------
// Acceleration + friction (no ice-skating), axis-separated wall collision,
// crouch (slower, lower eye) and jump (vertical velocity + gravity).
export function moveFighter(match, f, mx, mz, dt) {
  if (!f.alive) return;
  const speed = f.crouched ? 2.2 : 4.6;
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  // input is in player-local space: forward = -z rotated by yaw
  const tx = (-sin * mz + cos * mx) * speed;
  const tz = (-cos * mz - sin * mx) * speed;
  const accel = f.onGround ? 34 : 12;
  const fric = f.onGround ? 22 : 2;
  const approach = (v, t) => {
    const d = t - v;
    const step = Math.max(-accel * dt, Math.min(accel * dt, d));
    return v + step;
  };
  if (mx !== 0 || mz !== 0) { f.vx = approach(f.vx, tx); f.vz = approach(f.vz, tz); }
  else {
    const decay = Math.max(0, 1 - fric * dt);
    f.vx *= decay; f.vz *= decay;
    if (Math.abs(f.vx) < 0.02) f.vx = 0;
    if (Math.abs(f.vz) < 0.02) f.vz = 0;
  }
  // axis-separated: move x, test, then z, test — never tunnel through a wall
  const r = PLAYER_RADIUS;
  const nx = f.x + f.vx * dt;
  if (!circleHitsWall(nx, f.z, r)) f.x = nx; else f.vx = 0;
  const nz = f.z + f.vz * dt;
  if (!circleHitsWall(f.x, nz, r)) f.z = nz; else f.vz = 0;
  // clamp to the map bounds
  f.x = Math.max(MAP.bounds.x0 + r, Math.min(MAP.bounds.x1 - r, f.x));
  f.z = Math.max(MAP.bounds.z0 + r, Math.min(MAP.bounds.z1 - r, f.z));
  // vertical: jump + gravity, land on y = 0
  if (f.vy === undefined) { f.vy = 0; f.airY = 0; }
  if (f.airY > 0 || f.vy !== 0) {
    f.vy -= 12 * dt;
    f.airY += f.vy * dt;
    if (f.airY <= 0) { f.airY = 0; f.vy = 0; f.onGround = true; }
  }
  // spread bloom: grows while moving or firing, decays when still
  const moving = Math.abs(f.vx) + Math.abs(f.vz) > 0.5;
  f.spreadBloom = Math.max(0, f.spreadBloom + (moving ? 0.35 : -1.2) * dt);
  f.recoilPitch = Math.max(0, f.recoilPitch - 2.2 * dt);
}

// --- shooting ----------------------------------------------------------------
// Hitscan. Returns a hit record { fighter, head, dist } or null. The ray is
// tested against walls first (rayHitsWall), then against every enemy fighter's
// body cylinder and head sphere; the nearest hit wins.
export function rayHitFighters(match, shooter, ox, oy, oz, dx, dy, dz, maxD) {
  const wallD = rayHitsWall(ox, oy, oz, dx, dy, dz, maxD);
  let best = null;
  for (const f of match.fighters) {
    if (!f.alive || f === shooter || f.team === shooter.team) continue;
    // body: vertical segment y 0..1.55 at (f.x, f.z), radius 0.45
    // head: sphere centre y 1.55, radius 0.24
    const rx = f.x - ox, rz = f.z - oz;
    const along = rx * dx + rz * dz; // horizontal distance along the ray
    if (along < 0 || along > Math.min(wallD, maxD)) continue;
    const px = ox + dx * along, pz = oz + dz * along;
    const ddx = px - f.x, ddz = pz - f.z;
    const radial = Math.sqrt(ddx * ddx + ddz * ddz);
    const yAt = oy + dy * along;
    let hit = null;
    if (radial < 0.48 && yAt >= 0 && yAt <= 1.55) hit = { fighter: f, head: false, dist: along };
    else if (radial < 0.5 && yAt > 1.4 && yAt < 1.85) hit = { fighter: f, head: true, dist: along };
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }
  return { hit: best, wallD };
}

export function fireWeapon(match, f) {
  const w = currentWeapon(f);
  if (!w || f.reloading > 0 || f.fireCooldown > 0 || f.mag <= 0) return false;
  f.fireCooldown = 60 / w.rpm;
  f.mag -= 1;
  const eyeY = (f.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT) + (f.airY || 0);
  const ox = f.x, oy = eyeY, oz = f.z;
  const spread = w.spread + w.moveSpread * f.spreadBloom + (Math.abs(f.vx) + Math.abs(f.vz) > 0.5 ? w.moveSpread * 0.5 : 0);
  const pellets = w.pellets || 1;
  let anyHit = false;
  for (let p = 0; p < pellets; p++) {
    const a = (Math.random() - 0.5) * 2 * spread;
    const b = (Math.random() - 0.5) * 2 * spread;
    const yaw = f.yaw + a;
    const pitch = f.pitch + b + f.recoilPitch * 0.3;
    const dx = -Math.sin(yaw) * Math.cos(pitch);
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * Math.cos(pitch);
    const { hit, wallD } = rayHitFighters(match, f, ox, oy, oz, dx, dy, dz, w.range);
    const endD = hit ? hit.dist : Math.min(wallD, w.range);
    match.bullets.push({ x0: ox, y0: oy, z0: oz, x1: ox + dx * endD, y1: oy + dy * endD, z1: oz + dz * endD, life: 0.09, team: f.team });
    if (hit) {
      anyHit = true;
      let dmg = w.damage * (hit.head ? w.headMult : 1);
      if (hit.fighter.kevlar) dmg *= (1 - KEVLAR_REDUCTION);
      damageFighter(match, hit.fighter, dmg, f, hit.head);
    }
  }
  // recoil kicks the pitch up; spread blooms
  f.pitch = Math.min(1.4, f.pitch + w.recoil * 0.55);
  f.recoilPitch = Math.min(0.3, f.recoilPitch + w.recoil);
  f.spreadBloom = Math.min(1, f.spreadBloom + 0.3);
  f.lastShotAt = match.time;
  // everyone nearby hears the shot (bots react to sound)
  for (const o of match.fighters) {
    if (o.alive && o !== f) {
      const d = Math.hypot(o.x - f.x, o.z - f.z);
      if (d < 40) { o.lastHeardAt = match.time; o.lastHeardX = f.x; o.lastHeardZ = f.z; }
    }
  }
  return anyHit;
}

export function startReload(f) {
  const w = currentWeapon(f);
  if (!w || f.reloading > 0 || f.mag >= w.mag || f.reserve <= 0) return false;
  f.reloading = w.reload;
  return true;
}

export function damageFighter(match, victim, dmg, attacker, head) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastDamageFrom = attacker ? attacker.id : null;
  victim.lastHitHead = !!head;
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deaths += 1;
    victim.vx = 0; victim.vz = 0;
    if (victim.hasBomb) {
      victim.hasBomb = false;
      match.bomb.state = 'dropped';
      match.bomb.x = victim.x; match.bomb.z = victim.z;
      match.events.push(`Bomb dropped at ${victim.name}'s position`);
    }
    if (attacker && attacker !== victim) {
      attacker.kills += 1;
      if (attacker.id === 'player') { match.money += KILL_MONEY; }
      match.events.push(`${attacker.name} ▸ ${victim.name}${head ? ' (HEADSHOT)' : ''}`);
    } else {
      match.events.push(`${victim.name} is down`);
    }
  }
}

// --- grenades ---------------------------------------------------------------
export function throwGrenade(match, f) {
  const type = f.grenadeType;
  if (f.weapons.grenades[type] <= 0) return false;
  f.weapons.grenades[type] -= 1;
  const eyeY = (f.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT) + (f.airY || 0);
  const dx = -Math.sin(f.yaw) * Math.cos(f.pitch);
  const dy = Math.sin(f.pitch) + 0.25;
  const dz = -Math.cos(f.yaw) * Math.cos(f.pitch);
  match.grenades.push({
    type, x: f.x + dx * 0.6, y: eyeY - 0.1, z: f.z + dz * 0.6,
    vx: dx * 13 + f.vx, vy: dy * 13, vz: dz * 13 + f.vz,
    fuse: type === 'frag' ? 1.6 : 1.4, owner: f, bounces: 0,
  });
  return true;
}

function updateGrenades(match, dt) {
  for (let i = match.grenades.length - 1; i >= 0; i--) {
    const g = match.grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    // bounce off walls (dampened) and the ground
    if (circleHitsWall(nx, nz, 0.2)) { g.vx *= -0.4; g.vz *= -0.4; nx = g.x; nz = g.z; }
    if (ny < 0.1) { ny = 0.1; g.vy = Math.abs(g.vy) * 0.4; g.vx *= 0.7; g.vz *= 0.7; }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.fuse <= 0) {
      match.grenades.splice(i, 1);
      detonateGrenade(match, g);
    }
  }
}

function detonateGrenade(match, g) {
  if (g.type === 'frag') {
    match.events.push('Frag detonates');
    for (const f of match.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (d > 9) continue;
      const blocked = losBlocked(g.x, g.y, g.z, f.x, 1.2, f.z);
      let dmg = 90 * Math.max(0, 1 - d / 9);
      if (blocked) dmg *= 0.4;
      if (dmg > 5) damageFighter(match, f, dmg, g.owner, false);
    }
  } else if (g.type === 'flash') {
    match.flashes.push({ x: g.x, y: g.y, z: g.z, at: match.time });
    for (const f of match.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (d > 26) continue;
      if (losBlocked(g.x, g.y, g.z, f.x, 1.5, f.z)) continue;
      // facing the flash matters: looking at it blinds longer
      const fx = g.x - f.x, fz = g.z - f.z;
      const fl = Math.hypot(fx, fz) || 1;
      const facing = (-Math.sin(f.yaw) * fx + -Math.cos(f.yaw) * fz) / fl;
      const strength = Math.max(0.3, facing) * Math.max(0.3, 1 - d / 26);
      f.flashUntil = Math.max(f.flashUntil, match.time + 3 * strength);
    }
  } else if (g.type === 'smoke') {
    match.smokes.push({ x: g.x, z: g.z, r: 3.6, until: match.time + 12 });
    match.events.push('Smoke covers the lane');
  }
}


// --- bomb -------------------------------------------------------------------
function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
  }
  return null;
}

function updateBomb(match, dt) {
  const b = match.bomb;
  if (b.state === 'carried') {
    const carrier = match.fighters.find((f) => f.hasBomb);
    if (carrier) { b.x = carrier.x; b.z = carrier.z; }
    else { b.state = 'dropped'; }
  } else if (b.state === 'dropped') {
    // an attacker walking over the dropped bomb picks it up
    for (const f of match.fighters) {
      if (f.alive && f.team === 'attack' && Math.hypot(f.x - b.x, f.z - b.z) < 1.2) {
        f.hasBomb = true; b.state = 'carried';
        match.events.push(`${f.name} picked up the spike`);
        break;
      }
    }
  } else if (b.state === 'planted') {
    b.timer -= dt;
    // beeps speed up as the timer runs down (main.js reads b.timer for the rate)
    if (b.timer <= 0) {
      b.timer = 0;
      endRound(match, 'attack', 'SPIKE DETONATED — the yard is gone');
    }
  }
}

// --- rounds -----------------------------------------------------------------
function aliveCount(match, team) {
  return match.fighters.filter((f) => f.alive && f.team === team).length;
}

export function endRound(match, winner, reason) {
  if (match.phase === 'over' || match.phase === 'ended') return;
  match.phase = 'ended';
  match.phaseTime = 3.5;
  match.roundEndReason = reason;
  if (winner === 'attack') match.scoreAtk += 1; else match.scoreDef += 1;
  const playerWon = winner === 'attack';
  match.money += playerWon ? WIN_MONEY : LOSS_MONEY;
  match.events.push(reason);
}

function nextRound(match) {
  match.round += 1;
  if (match.scoreAtk >= ROUND_WIN_SCORE || match.scoreDef >= ROUND_WIN_SCORE || match.round > MAX_ROUNDS) {
    match.phase = 'over';
    match.winner = match.scoreAtk > match.scoreDef ? 'attack' : (match.scoreDef > match.scoreAtk ? 'defend' : 'attack');
    return;
  }
  spawnRound(match);
}

// --- the tick ----------------------------------------------------------------
// input is the player's intent for this tick (from ui.js), or null when the
// player is dead / the game is paused. Bots are stepped here too.
export function stepSim(match, input, dt) {
  match.time += dt;
  // expire transient visuals
  for (let i = match.bullets.length - 1; i >= 0; i--) {
    match.bullets[i].life -= dt;
    if (match.bullets[i].life <= 0) match.bullets.splice(i, 1);
  }
  for (let i = match.smokes.length - 1; i >= 0; i--) {
    if (match.smokes[i].until <= match.time) match.smokes.splice(i, 1);
  }
  if (match.phase === 'buy') {
    match.phaseTime -= dt;
    if (match.phaseTime <= 0) { match.phase = 'live'; match.phaseTime = ROUND_SECONDS; }
    return; // frozen: no movement, no shooting during buy
  }
  if (match.phase === 'ended') {
    match.phaseTime -= dt;
    if (match.phaseTime <= 0) nextRound(match);
    return;
  }
  if (match.phase === 'over') return;

  // live round
  match.phaseTime -= dt;
  const player = match.fighters[0];
  // player intent
  if (input && player.alive) {
    player.yaw = input.yaw; player.pitch = input.pitch;
    player.crouched = !!input.crouch;
    if (input.jump && player.onGround) { player.vy = 4.6; player.onGround = false; }
    moveFighter(match, player, input.mx, input.mz, dt);
    // semi-auto weapons fire only on the click edge; autos fire while held
    const pw = currentWeapon(player);
    if (input.firing && pw && (pw.auto || input.fireEdge)) fireWeapon(match, player);
    if (input.reload) startReload(player);
    if (input.throwGrenade) throwGrenade(match, player);
    if (input.switchSlot) switchSlot(player, input.switchSlot);
    if (input.cycleGrenade) {
      const order = ['frag', 'flash', 'smoke'];
      const i = order.indexOf(player.grenadeType);
      player.grenadeType = order[(i + 1) % 3];
    }
    // plant / defuse: hold E near the objective
    updateObjectiveHold(match, player, input.holdE, dt);
  }
  // bots play the round
  stepBots(match, dt);
  // per-fighter upkeep: reload timers, fire cooldowns, bomb pickup handled above
  for (const f of match.fighters) {
    if (!f.alive) continue;
    if (f.fireCooldown > 0) f.fireCooldown -= dt;
    if (f.reloading > 0) {
      f.reloading -= dt;
      if (f.reloading <= 0) {
        const w = currentWeapon(f);
        if (w) {
          const need = w.mag - f.mag, take = Math.min(need, f.reserve);
          f.mag += take; f.reserve -= take;
        }
        f.reloading = 0;
      }
    }
  }
  updateGrenades(match, dt);
  updateBomb(match, dt);
  // round end checks
  const atkAlive = aliveCount(match, 'attack');
  const defAlive = aliveCount(match, 'defend');
  if (atkAlive === 0 && match.bomb.state !== 'planted') {
    endRound(match, 'defend', 'SQUAD WIPED — Dusk Wardens take the round');
  } else if (defAlive === 0 && match.bomb.state !== 'planted') {
    endRound(match, 'attack', 'SITE CLEARED — Solstice takes the round');
  } else if (defAlive === 0 && match.bomb.state === 'planted') {
    // defenders all dead and the spike is ticking: attackers win on detonation
    // (the bomb timer keeps running; nothing left to defuse it)
  } else if (match.phaseTime <= 0) {
    if (match.bomb.state === 'planted') {
      // timer ran out while planted: the bomb still decides it
    } else {
      endRound(match, 'defend', 'TIME EXPIRED — spike never went down');
    }
  }
}

// Hold E near the objective: attackers plant (3s), defenders defuse (5s).
function updateObjectiveHold(match, f, holding, dt) {
  const b = match.bomb;
  if (f.team === 'attack' && f.hasBomb && b.state === 'carried') {
    const site = siteAt(f.x, f.z);
    if (site && holding) {
      f.plantProgress += dt;
      if (f.plantProgress >= PLANT_SECONDS) {
        b.state = 'planted'; b.site = site; b.timer = BOMB_SECONDS;
        b.x = f.x; b.z = f.z; b.planter = f;
        f.hasBomb = false; f.plantProgress = 0;
        match.events.push(`SPIKE PLANTED at site ${site} — 35 seconds!`);
      }
    } else f.plantProgress = 0;
  } else if (f.team === 'defend' && b.state === 'planted') {
    if (Math.hypot(f.x - b.x, f.z - b.z) < 2.2 && holding) {
      f.defuseProgress += dt;
      if (f.defuseProgress >= DEFUSE_SECONDS) {
        b.state = 'defused'; f.defuseProgress = 0;
        endRound(match, 'defend', 'SPIKE DEFUSED — Dusk Wardens hold the yard');
      }
    } else f.defuseProgress = 0;
  }
}
