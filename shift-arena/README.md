# SHIFT — Switchyard

A browser FPS prototype set in a 120 × 120 metre industrial map, with solo practice and private 2–4 player free-for-all matches. Built with Babylon.js and Vite; all geometry, materials, map graphics, weapon models, and sounds are generated in code.

## Run locally

Requires Node.js 24. Run these commands from `shift-arena/`. Babylon.js is installed and bundled locally; the game engine does not require a CDN connection.

```sh
npm install
npm run dev
```

Open the printed localhost URL in a desktop browser with WebGL enabled. Choose a loadout and click **Play Solo** to capture the mouse. If an embedded preview blocks pointer lock, open the URL directly in a browser tab.

## Controls

- WASD: move
- Mouse: look; left button: fire (hold to repeat at the weapon’s firing rate)
- Right mouse button: hold to aim; the sniper uses a zoomed scope with reduced sensitivity
- Space: jump
- Shift: directional dash (forward if stationary)
- C: hold to slide with existing momentum, or crouch at low speed
- R: reload; ammunition reserves are unlimited
- Escape: pause and release the mouse

Dash, hold C, then jump to carry speed through the arena. Slides gradually slow down and allow gentle steering; repeatedly pressing C gives no free boost. Stairs up to 0.55 m are walkable in either direction, with a smoothed camera. Dash has an edge flash and launch sound, a ready chime, and recovery/recharge status in the HUD. Dash recharges faster while moving. Cyan pads launch you onto the side platforms. Orange targets respawn after 2.8 seconds. Free roam is untimed; Target Run is 60 seconds of active play. Pausing stops the timer. Settings include sensitivity, field of view, and sound.

## Project layout

- `src/main.js`: arena, rendering, weapon, input, practice modes, UI
- `src/physics.js`: fixed-step kinematic player simulation, collision, dash and jump pads
- `src/style.css`: lobby, HUD, and overlays
- `tests/physics.test.js`: collision and movement behavior checks

```sh
npm test
npm run build
```

The production bundle is generated in `dist/`. Solo practice targets do not attack. The Node server supports 2–4 player free-for-all matches with authoritative damage, deaths, and respawns. Basic collision uses axis-aligned boxes; stairs support automatic stepping with overhead clearance checks. The floor is solid and the arena has boundary walls. Google Fonts enhances typography, with system font fallbacks when unavailable.

## Four-player private rooms

`npm run dev` now starts the game and authoritative room server together on **port 5173**. Stop any older Vite process on this port first.

1. Open `http://localhost:5173` in up to four browser windows or on separate computers.
2. In the first, choose **Play with friends**, enter a name, select a loadout, and **Create private room**.
3. Copy the invite link into the other windows, or enter the room code and choose **Join**.
4. Click **Enter arena** in each window. The countdown starts with two entrants; additional players can join the running round.
5. Each opponent has a distinct slot colour, name label, and minimap marker. Escape pauses your controls; the match keeps running and you remain vulnerable. Return to lobby leaves the room.

To use multiple computers on the same Wi-Fi, run `npm run dev:lan` and open `http://<host-computer-LAN-IP>:5173` on each device. Create/copy the invite from that address, not localhost. A link using localhost only works on the computer hosting the server. When clipboard access is unavailable on an HTTP LAN address, the invite field can be copied manually. A room allows four connections; an empty room is deleted, and disconnecting frees a slot. Rejoin with the same code while anyone else remains connected. Restarting the server deletes all rooms.

### Multiplayer scope

This version synchronizes movement, facing, crouch/slide height, jumps, dash state, health, ammunition, reloads, kills, deaths, and respawns. Players can shoot each other but cannot physically block each other. Practice targets are hidden during a match. No matchmaking, accounts, persistent rooms, or automatic reconnection yet. A room code is an invitation secret, not an authenticated user identity.

The server runs the same collision and movement simulation as the client at 120 Hz, consumes at most one input frame per player per tick, and broadcasts at 20 Hz. Clients predict locally, replay unacknowledged inputs on authoritative snapshots, and interpolate every opponent about 100 ms behind incoming snapshots. Input edges are not repeated across missing packets. Invalid inputs, excessive queues, oversized messages, and inactive connections are bounded or rejected.

- `src/arena.js`: shared arena geometry and launch pads
- `src/network.js`: connection lifecycle, batching, reconciliation, and interpolation
- `server/rooms.js`: four-player rooms, input validation, authoritative simulation
- `server/index.js`: HTTP assets, WebSocket transport, Vite development middleware
- `tests/network.test.js`: actual two-client WebSocket tests and networking behavior
- `src/aim.js`: zoom, scope availability, and sensitivity policy
- `tests/aim.test.js`: aiming and scope reset conditions
- `src/combat.js`: weapon definitions, pellet spread, damage falloff, and ray/hitbox intersection
- `tests/combat.test.js`: damage, occlusion, weapon rules, rewind, and a two-client kill/respawn test

