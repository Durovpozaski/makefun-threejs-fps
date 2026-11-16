# SOLSTICE YARD — a bright tactical 5v5 FPS

A round-based tactical first-person shooter in three.js, built for the
make.fun competition `threejs-fps-02` ("Make the best three.js tactical FPS").

Five attackers storm a sunset-desert solar relay station; five defenders hold
two bomb sites (A: solar array, B: relay dish). First to 5 rounds wins.
Plant the spike, or wipe the other team.

## Play it

Serve `game/` with any static file server and open `index.html` in desktop
Chrome:

```
node serve.ts
# open http://localhost:8080
```

No build step, no network requests — three.js 0.187.0 is vendored under
`game/vendor/three/`, and every sound is generated in code with WebAudio.

## What is in the game

- 5v5 rounds: buy phase (5s) → live round → ROUND WON/LOST banner → next
  round. First to 5, max 9 rounds.
- Gunplay: 5 weapons (VK-47 rifle, Hornet SMG, Longshot DMR, Breacher
  shotgun, P9 sidearm), headshots deal 2× body damage, recoil and spread
  punish firing on the move, reload, running out of ammo.
- Tactics: bomb plant (3s) / defuse (5s), 35s bomb timer with speeding
  beeps, money per round (start $800, kill $300, win ~$3250, loss ~$1900),
  buy menu with weapons, 3 grenades (frag / flash / smoke) and kevlar.
- Bots that follow routes, hold positions, react to sight and sound, plant
  and defuse, and retake the site. Stuck recovery keeps them moving.
- A bright original map: three lanes, two sites, crates, containers, solar
  panels and a relay dish — readable at a glance in sunset light.
- Humanoid soldiers with bright visors and team colours; big bare hands gripping the rifle in first person
  gripping the weapon in first person, tracers, muzzle flash and smoke.
- Code-generated WebAudio: gunshots with distance falloff, reload, hit and
  headshot markers, bomb beeps, explosion, flashbang, round stingers, and a
  quiet desert-wind ambient loop.

## Layout

- `game/index.html` — the page, HUD, buy menu, banners, overlays
- `game/src/main.js` — boot and the fixed-step (60 Hz) loop
- `game/src/sim.js` — the simulation: movement, shooting, grenades, bomb, rounds
- `game/src/bots.js` — bot AI
- `game/src/map.js` — the SOLSTICE YARD layout, colliders, waypoints, meshes
- `game/src/render.js` — three.js scene, soldiers, hands, tracers, effects
- `game/src/audio.js` — WebAudio sound effects and ambience
- `game/src/ui.js` — input, pointer lock, buy menu, HUD, spectate
- `game/src/state.js` — constants, weapons, and the shape of game state
- `main.ts` — the entry program: copies the game and screenshots to
  `/output` and writes `dossier.json`

## License

MIT — see LICENSE.
