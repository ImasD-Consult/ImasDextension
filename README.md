# ImasD Extension

Trimble Connect for Browser extension for ImasD / smartprintPRO integration.

## Testing in Trimble Connect

### 1. Start the dev server

```bash
npm install
npm run dev
```

Runs at http://localhost:3000.

### 2. Add the extension to your project

**Critical:** Extensions are added in **two different places** in Trimble Connect. Where you add it determines where it appears:

| Where you add it | Where it appears |
|------------------|------------------|
| **Project Settings** (when viewing project Data/folders) | Left nav in **Project** view (Data, Activity, BCF Topics, etc.) |
| **3D Viewer Settings** (when viewing a model) | Left nav in **3D model** view only |

**To get the extension in Project (folder) mode:**

1. Sign in to [Trimble Connect](https://connect.trimble.com).
2. Open a project where you are a **project administrator**.
3. **Stay on the Project page** — you should see the left sidebar with Data, Activity, BCF Topics, Shared Model, ToDo, Team, Settings. **Do not open or click into any 3D model.**
4. Click **Settings** (gear icon at bottom of left sidebar).
5. Click **Extensions** in the settings panel.
6. Under "Custom Extensions", click **Add**.
7. Enter: `http://localhost:3000/manifest.json`
8. Click **Save**.
9. Turn the extension **ON** with the toggle.

### 3. Use the extension

The extension appears in the left navigation (next to Data, Activity, BCF Topics). Click it to open the smartprintPRO panel.

**Troubleshooting:**
- **Extension only shows in 3D mode:** Remove it from 3D Viewer Settings, then add it again from **Project Settings** (when you're on the project Data/folders view, not inside a model).
- **"Failed to fetch" in Processes:** The extension must be loaded from the dev server (`npm run dev` at localhost:3000) so the proxy can forward API requests. Add the extension from `http://localhost:3000/manifest.json` — do not use a built/deployed URL for local testing.
- **Cloud icon instead of logo:** Mixed-content or CORS issues. Try [ngrok](https://ngrok.com) to serve over HTTPS.

### Localhost vs HTTPS

Trimble Connect is served over HTTPS. Loading from `http://localhost` can cause mixed-content issues in some browsers. If the extension does not load:

- Use [ngrok](https://ngrok.com) to expose your dev server over HTTPS:
  ```bash
  ngrok http 3000
  ```
- Update `manifest.json` so `url` uses the ngrok URL (e.g. `https://abc123.ngrok.io/index.html`).
- Use the ngrok manifest URL when adding the extension (e.g. `https://abc123.ngrok.io/manifest.json`).

## Production

```bash
npm run build
```

Deploy the `dist/` folder to your web server. Update `manifest.json` so `url` points to your production URL (e.g. `https://your-domain.com/extension/index.html`).
