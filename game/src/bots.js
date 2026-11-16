// bots.js — bot AI. One job: make 8 bots play the round like teammates.
// States: route (follow waypoints) → hold (scan) → engage (shoot) → plant /
// defuse / retake / investigate (sound). Stuck recovery: a bot that moves
// ≤0.5 m in 1.5 sim-seconds sidesteps ~2.5 m perpendicular and retries.
// Bots never import three.js or the DOM; they read the match and write intent.

import { MAP, circleHitsWall, losBlocked, smokeBlocks } from './map.js';
import { moveFighter, fireWeapon, currentWeapon, switchSlot } from './sim.js';
import { PLAYER_RADIUS, PLANT_SECONDS, DEFUSE_SECONDS } from './state.js';

const SIGHT_RANGE = 28; // spawn-to-spawn is ~36 m: bots must travel before they see anyone
const HEAR_RANGE = 40;

// Assign routes once per round. Attackers split 2+2 across the sites;
// defenders hold the sites and mid. Called from stepBots on round start.
function assignRoutes(match) {
  const atk = match.fighters.filter((f) => f.isBot && f.team === 'attack');
  const def = match.fighters.filter((f) => f.isBot && f.team === 'defend');
  const atkRoutes = ['toA_west', 'toB_east', 'toA_mid', 'toB_mid'];
  atk.forEach((b, i) => {
    const key = atkRoutes[i % atkRoutes.length];
    b.route = MAP.routes[key].map((id) => MAP.waypoints[id]);
    b.routeIndex = 0;
    b.assignedSite = key.includes('toA') ? 'A' : 'B';
    b.state = 'route';
  });
  // defenders WALK to their hold spots on safe waypoint routes (never a
  // straight line through a collider), then hold and scan. Every hold is
  // >10 m from its defender's spawn, so the displacement check passes.
  const defRoutes = [
    ['C3', 'W4', 'DA'],   // def0 (-8,-18) -> site A, down the panel gap
    ['C4', 'DBa', 'DB'],  // def1 (-4,-18) -> site B, around the pedestal
    ['C3', 'DM'],         // def2 (0,-18)  -> mid hold
    ['C3', 'DW'],         // def3 (4,-18)  -> west hold
  ];
  const holds = ['DA', 'DB', 'DM', 'DW'];
  def.forEach((b, i) => {
    b.home = MAP.waypoints[holds[i % holds.length]];
    b.route = defRoutes[i % defRoutes.length].map((id) => MAP.waypoints[id]);
    b.routeIndex = 0;
    b.state = 'route';
    b.holdUntil = match.time + 6 + i * 2;
  });
}

// Convert a desired world-space direction into local (mx, mz) for moveFighter.
function localMove(f, dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len, nz = dz / len;
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  const mz = -sin * nx - cos * nz; // forward component
  const mx = cos * nx - sin * nz;  // right component
  return { mx, mz };
}

function angleTo(f, x, z) {
  return Math.atan2(-(x - f.x), -(z - f.z));
}
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Can this bot see that fighter? Range, facing, line of sight, smoke, flash.
function canSee(match, bot, target) {
  if (!target.alive) return false;
  const d = Math.hypot(target.x - bot.x, target.z - bot.z);
  if (d > SIGHT_RANGE) return false;
  const yawTo = angleTo(bot, target.x, target.z);
  if (Math.abs(angleDiff(yawTo, bot.yaw)) > 1.1 && d > 6) return false; // ~126° cone
  const eyeY = 1.55;
  if (losBlocked(bot.x, eyeY, bot.z, target.x, 1.3, target.z)) return false;
  if (smokeBlocks(bot.x, eyeY, bot.z, target.x, 1.3, target.z, match.smokes)) return false;
  if (bot.flashUntil > match.time) return false;
  return true;
}

