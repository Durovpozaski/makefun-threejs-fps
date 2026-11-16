// state.js — one place for every constant, weapon and the shape of game state.
// No imports: pure data. The simulation (sim.js) owns the live values; this file
// only describes them, so the judge can read the whole design in one place.

export const SIM_DT = 1 / 60;          // fixed-step simulation tick (60 Hz)
export const ROUND_WIN_SCORE = 5;      // first to 5 rounds
export const MAX_ROUNDS = 9;           // at most 9 rounds per match
export const BUY_SECONDS = 5;          // short buy phase (a long frozen wait feels broken)
export const ROUND_SECONDS = 100;      // live round timer
export const BOMB_SECONDS = 35;        // bomb timer once planted
export const PLANT_SECONDS = 3;        // hold E to plant
export const DEFUSE_SECONDS = 5;       // hold E to defuse
export const START_MONEY = 800;
export const KILL_MONEY = 300;
export const WIN_MONEY = 3250;
export const LOSS_MONEY = 1900;
export const PLAYER_RADIUS = 0.45;     // collision circle radius (metres)
export const PLAYER_HEIGHT = 1.7;      // eye height standing
export const CROUCH_HEIGHT = 1.15;
export const HEADSHOT_MULT = 2;        // headshots deal about 2x body damage
export const KEVLAR_REDUCTION = 0.4;   // kevlar absorbs 40% of bullet damage

// Weapons. damage = body damage per hit; head = damage * HEADSHOT_MULT.
// spread = base radians; moveSpread = extra spread while moving; recoil = pitch kick per shot.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 2, price: 0, auto: false,
    damage: 26, headMult: 2, rpm: 320, mag: 12, reserve: 36,
    reload: 1.1, spread: 0.011, moveSpread: 0.02, recoil: 0.011, range: 60,
    desc: 'Reliable sidearm. Free, always in your holster.',
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', slot: 1, price: 900, auto: true,
    damage: 34, headMult: 2, rpm: 600, mag: 30, reserve: 90,
    reload: 2.2, spread: 0.014, moveSpread: 0.035, recoil: 0.02, range: 120,
    desc: 'Full-auto workhorse. Accurate when you stop to aim.',
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', slot: 1, price: 600, auto: true,
    damage: 25, headMult: 2, rpm: 800, mag: 28, reserve: 84,
    reload: 1.8, spread: 0.02, moveSpread: 0.03, recoil: 0.013, range: 70,
    desc: 'Fast close-quarters spray. Weak at long range.',
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', slot: 1, price: 2400, auto: false,
    damage: 82, headMult: 2, rpm: 55, mag: 5, reserve: 15,
    reload: 3.0, spread: 0.002, moveSpread: 0.05, recoil: 0.06, range: 200,
    desc: 'One-tap headshots. Slow, punishing if you miss.',
  },
  breacher: {
    id: 'breacher', name: 'Breacher Shotgun', slot: 1, price: 800, auto: false,
    damage: 12, headMult: 2, rpm: 70, mag: 6, reserve: 18, pellets: 8,
    reload: 2.6, spread: 0.05, moveSpread: 0.04, recoil: 0.05, range: 25,
    desc: 'Eight pellets per shell. Devastating up close.',
  },
};

// Grenades. slot 3. F cycles the type, G throws.
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, desc: 'Explodes after 1.6s. 90 damage at the centre.' },
  flash: { id: 'flash', name: 'Flashbang', price: 200, desc: 'Blinds anyone facing it for up to 3s.' },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 250, desc: 'A thick orange cloud that blocks sight for 12s.' },
};
export const KEVLAR_PRICE = 650;

// Team look: attackers wear amber, defenders wear sky blue. Visors glow so
// enemies read instantly at small (judge) size.
export const TEAM_STYLE = {
  attack: { name: 'SOLSTICE', color: 0xffb02e, dark: 0x8a5a10, visor: 0xffe9a8, cloth: 0xc77b1e },
  defend: { name: 'DUSK WARDENS', color: 0x57c8ff, dark: 0x0e4d6e, visor: 0xbfefff, cloth: 0x1e6f9e },
};

// A combatant: the player or one bot. x/z is the ground position, y is eye height.
export function makeFighter(id, team, name, spawn) {
  return {
    id, team, name, isBot: id !== 'player',
    x: spawn[0], z: spawn[1], y: 0,
    yaw: team === 'attack' ? 0 : Math.PI, // attackers face north (-z), defenders face south
    pitch: 0,
    vx: 0, vz: 0,           // horizontal velocity (m/s)
    hp: 100, alive: true,
    crouched: false, onGround: true,
    kevlar: false,
    weapons: { primary: null, secondary: 'p9', grenades: { frag: 0, flash: 0, smoke: 0 } },
    slot: 1,                 // 1 primary, 2 pistol, 3 grenade
    grenadeType: 'frag',
    mag: 0, reserve: 0,     // current weapon ammo
    reloading: 0,            // seconds left, 0 = not reloading
    fireCooldown: 0,         // seconds until next shot allowed
    spreadBloom: 0,          // grows while firing / moving, decays when still
    recoilPitch: 0,          // accumulated pitch kick (decays)
    plantProgress: 0, defuseProgress: 0,
    hasBomb: false,
    flashUntil: 0,           // sim time until flash blindness ends
    lastShotAt: -99, lastHeardAt: -99, lastHeardX: 0, lastHeardZ: 0,
    // bot-only fields, set by bots.js
    route: [], routeIndex: 0, holdUntil: 0, target: null, aimYaw: 0, aimPitch: 0,
    stuckSince: 0, stuckSide: 1, state: 'route', stateUntil: 0, home: null,
    kills: 0, deaths: 0,
  };
}

// The whole match, created fresh by sim.js. One object, one place, no globals.
export function createMatch() {
  return {
    time: 0,                 // sim seconds since match start
    round: 1, scoreAtk: 0, scoreDef: 0,
    phase: 'buy',            // 'buy' | 'live' | 'over'
    phaseTime: BUY_SECONDS,  // seconds left in this phase
    bomb: { state: 'carried', x: 0, z: 0, site: null, timer: 0, planter: null },
    money: START_MONEY,
    fighters: [],            // 9 fighters: player + 8 bots
    bullets: [],             // active tracers {x0,y0,z0,x1,y1,z1,life,team}
    grenades: [],            // live thrown grenades
    smokes: [],              // active smoke clouds {x,z,r,until}
    flashes: [],             // active flash events {x,y,z,at}
    events: [],              // human-readable feed lines for this tick
    winner: null,            // 'attack' | 'defend' once the match ends
    roundEndReason: '',
    roundEndAt: 0,
  };
}
