# NativeLaunch

NativeLaunch is a multi-tenant control panel for hosting isolated Minecraft bot
instances. Each account owns its bots, proxies, aliases, scripts, schedules,
history, and panel preferences.

The public interface is a routed Next.js application styled with Tailwind CSS.
The Node control service remains the source of truth for authentication,
authorization, bot processes, tenant data, and live SSE streams.

## Frontend routes

- `/overview` — fleet and service summary
- `/bots` — lifecycle, console, configuration, inventory, modules, and bot scripts
- `/network` — private proxy pool and assignments
- `/aliases` — per-account command shortcuts
- `/scripts` — reusable tenant script library
- `/schedules` — persistent lifecycle schedules
- `/activity` — mass-command job history
- `/users` — administrator-only tenant management
- `/settings` — account security and preferences

## Start

```bash
npm install
export NATIVELAUNCH_ADMIN_PASSWORD='replace-with-a-long-random-password'
npm start
```

The panel listens on `127.0.0.1:3000` by default. Set `HOST=0.0.0.0` only when
the process must accept direct network traffic. For production, place NativeLaunch
behind an HTTPS reverse proxy and set `NATIVELAUNCH_COOKIE_SECURE=1`.

Set `NATIVELAUNCH_DATA_DIR` to a persistent private volume in production. This keeps
tenant data outside the application checkout and also makes upgrades simpler.

If no admin password is configured on the first boot, NativeLaunch creates a random
temporary password and prints it once to the server console.

### Next.js frontend

```bash
npm run dev:web       # development server on 127.0.0.1:3318
npm run build:web     # production build
npm run start:web     # production server on 127.0.0.1:3318
```

In production, proxy `/api/*` to the control service and all other requests to
the Next.js frontend. SSE routes live below `/api/`, so proxy buffering must be
disabled and the read timeout must allow long-lived connections.

## Runtime data

Runtime and account data are intentionally excluded from Git:

- `bots/` contains the bot roster and isolated per-bot runtime folders.
- `system_data/users.json` contains password hashes and account metadata.
- `system_data/workspaces/` contains per-account preferences and automation.
- `system_data/proxies.json`, jobs, schedules, and sessions are private state.

Deleting a bot removes its runtime folder. Deleting an account is blocked until
its bots and proxies are reassigned or removed, then its workspace is deleted.

## Commands

```bash
npm start       # start the NativeLaunch panel
npm run start:bot
npm run check   # backend syntax checks plus a production Next.js build
```
