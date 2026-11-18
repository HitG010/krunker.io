# Deploy SHIFT

The game needs one persistent Node.js service that serves the client and WebSockets on the same public HTTPS origin. Static hosting supports solo practice only.

## Railway

1. Install the Railway integration and connect your account, or use the Railway dashboard with access to this GitHub repository.
2. Create a service from `HitG010/krunker.io`, branch `master`. Use the **repository root** as the build context: the Dockerfile copies files from `shift-arena/`.
3. Build with the root `Dockerfile`. Keep its default start command, `node server/index.js`.
4. Configure one replica in one region. Keep the service running continuously; do not enable sleep or scale it to zero during matches. Rooms and matches live in this process's memory.
5. Set the deployment health check path to `/api/health`. It returns HTTP 200 after the server starts. Railway supplies `PORT`; the process listens on `0.0.0.0`.
6. Generate a public HTTPS domain and ensure its target port matches the service's `PORT`. Set `PUBLIC_ORIGIN` to that exact origin, for example `https://your-game.up.railway.app`, and redeploy. Do not include a path.
7. Run the online smoke check below against that URL. Then open the game in desktop browsers, create a room, and share its invite link with up to three friends.

Railway documents [Docker deployments](https://railway.com/guides/deploy-scale-docker-containers-railway), [health checks](https://docs.railway.com/deployments/healthchecks), and [public domains](https://docs.railway.com/networking/public-networking). Its deployment health check is a startup check, not continuous uptime monitoring. This repository uses a Dockerfile rather than the deprecated `railway.json`/`railway.toml` format; see the [configuration reference](https://docs.railway.com/config-as-code/reference).

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5173` | HTTP and WebSocket listener; must be 1–65535. |
| `HOST` | `0.0.0.0` in production | Network interface. Local development defaults to `127.0.0.1`. |
| `PUBLIC_ORIGIN` | unset | Exact public HTTP(S) origin allowed for browser WebSockets. Useful behind a proxy that rewrites Host. When unset, browser Origin must match Host. |
| `NODE_ENV` | `production` in Docker | Production dependency/runtime environment. |

No database or API keys are required. Environment variables must be supplied by the host or shell; the server does not automatically load a `.env` file.

## Run the container locally

From the repository root:

```sh
docker build -t shift-arena .
docker run --rm --name shift-arena -p 127.0.0.1:5173:5173 shift-arena
```

Stop any existing local game server before using port 5173. The container runs as a non-root user, includes a health check, and serves precompressed Brotli/gzip assets. Hashed assets use long-lived cache headers; HTML is revalidated on each visit.

To run without Docker, use Node.js 24:

```sh
cd shift-arena
npm ci
npm test
npm run build
npm run smoke:production
npm start
```

## Check a deployed game

From `shift-arena/`, after `npm ci`:

```sh
npm run smoke:online -- https://your-game-host
```

The check verifies the health endpoint and game page, creates a private room, joins four WebSocket clients, enters a round, checks distinct player slots, and confirms that a fifth player is rejected. It disconnects all test clients afterward so the room is removed. HTTPS URLs use secure WebSockets (`wss`). It does not verify browser rendering, pointer lock, audio, or real-world latency.

For the first remote playtest, use two to four separate computers. Check joining by invite, movement, firing each weapon, scoped aiming, death/respawn while paused, a late join, leaving/rejoining, and rematching. Confirm that solo practice still launches from the lobby.

## Updates and restarts

GitHub Actions validates pushes and pull requests. The test job runs the complete test suite, builds the client, and runs the four-player production smoke check; a second job builds the Docker image.

Deploying or restarting clears rooms and scores. Shutdown closes WebSockets with code 1012 (service restart), then releases the HTTP server. Players must return to the lobby and create or join a new room after a restart. Automatic reconnect and match persistence are not implemented.

Keep one replica until shared room routing and storage are implemented. Multiple independent replicas can send room creation and joining to different processes, making room codes appear missing.