function nearestVisibleEnemy(match, bot) {
  let best = null, bestD = Infinity;
  for (const f of match.fighters) {
    if (!f.alive || f.team === bot.team) continue;
    if (!canSee(match, bot, f)) continue;
    const d = Math.hypot(f.x - bot.x, f.z - bot.z);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

// Step one bot for one tick.
function stepBot(match, b, dt) {
  if (!b.alive) return;
  if (b.flashUntil > match.time) { moveFighter(match, b, 0, 0, dt); return; } // blind: stand still
  const now = match.time;

  // --- target acquisition (with a reaction delay on first sight) ----------
  const seen = nearestVisibleEnemy(match, b);
  if (seen && b.target !== seen) { b.target = seen; b.reactUntil = now + 0.35 + Math.random() * 0.3; }
  if (!seen) b.target = null;

  // --- bomb duties override everything --------------------------------------
  const bomb = match.bomb;
  if (b.team === 'attack' && b.hasBomb && bomb.state === 'carried') {
    const site = MAP.sites[b.assignedSite];
    if (Math.hypot(b.x - site.x, b.z - site.z) < site.r) {
      // on site: stop and plant (3 s channel)
      b.state = 'plant';
      b.plantProgress += dt;
      moveFighter(match, b, 0, 0, dt);
      if (b.plantProgress >= PLANT_SECONDS) {
        bomb.state = 'planted'; bomb.site = b.assignedSite; bomb.timer = 35;
        bomb.x = b.x; bomb.z = b.z; bomb.planter = b;
        b.hasBomb = false; b.plantProgress = 0;
        match.events.push(`SPIKE PLANTED at site ${b.assignedSite} — 35 seconds!`);
        b.state = 'hold';
      }
      return;
    }
  }
  if (b.team === 'defend' && bomb.state === 'planted') {
    if (Math.hypot(b.x - bomb.x, b.z - bomb.z) < 2.2) {
      b.state = 'defuse';
      b.defuseProgress += dt;
      moveFighter(match, b, 0, 0, dt);
      if (b.defuseProgress >= DEFUSE_SECONDS) {
        bomb.state = 'defused'; b.defuseProgress = 0;
        match.events.push('SPIKE DEFUSED — Dusk Wardens hold the yard');
        // endRound is called by sim via the bomb state change; record it here
        b.state = 'hold';
      }
      return;
    }
    // retake: route to the planted site
    if (b.state !== 'retake') {
      b.state = 'retake';
      const key = bomb.site === 'A' ? 'retakeA' : 'retakeB';
      b.route = MAP.routes[key].map((id) => MAP.waypoints[id]);
      b.routeIndex = 0;
    }
  }

  // --- engage: a visible enemy CLOSE enough to duel -------------------------
  // A far target (>16 m) does not stop the push: bots keep routing to the
  // objective and only stop to fight at close range. Otherwise both teams
  // stall in spawn-to-spawn potshots and nobody ever displaces.
  const tDist = b.target ? Math.hypot(b.target.x - b.x, b.target.z - b.z) : Infinity;
  if (b.target && tDist <= 16) {
    const t = b.target;
    const wantYaw = angleTo(b, t.x, t.z);
    const wantPitch = Math.atan2(1.3 - 1.55, Math.hypot(t.x - b.x, t.z - b.z));
    // turn toward the target at a limited rate (bots are not aimbots)
    const turn = 3.2 * dt;
    const dy = angleDiff(wantYaw, b.yaw);
    b.yaw += Math.max(-turn, Math.min(turn, dy));
    b.pitch += Math.max(-turn, Math.min(turn, wantPitch - b.pitch));
    // strafe a little while shooting so the fight moves
    const strafe = Math.sin(now * 0.9 + b.id.charCodeAt(3)) > 0 ? 0.5 : -0.5;
    // advance slowly while shooting: a fight that stands still at spawn is a bug
    moveFighter(match, b, strafe * 0.4, 0.45, dt);
    // fire in bursts once the reaction delay has passed and the aim is close
    if (now >= (b.reactUntil || 0) && Math.abs(angleDiff(wantYaw, b.yaw)) < 0.12) {
      const w = currentWeapon(b);
      if (w && b.mag > 0 && b.fireCooldown <= 0) {
        // bots are inaccurate: add a random aim error so the player can win
        const err = (Math.random() - 0.5) * 0.09;
        const saveYaw = b.yaw, savePitch = b.pitch;
        b.yaw += err; b.pitch += (Math.random() - 0.5) * 0.05;
        fireWeapon(match, b);
        b.yaw = saveYaw; b.pitch = savePitch;
        // burst discipline: pause after a few shots
        b.burst = (b.burst || 0) + 1;
        if (b.burst >= 4 + Math.floor(Math.random() * 3)) { b.burst = 0; b.fireCooldown = Math.max(b.fireCooldown, 0.55); }
      } else if (w && b.mag <= 0) {
        // reload when empty
        if (b.reloading <= 0) { b.reloading = w.reload; }
      }
    }
    return;
  }

  // --- no enemy: follow the route / hold / investigate -----------------------
  if (b.state === 'hold') {
    // a defender pushed off its post walks back home (via the route follower,
    // whose stuck recovery handles any corner it clips)
    if (b.home && Math.hypot(b.home[0] - b.x, b.home[1] - b.z) > 1.5) {
      b.route = [b.home]; b.routeIndex = 0; b.state = 'route';
    }
    // hold position, slowly scan the lane
    b.yaw += Math.sin(now * 0.4 + b.id.charCodeAt(3)) * 0.3 * dt;
    moveFighter(match, b, 0, 0, dt);
    // a heard gunshot pulls defenders toward the sound for a look
    if (b.team === 'defend' && now - b.lastHeardAt < 1.2 && now > (b.holdUntil || 0)) {
      b.state = 'investigate';
      b.route = [[b.lastHeardX, b.lastHeardZ]];
      b.routeIndex = 0;
    }
    return;
  }
  // route / retake / investigate: walk the waypoints
  const route = b.route;
  if (!route || route.length === 0) { b.state = 'hold'; return; }
  const wp = route[Math.min(b.routeIndex, route.length - 1)];
  const dx = wp[0] - b.x, dz = wp[1] - b.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.2) {
    b.routeIndex += 1;
    if (b.routeIndex >= route.length) {
      if (b.state === 'investigate') { b.state = 'hold'; b.holdUntil = now + 4; }
      else if (b.state === 'retake') { b.state = 'hold'; }
      else { b.state = 'hold'; b.holdUntil = now + 5; }
      return;
    }
  }
  // face where we are going and walk
  const wantYaw = angleTo(b, wp[0], wp[1]);
  const turn = 4 * dt;
  b.yaw += Math.max(-turn, Math.min(turn, angleDiff(wantYaw, b.yaw)));
  const beforeX = b.x, beforeZ = b.z;
  const mv = localMove(b, dx, dz);
  moveFighter(match, b, mv.mx, mv.mz, dt);
  // --- stuck recovery: ≤0.5 m in 1.5 s while pathing -----------------------
  const moved = Math.hypot(b.x - beforeX, b.z - beforeZ);
  if (moved < 0.04) {
    if (!b.stuckSince) b.stuckSince = now;
    if (now - b.stuckSince > 1.2) {
      // sidestep ~2.5 m perpendicular to the blocked direction, alternate sides
      b.stuckSide *= -1;
      const px = -dz / (dist || 1) * 2.5 * b.stuckSide;
      const pz = dx / (dist || 1) * 2.5 * b.stuckSide;
      const sx = b.x + px, sz = b.z + pz;
      if (!circleHitsWall(sx, sz, PLAYER_RADIUS + 0.1)) {
        b.route.splice(b.routeIndex, 0, [sx, sz]);
      }
      b.stuckSince = 0;
    }
  } else b.stuckSince = 0;
}

export function stepBots(match, dt) {
  if (match._routesAssigned !== match.round) {
    assignRoutes(match);
    match._routesAssigned = match.round;
  }
  for (const f of match.fighters) {
    if (!f.isBot) continue;
    stepBot(match, f, dt);
  }
}
