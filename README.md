# ImasD Extension

Trimble Connect for Browser extension for ImasD / SmartPrintPRO integration.

## Development

```bash
npm install
npm run dev
```

Runs at http://localhost:3000. Use this URL (or ngrok) as the manifest URL when adding the extension to a Trimble Connect project.

## Production

```bash
npm run build
```

Deploy the `dist/` folder to your web server.

## Manifest URL

When adding to a Trimble Connect project, use the URL to your manifest.json, e.g.:
- Local: `http://localhost:3000/manifest.json`
- Production: `https://your-domain.com/extension/manifest.json`