### Hosting

```sh
npm run build
npm start
```

`npm start` serves the production build and multiplayer on port 5173, listening on `0.0.0.0`. Set `PORT` to use the hosting provider's assigned port, or `HOST=127.0.0.1` to restrict access to this computer. Startup fails with a clear error if the production build is missing. For internet use, place this Node process behind HTTPS with WebSocket upgrades forwarded for `/room`; the browser uses the current origin, so no separate client endpoint configuration is needed. Rooms are in process memory: run one process until shared room routing is added.

See [the deployment guide](../DEPLOYMENT.md) for Docker, Railway setup, environment variables, and the four-player smoke check. `npm run smoke:production` verifies a local production build; `npm run smoke:online -- https://your-game-host` checks a deployed server.

The current Sites URL hosts static assets only. Solo practice works there; the room dialog reports that private rooms are unavailable on that host. Online multiplayer requires the persistent Node server above; a multiplayer backend has not been deployed to Sites.

## Weapons and combat

- Hold left mouse to fire; R reloads; hold Tab to view kills and deaths.
Choose your weapon in the solo menu or room dialog before joining. A room locks your loadout through respawns and rematches; leave the room to change it. Your selection is remembered locally.

| Weapon | Magazine | Body / head damage | Shot interval | Reload |
| --- | --- | --- | --- | --- |
| Assault rifle | 30 | 25 / 50 | 0.125 s | 1.25 s |
| Shotgun | 6 | 16 / 20 per pellet | 0.8 s | 2.2 s |
| Sniper | 5 | 90 / 150 | 1.1 s | 2.5 s |

The shotgun fires eight pellets per shell in a fixed cone, with damage falling off beyond 10 m and a maximum range of 28 m. Rifle range is 100 m; sniper range is 150 m. Hit accuracy counts triggers that hit, so shotgun accuracy cannot exceed 100%.

- Hold right mouse to aim. The sniper uses a 24° scope, the rifle 65° aiming, and the shotgun 70° aiming (never wider than the configured FOV). Mouse sensitivity scales with zoom. Release right mouse to leave aiming; pause, death, reload, and losing pointer lock clear it too.
- 100 health. Hitboxes shrink when crouching/sliding. A sniper headshot eliminates a full-health opponent; a body shot leaves 10 health.
- Unlimited reserve ammunition; empty magazines reload automatically. The server owns each weapon’s ammunition, cadence, reload, spread, range, and damage.
- Death disables movement and firing for 3 seconds, then respawns you at a spawn selected for distance and cover from every living opponent, with full health and ammo.
- Spawn protection lasts 1 second and ends immediately if you fire. Players waiting in the room lobby cannot be hit. Once you enter, pausing does not make you invulnerable.
- Local muzzle flash and sound respond immediately; hit markers, damage flashes, kills, ammunition, and scores come from the server.
- The server casts shots from the authoritative player position, checks solid arena cover, and rewinds target hitboxes by at most 200 ms to account for the interpolated view. A target's previous life cannot be hit after respawn.
- Scores reset at the beginning of each round. Finished results remain visible until the next round; leaving and rejoining starts a new player entry.

After updating server code, restart `npm run dev` and refresh all game windows. Existing rooms are cleared by a server restart.

## Match loop

- The first player can explore while waiting. Combat starts after at least two players enter and the three-second countdown completes.
- Each round lasts five minutes of server simulation time. Pausing does not stop the clock.
- Highest kills wins. Equal kills are a draw, regardless of deaths. Combat freezes when the round ends, and all players receive the same final standings.
- Choose **Request rematch** on the result screen. You return to the arena and wait until every entered player still in the room requests it. A new countdown then begins, with fresh health, ammunition, positions, and scores.
- A departure leaves the round running while at least two entered players remain. When only one remains, they win by forfeit. The countdown returns to waiting only if fewer than two entrants remain. Unentered lobby players do not hold up rematches or keep a match alive.
- `tests/rounds.test.js` covers timing, ties, score freezes, two-player rematch votes, full round reset, disconnects, and live WebSocket round transitions.

## Solo entry and pause behavior

**Play Solo** always leaves any joined/connecting room and launches the selected Free Roam or Target Run mode. Target Run is a 60-second target challenge; Free Roam is untimed movement/target practice. Solo has no bots and does not depend on the multiplayer server.

While paused in multiplayer, the arena and opponent view are hidden. Server snapshots still update the camera, including deaths and respawns. The pause dialog shows a respawn countdown, then allows resuming from the new spawn. Active deaths also hide the arena until respawn. Solo pause still freezes the local session.


