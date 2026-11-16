// ui.js — the DOM, the input, and the pointer-lock contract.
// One job: turn keys/mouse into the player's intent, and turn match state
// into the HUD, the buy menu, the banners and the spectate view.
// The two hard bugs live here: pointer-lock fallback (§4.1) and the Esc
// resume guard (§4.2). Both are verified by the playtests in main.js.

import { WEAPONS, GRENADES, KEVLAR_PRICE } from './state.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(match, audio, onPlay) {
    this.match = match;
    this.audio = audio;
    this.onPlay = onPlay;           // called when the player clicks Play/Resume
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.firing = false;            // mouse held
    this.fireEdge = false;          // click edge (for semi-auto weapons)
    this.yaw = 0; this.pitch = 0;   // the player's view angles: north, toward the enemy
    this.locked = false;
    this.lockMode = 'none';         // 'locked' | 'free' | 'none'
    this.lockFailed = false;
    this.lastResumeAt = 0;          // Esc guard: suppress re-show for 1 s
    this.wasLocked = false;
    this.spectateIndex = 0;
    this.buyOpen = false;
    this._edges = new Set();        // one-tick edge triggers
    this._feed = [];
  }

  bind(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mouseup', () => { this.firing = false; });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => this.onLockError());
    document.addEventListener('wheel', (e) => {
      if (this.buyOpen) return;
      this._edges.add(e.deltaY > 0 ? 'wheelDown' : 'wheelUp');
    }, { passive: true });
    $('play').addEventListener('click', () => this.playClicked());
    $('resume').addEventListener('click', () => this.resumeClicked());
    $('buy-close').addEventListener('click', () => this.toggleBuy(false));
    this.buildBuyMenu();
  }

  // --- pointer lock ----------------------------------------------------------
  // NEVER gate mouse look or firing on pointer lock alone. Three failure
  // modes, one fallback: a throwing requestPointerLock, a rejected lock
  // promise, and the pointerlockerror event. Any of them switches to
  // free-cursor aiming at the same sensitivity, with a persistent hint.
  requestLock() {
    const el = this.canvas;
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => this.useFreeCursor('promise rejected'));
      }
    } catch (err) {
      this.useFreeCursor('request threw');
    }
  }
  onLockChange() {
    const nowLocked = document.pointerLockElement === this.canvas;
    const was = this.locked;
    this.locked = nowLocked;
    if (nowLocked) { this.lockMode = 'locked'; $('lockhint').hidden = true; }
    else if (was) {
      // a genuine locked → unlocked transition: Esc (or a click out).
      // Show the pause screen ONLY here, and never inside the resume guard
      // window, and never while the player is dead.
      const player = this.match.fighters[0];
      const now = performance.now();
      if (player && player.alive && now - this.lastResumeAt > 1000) {
        this.showPause(true);
      }
      if (this.lockMode === 'locked') this.lockMode = 'none';
    }
    this.wasLocked = nowLocked;
  }
  onLockError() { this.useFreeCursor('pointerlockerror'); }
  useFreeCursor(why) {
    this.lockFailed = true;
    this.lockMode = 'free';
    this.locked = false;
    $('lockhint').hidden = false;
  }
  playClicked() {
    this.audio.unlock();
    $('start').hidden = true;
    this.requestLock();
    if (this.onPlay) this.onPlay();
  }
  resumeClicked() {
    // A resume click must never fire a shot or cycle the spectate target.
    this._edges.delete('fire');
    this.firing = false;
    this.lastResumeAt = performance.now();
    this.showPause(false);
    this.requestLock();
    if (this.onPlay) this.onPlay();
  }
  showPause(show) {
    $('pause').hidden = !show;
    if (show) this.toggleBuy(false);
  }

  // --- input ------------------------------------------------------------------
  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    // Esc: in free-cursor mode there is no lock to exit, so Esc itself pauses.
    // Ignore auto-repeat (holding Esc repeats keydown and would re-show pause).
    if (e.code === 'Escape') {
      if (e.repeat) return;
      if (this.lockMode !== 'locked') {
        const player = this.match.fighters[0];
        const now = performance.now();
        if (player && player.alive && now - this.lastResumeAt > 1000 && $('start').hidden) {
          this.showPause(true);
        }
      }
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'KeyR') this._edges.add('reload');
    if (e.code === 'KeyG') this._edges.add('throwGrenade');
    if (e.code === 'KeyF') this._edges.add('cycleGrenade');
    if (e.code === 'Digit1') this._edges.add('slot1');
    if (e.code === 'Digit2') this._edges.add('slot2');
    if (e.code === 'Digit3') this._edges.add('slot3');
    if (e.code === 'Digit4') this._edges.add('slot4');
    if (e.code === 'KeyQ') this._edges.add('slotQ');
    if (e.code === 'KeyB') this._edges.add('toggleBuy');
    if (e.code === 'Space') { this._edges.add('jump'); e.preventDefault(); }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
  }
  onMouseMove(e) {
    // In locked mode the browser gives movementX/Y. In free-cursor mode the
    // same fields work (no lock needed); if they are 0, fall back to the
    // absolute position delta so the view still turns.
    if (this.lockMode === 'none' && $('start').hidden === false) return;
    if (this.lockMode === 'none') return; // not playing yet
    let dx = e.movementX || 0, dy = e.movementY || 0;
    if (this.lockMode === 'free' && dx === 0 && dy === 0 && this._lastMX !== undefined) {
      dx = e.clientX - this._lastMX; dy = e.clientY - this._lastMY;
    }
    this._lastMX = e.clientX; this._lastMY = e.clientY;
    this.mouseDX += dx; this.mouseDY += dy;
  }
  onMouseDown(e) {
    if (e.button !== 0) return;
    // Clicks on overlay buttons are not shots.
    if (e.target && e.target.closest && e.target.closest('button, .overlay, .buy-item')) return;
    if (!$('start').hidden || !$('pause').hidden) return;
    if (this.buyOpen) return;
    this.firing = true;
    this.fireEdge = true;
    // In free-cursor mode a click also (re)arms looking; nothing else needed.
  }

  // Build the player's intent for one sim tick. Called by main.js every tick.
  // Edge triggers are consumed here (one tick each).
  getInput() {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    // mouse look: same sensitivity locked or free
    const sens = 0.0023;
    this.yaw -= this.mouseDX * sens;
    this.pitch -= this.mouseDY * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.mouseDX = 0; this.mouseDY = 0;
    const e = this._edges;
    let slot = 0;
    if (e.has('slot1')) slot = 1;
    else if (e.has('slot2')) slot = 2;
    else if (e.has('slot3')) slot = 3;
    else if (e.has('slot4')) slot = 4;
    else if (e.has('slotQ')) slot = -1;
    else if (e.has('wheelDown')) slot = -2;
    else if (e.has('wheelUp')) slot = -3;
    if (e.has('toggleBuy')) this.toggleBuy();
    const input = {
      mx, mz, yaw: this.yaw, pitch: this.pitch,
      firing: this.firing, fireEdge: this.fireEdge,
      reload: e.has('reload'),
      throwGrenade: e.has('throwGrenade'),
      cycleGrenade: e.has('cycleGrenade'),
      switchSlot: slot,
      holdE: k.has('KeyE'),
      crouch: k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC'),
      jump: e.has('jump'),
    };
    this._edges.clear();
    this.fireEdge = false;
    return input;
  }

  // --- buy menu ---------------------------------------------------------------
  buildBuyMenu() {
    const grid = $('buy-grid');
    grid.innerHTML = '';
    const items = [];
    for (const id of ['vk47', 'hornet', 'longshot', 'breacher']) {
      const w = WEAPONS[id];
      items.push({ kind: 'weapon', id, name: w.name, desc: w.desc, price: w.price });
    }
    for (const id of ['frag', 'flash', 'smoke']) {
      const g = GRENADES[id];
      items.push({ kind: 'grenade', id, name: g.name, desc: g.desc, price: g.price });
    }
    items.push({ kind: 'kevlar', id: 'kevlar', name: 'Kevlar Vest', desc: 'Absorbs 40% of bullet damage. Survive one more duel.', price: KEVLAR_PRICE });
    for (const it of items) {
      const div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.kind = it.kind; div.dataset.id = it.id;
      div.innerHTML = `<div class="nm">${it.name}</div><div class="ds">${it.desc}</div><div class="pr">$${it.price}</div>`;
      div.addEventListener('click', () => this.buyItem(it));
      grid.appendChild(div);
    }
  }
  toggleBuy(force) {
    const want = force !== undefined ? force : !this.buyOpen;
    if (want === this.buyOpen) return;
    this.buyOpen = want;
    $('buy').hidden = !want;
    if (want) this.refreshBuyMenu();
  }
  refreshBuyMenu() {
    const m = this.match;
    const buyingOpen = m.phase === 'buy';
    $('buy-note').hidden = buyingOpen;
    $('buy-money').textContent = '$' + m.money;
    const player = m.fighters[0];
    document.querySelectorAll('.buy-item').forEach((el) => {
      const kind = el.dataset.kind, id = el.dataset.id;
      let owned = false;
      if (kind === 'weapon') owned = player.weapons.primary === id;
      if (kind === 'kevlar') owned = player.kevlar;
      el.classList.toggle('owned', owned);
      el.classList.toggle('cant', !buyingOpen || (m.money < parseInt(el.querySelector('.pr').textContent.slice(1), 10) && !owned));
    });
  }
  buyItem(it) {
    const m = this.match;
    const player = m.fighters[0];
    if (m.phase !== 'buy') { this.audio.denied(); return; } // purchases re-check the phase
    if (m.money < it.price) { this.audio.denied(); return; }
    if (it.kind === 'weapon') {
      if (player.weapons.primary === it.id) return;
      m.money -= it.price;
      player.weapons.primary = it.id;
      player.slot = 1;
      // equip it now (sim.equipWeapon is called by main via this hook)
      if (this.onBuyWeapon) this.onBuyWeapon(it.id);
    } else if (it.kind === 'grenade') {
      m.money -= it.price;
      player.weapons.grenades[it.id] += 1;
    } else if (it.kind === 'kevlar') {
      if (player.kevlar) return;
      m.money -= it.price;
      player.kevlar = true;
    }
    this.audio.buy();
    this.refreshBuyMenu();
  }

  // --- HUD ----------------------------------------------------------------------
  pushEvent(text) {
    this._feed.unshift(text);
    if (this._feed.length > 4) this._feed.pop();
    $('feed').innerHTML = this._feed.map((t) => `<div>${t}</div>`).join('');
  }
  showHitmarker(head) {
    const h = $('hitmarker');
    h.classList.add('on');
    h.style.background = '';
    setTimeout(() => h.classList.remove('on'), 90);
  }
  showBanner(win, sub) {
    const b = $('banner');
    $('banner-big').textContent = win ? 'ROUND WON' : 'ROUND LOST';
    $('banner-big').className = 'big ' + (win ? 'win' : 'lose');
    $('banner-sub').textContent = sub || '';
    b.hidden = false;
  }
  hideBanner() { $('banner').hidden = true; }
  updateHUD() {
    const m = this.match;
    const player = m.fighters[0];
    const mm = Math.max(0, Math.floor(m.phaseTime / 60));
    const ss = Math.max(0, Math.floor(m.phaseTime % 60)).toString().padStart(2, '0');
    $('timer').textContent = `${mm}:${ss}`;
    $('timer').style.color = m.bomb.state === 'planted' ? '#ff5d5d' : '#ffb02e';
    $('round-label').textContent = `ROUND ${Math.min(m.round, 9)}/9`;
    $('score-atk').textContent = m.scoreAtk;
    $('score-def').textContent = m.scoreDef;
    $('phase-label').textContent = m.phase === 'buy' ? 'BUY' : m.phase === 'live' ? 'LIVE' : m.phase === 'ended' ? 'ROUND END' : 'MATCH OVER';
    $('alive-atk').textContent = m.fighters.filter((f) => f.alive && f.team === 'attack').length;
    $('alive-def').textContent = m.fighters.filter((f) => f.alive && f.team === 'defend').length;
    $('health').textContent = Math.max(0, Math.ceil(player.hp));
    $('health').classList.toggle('low', player.hp <= 30);
    $('money').textContent = '$' + m.money;
    $('armor').textContent = player.kevlar ? '🛡 KEVLAR' : '';
    // ammo: current weapon (or grenade count on slot 3)
    if (player.slot === 3) {
      $('ammo-name').textContent = GRENADES[player.grenadeType].name;
      $('ammo-mag').textContent = player.weapons.grenades[player.grenadeType];
      $('ammo-reserve').textContent = '';
    } else {
      const w = player.slot === 1 ? WEAPONS[player.weapons.primary] : WEAPONS[player.weapons.secondary];
      $('ammo-name').textContent = w ? w.name : '—';
      $('ammo-mag').textContent = player.reloading > 0 ? '––' : player.mag;
      $('ammo-reserve').textContent = '/ ' + player.reserve;
    }
    // objective line
    const obj = $('objective');
    const b = m.bomb;
    if (b.state === 'planted') {
      obj.hidden = false;
      obj.innerHTML = `<span class="bomb">SPIKE PLANTED — SITE ${b.site} — ${Math.ceil(b.timer)}s</span>`;
    } else if (b.state === 'dropped') {
      obj.hidden = false;
      obj.textContent = 'SPIKE DROPPED — pick it up';
    } else if (player.hasBomb) {
      obj.hidden = false;
      obj.textContent = 'YOU HAVE THE SPIKE — plant at A (solar) or B (dish), hold E';
    } else if (b.state === 'carried') {
      obj.hidden = false;
      obj.textContent = 'Escort the spike carrier — plant at A or B';
    } else obj.hidden = true;
    // spectate line
    const spec = $('spectate');
    if (!player.alive && m.phase === 'live') {
      const t = this.spectateTarget();
      spec.hidden = false;
      spec.textContent = t ? `SPECTATING ${t.name} — click / Q to cycle` : 'SPECTATING';
    } else spec.hidden = true;
    // keep the buy menu honest when the phase flips under it
    if (this.buyOpen) this.refreshBuyMenu();
  }
  spectateTarget() {
    const mates = this.match.fighters.filter((f) => f.alive && f.team === 'attack' && f.id !== 'player');
    if (mates.length === 0) return null;
    this.spectateIndex = ((this.spectateIndex % mates.length) + mates.length) % mates.length;
    return mates[this.spectateIndex];
  }
  cycleSpectate() {
    this.spectateIndex += 1;
  }
}
