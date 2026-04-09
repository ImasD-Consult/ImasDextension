#!/bin/sh
set -e

# Runtime `env.js` (same pattern as https://stackoverflow.com/q/70617812 — non-module script, not bundled by Vite).
node <<'NODE'
const fs = require("fs");
const trim = (s) => String(s ?? "").replace(/\/+$/, "");
const ext = trim(process.env.EXTENSION_URL);
const connectOrigin = trim(
	process.env.VITE_TRIMBLE_CONNECT_ORIGIN || process.env.TRIMBLE_CONNECT_ORIGIN || "",
);
const body = [
	"window.__SMARTPRINT_PRO__ = window.__SMARTPRINT_PRO__ || {};",
	`window.__SMARTPRINT_PRO__.EXTENSION_URL = ${JSON.stringify(ext)};`,
	`window.__SMARTPRINT_PRO__.TRIMBLE_CONNECT_ORIGIN = ${JSON.stringify(connectOrigin)};`,
	"",
].join("\n");
fs.writeFileSync("/app/env.js", body, "utf8");
NODE

BASE="${EXTENSION_URL%/}"

if [ -n "$BASE" ]; then
	cat > /app/manifest.json <<EOF
{
  "title": "smartprintPRO",
  "description": "ImasD / smartprintPRO integration for Trimble Connect",
  "configCommand": "do_config",
  "enabled": true,
  "icon": "${BASE}/logo.svg",
  "url": "${BASE}"
}
EOF
fi

exec "$@"