## Shifting arena

Two eight-metre shutters control crossings through the central transfer spine. West starts open and east closed. Outer service routes remain available in either layout.

- Every 45 seconds, the open inner lane closes and the other opens. In multiplayer this timer starts when the round becomes active; it resets for every rematch.
- A five-second warning appears on the HUD. Both affected gates pulse amber, the minimap marks the routes, and a sound announces the warning and the completed shift. Mint means open; orange means closed.
- A gate waits if a living player occupies its marked clearance zone, including crouched, jumping, or paused players. The alternate lane still opens on time. The held gate closes once clear; the next 45-second interval begins after that closure. Gates never push or damage players.
- Closed shutters block movement, dashes, and all weapon pellets. The server uses the current gate layout when checking shots, including rewound target hitboxes.
- Both clients receive the same authoritative gate state. Prediction and input replay use those colliders; a layout change clears camera correction that could otherwise smooth through a closed gate.
- Solo uses the same transition and clearance rules. Pausing solo freezes its timer. Pausing multiplayer does not. Waiting rooms and finished rounds do not shift.

To test in **Free Roam**, watch the HUD count down: warning at 40 seconds, first swap at 45. Stand on the west gate’s floor marking during that swap to hold it open, then move clear. In multiplayer, enter with at least two players before starting the timer.

- `src/arena-shift.js`: shared schedule, safety checks, and gate geometry
- `src/gates-view.js`: shutter panels and warning lights
- `tests/arena-shift.test.js`: timing, clearance, collision, bullet cover, rendering state, rematch reset, room isolation, and live two-client synchronization


## Switchyard map (Build 0.8.0)

Switchyard replaces the 48 × 48 m Foundry with a new **120 × 120 m** layout: 14,400 m², or 6.25 times the original footprint. It retains four-player rooms and all three weapons.

- **Transfer spine:** an eight-metre barrier and central control tower separate the northern and southern yards. Gates at x = −24 and +24 control the direct crossings. The tower blocks a central spawn-to-spawn sightline.
- **Cargo yard:** staggered ochre containers create close-range pockets and broken sightlines on the west side.
- **Relay yard:** teal equipment housings and lower cover allow longer rifle/sniper angles on the east side. A 90 m sightline through the east gate disappears when the shutter closes.
- **Observation decks:** four 3.5 m platforms have walkable stairs, partial cover, and jump-pad access. They overlook the approaches while remaining below the shutters.
- **Permanent bypasses:** outer service passages stay open in both layouts. Ground navigation from 12 m south of either gate to 12 m north is 24 m with that gate open and 80 m with it closed. These are conservative grid path measurements; actual traversal time depends on movement.
- **Spawns and practice:** six safe spawn locations, four shielded corner pockets, and 16 practice targets distributed across ground and elevated areas. Solo starts in the southern depot.
- **Navigation:** updated minimap, coloured route markings, named sectors, gate signs, and the taller control tower help orientation. Fog and the lobby camera cover the larger footprint.

Map bounds, spawn points, targets, gate positions, and collision come from shared definitions. The server and client use the new bounds; the old 25 m recovery check has been removed. `tests/map.test.js` checks spawn/target clearance, connected routes in both gate layouts, gate detours, deck and jump-pad access, the long sightline, rendering/collision parity, and server recovery bounds.


## Four-player free-for-all (Build 0.9.0)

- Capacity is four, with a readable rejection for a fifth connection. Slots and colours are reused safely after a departure.
- Two, three, or four players can play. A late entrant receives a fresh safe spawn and protection without resetting the running round, scores, or gates. Players still in the room menu cannot be hit.
- Each client renders and interpolates up to three independently animated opponents. Departures remove their models, textures, labels, and minimap markers. Paused or dead viewers cannot see any opponent.
- Respawns consider distance to the nearest of **all** living opponents and whether each spawn is exposed through the current geometry, including gates.
- Shotgun pellets can damage several opponents in a single trigger. Damage and kills are credited per victim; shot accuracy still counts a successful trigger once.
- The scoreboard and result table include every entered player. The unique highest kill count wins; a tie for the highest count is a draw. Rematches require every currently entered player's vote and at least two players.
- Nearby opponent footsteps and gunshots use distance attenuation and stereo positioning relative to the listener. These remain procedural sounds; sound can be disabled in Settings.

`tests/ffa.test.js` covers four-player round rules, departures, late entry, rematches, spawn selection, multi-target combat, all-opponent interpolation, and avatar resource cleanup. Real WebSocket tests cover room capacity and movement propagation to all three observers. The hosted Sites build remains solo-only; multiplayer uses the local/LAN Node server.
