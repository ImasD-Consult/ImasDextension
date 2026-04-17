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
const qrUrlTemplate = trim(
	process.env.TRIMBLE_CONNECT_QR_URL_TEMPLATE || process.env.VITE_TRIMBLE_CONNECT_QR_URL_TEMPLATE || "",
);
const connectRegion = trim(
	process.env.VITE_TRIMBLE_CONNECT_REGION || process.env.TRIMBLE_CONNECT_REGION || "",
);
const psetServiceUri = trim(
	process.env.VITE_PSET_SERVICE_URI || process.env.PSET_SERVICE_URI || "",
);
const psetLibId = trim(
	process.env.VITE_PSET_LIB_ID || process.env.PSET_LIB_ID || "",
);
const psetLibraryName = trim(
	process.env.VITE_PSET_LIBRARY_NAME || process.env.PSET_LIBRARY_NAME || "",
);
const psetDefinitionName = trim(
	process.env.VITE_PSET_DEFINITION_NAME || process.env.PSET_DEFINITION_NAME || "",
);
const psetDefId = trim(
	process.env.VITE_PSET_DEF_ID || process.env.PSET_DEF_ID || "",
);
const psetPropertyName = trim(
	process.env.VITE_PSET_PROPERTY_NAME || process.env.PSET_PROPERTY_NAME || "",
);
const runtimeEnv = {
	EXTENSION_URL: ext,
	TRIMBLE_CONNECT_ORIGIN: connectOrigin,
	TRIMBLE_CONNECT_QR_URL_TEMPLATE: qrUrlTemplate,
	TRIMBLE_CONNECT_REGION: connectRegion,
	PSET_SERVICE_URI: psetServiceUri,
	PSET_LIB_ID: psetLibId,
	PSET_LIBRARY_NAME: psetLibraryName,
	PSET_DEFINITION_NAME: psetDefinitionName,
	PSET_DEF_ID: psetDefId,
	PSET_PROPERTY_NAME: psetPropertyName,
};
const body = [
	"window.__SMARTPRINT_PRO__ = window.__SMARTPRINT_PRO__ || {};",
	`Object.assign(window.__SMARTPRINT_PRO__, ${JSON.stringify(runtimeEnv, null, 2)});`,
	"",
].join("\n");
fs.writeFileSync("/app/env.js", body, "utf8");
NODE

BASE="${EXTENSION_URL%/}"

if [ -n "$BASE" ]; then
	cat > /app/manifest.json <<EOF
{
  "title": "smartprintPRO",
  "description": "smartprintPRO — register under Project → Extensions (Data) only. Use manifest-3d.json for 3D Viewer.",
  "configCommand": "do_config",
  "enabled": true,
  "extensionType": ["project"],
  "icon": "${BASE}/logo.svg",
  "url": "${BASE}/?mode=project"
}
EOF
	cat > /app/manifest-3d.json <<EOF
{
  "title": "smartprintPRO",
  "description": "smartprintPRO — 3D Viewer WBS; bottom data-tab when Integrations portal supports extensionPoints.",
  "configCommand": "do_config",
  "enabled": true,
  "extensionType": ["3dviewer"],
  "icon": "${BASE}/logo.svg",
  "url": "${BASE}/?mode=3d",
  "extensionPoints": [
    {
      "id": "smartprintpro-wbs-data-tab",
      "point": "trimble.connect.ui.viewer.data-tab",
      "title": "smartprintPRO WBS",
      "url": "${BASE}/?mode=3d"
    }
  ]
}
EOF
fi

exec "$@"
