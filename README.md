# SHIFT — Switchyard

A browser FPS with solo practice, private four-player matches, rifle/shotgun/sniper loadouts, and a large arena with shifting routes.

Requires Node.js 24:

```sh
cd shift-arena
npm ci
npm run dev
```

Open **http://localhost:5173**. Use `npm run dev:lan` for other computers on the same network.

- [Controls, gameplay, and project details](shift-arena/README.md)
- [Production hosting and deployment checks](DEPLOYMENT.md)

The root Dockerfile packages the client and multiplayer server together. GitHub Actions checks tests, the production build, four-player WebSocket connections, and the container build.
