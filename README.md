# ImasD Extensions

Trimble Connect browser extensions monorepo — powered by Turborepo, pnpm, Vite, TypeScript, and Tailwind CSS v4.

## Project Structure

```
├── packages/
│   ├── shared/              @imasd/shared — Trimble API client, connection, utilities
│   └── tailwind-config/     @imasd/tailwind-config — shared brand theme (CSS)
│
├── extensions/
│   └── smartprint-pro/      @imasd/ext-smartprint-pro — smartprintPRO extension
│
├── types/                   Ambient type declarations (trimble-connect-workspace-api)
├── turbo.json               Turborepo task config
└── tsconfig.base.json       Shared TypeScript config
```

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10 — `corepack enable` activates it via the `packageManager` field
- **ngrok** — for HTTPS tunnelling during local testing ([install](https://ngrok.com/download))
- **Docker** — for building container images (optional, for deployment)

## Getting Started

```bash
# Enable pnpm via corepack (one-time)
corepack enable

# Install all dependencies
pnpm install
```

### Development — single extension

```bash
# Start the smartprint-pro dev server on http://localhost:3000
pnpm turbo dev --filter=@imasd/ext-smartprint-pro
```

### Development — all extensions

```bash
pnpm dev
```

## Testing with Trimble Connect

Trimble Connect runs on HTTPS. Loading an extension from `http://localhost` causes
mixed-content blocks in most browsers. Use **ngrok** to expose your local dev server
over HTTPS.

### 1. Start the dev server

```bash
pnpm turbo dev --filter=@imasd/ext-smartprint-pro
```

Runs at `http://localhost:3000`.

### 2. Start ngrok

In a second terminal:

```bash
ngrok http 3000
```

ngrok prints a forwarding URL like:

```
Forwarding  https://ab12-34-56.ngrok-free.app -> http://localhost:3000
```

Copy that `https://...ngrok-free.app` URL.

### 3. Register the extension in Trimble Connect

> **Important:** Where you add the extension determines where it appears.
>
> | Added from | Appears in |
> |---|---|
> | **Project Settings** (Data/folders view) | Project sidebar (Data, Activity, BCF Topics…) |
> | **3D Viewer Settings** (inside a model) | 3D model sidebar only |

1. Sign in to [Trimble Connect](https://connect.trimble.com).
2. Open a project where you are a **project administrator**.
3. Stay on the **Project page** (Data/folders view) — do **not** open a 3D model.
4. Click **Settings** (gear icon at the bottom of the left sidebar).
5. Click **Extensions**.
6. Under "Custom Extensions", click **Add**.
7. Enter the ngrok manifest URL:
   ```
   https://ab12-34-56.ngrok-free.app/manifest.json
   ```
8. Click **Save**, then toggle the extension **ON**.

### 4. Use the extension

The extension appears in the left navigation next to Data, Activity, BCF Topics.
Click it to open the smartprintPRO panel. Changes you make in code are reflected
instantly via Vite HMR.

### Troubleshooting

| Problem | Fix |
|---|---|
| Extension only shows in 3D mode | Remove it from 3D Viewer Settings, re-add from **Project Settings** (Data/folders view). |
| "Failed to fetch" in Processes | The dev server must be running (`pnpm turbo dev`). API calls go through Vite's proxy. |
| Cloud icon instead of logo | Mixed-content or CORS issue — make sure you're using the ngrok HTTPS URL. |
| ngrok free plan shows interstitial page | Add `ngrok http 3000 --host-header=localhost` or use a paid plan. |

## Production Build

```bash
# Build all extensions
pnpm build

# Or build just smartprint-pro
pnpm turbo build --filter=@imasd/ext-smartprint-pro
```

The built output is in `extensions/smartprint-pro/dist/`.

The production `manifest.json` is emitted by Vite with **relative** `url` / `icon` (no
domain baked in). For a **Docker** deployment, set `EXTENSION_URL` at **runtime** (or
as a build-arg on the final image stage); `docker-entrypoint.sh` rewrites
`manifest.json` before `serve` starts.

```bash
docker run -p 3000:3000 -e EXTENSION_URL=https://your-domain.example/trimble/smartprintPRO <image>
```

**Runtime config in the iframe (`env.js`):** the extension loads `public/env.js` as a
plain script (not bundled by Vite), same idea as
[runtime env with Docker + static hosting](https://stackoverflow.com/questions/70617812/change-environmet-variables-at-runtime-react-vite-with-docker-and-nginx).
At container start, `docker-entrypoint.sh` regenerates `/app/env.js` from
`EXTENSION_URL` (JSON-safe).

Optional: bake a default URL into the image at build time (still overridable at run):

```bash
docker build -f extensions/smartprint-pro/Dockerfile \
  --build-arg EXTENSION_URL=https://your-domain.example/trimble/smartprintPRO \
  -t smartprint-pro .
```

## Docker

Each extension has its own `Dockerfile`. Images are built from the repo root (the
monorepo context is needed to resolve workspace dependencies).

### Build an image locally

```bash
docker build -f extensions/smartprint-pro/Dockerfile -t smartprint-pro .
```

Default `EXTENSION_URL` is set on the **runtime** image; override when running:

```bash
docker run -p 3000:3000 \
  -e EXTENSION_URL=https://extensions.imasdconsult.com/trimble/smartprintPRO \
  smartprint-pro
```

### Run locally

```bash
docker run -p 3000:3000 smartprint-pro
```

The extension is served at `http://localhost:3000/trimble/smartprintPRO/` (container
exposes port 3000; map as needed).

### Health check

```
GET /health → 200 ok
```

## CI / CD

GitHub Actions workflow at `.github/workflows/build.yml`:

- **On pull request** → builds all extension images (no push).
- **On push to `main`** → builds and pushes to GitHub Container Registry (GHCR).

Images are tagged `latest` (main branch) and by git SHA.

To add a new extension to CI, append an entry to the `matrix.extension` array in the
workflow file.

## Deploy

Upload the contents of `extensions/smartprint-pro/dist/` to your web server at
the path `/trimble/smartprintPRO/` so the final URLs match:

```
https://extensions.imasdconsult.com/trimble/smartprintPRO
https://extensions.imasdconsult.com/trimble/smartprintPRO/manifest.json
https://extensions.imasdconsult.com/trimble/smartprintPRO/logo.svg
```

Or deploy the Docker image and expose port 80. The nginx inside the container already
serves at the correct `/trimble/smartprintPRO/` path.

Then register `https://extensions.imasdconsult.com/trimble/smartprintPRO/manifest.json`
in Trimble Connect Project Settings → Extensions.

## Adding a New Extension

1. Copy `extensions/smartprint-pro/` to `extensions/my-extension/`.
2. Update `package.json` name (e.g. `@imasd/ext-my-extension`).
3. Set the correct `base` path in `vite.config.ts` (e.g. `/trimble/myExtension/`).
4. Update `MANIFEST_BASE` in `vite.config.ts` and default `EXTENSION_URL` in the
   extension `Dockerfile` if needed.
5. Update `nginx.conf` location path to match the base.
6. Update the `Dockerfile` `COPY` paths and `--filter` to the new package name.
7. Add the extension to `.github/workflows/build.yml` matrix.
8. Run `pnpm install` to link workspaces.
9. Run `pnpm turbo dev --filter=@imasd/ext-my-extension`.

## Scripts Reference

| Command | Scope | Description |
|---|---|---|
| `pnpm dev` | all | Start all extension dev servers |
| `pnpm build` | all | Production build for all extensions |
| `pnpm lint` | all | TypeScript type-check across all packages |
| `pnpm clean` | all | Remove `dist/` and `.turbo` caches |
| `pnpm turbo dev --filter=<name>` | one | Dev server for a specific extension |
| `pnpm turbo build --filter=<name>` | one | Build a specific extension |
