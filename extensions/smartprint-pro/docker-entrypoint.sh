#!/bin/sh
set -e

if [ -n "$EXTENSION_URL" ]; then
	cat > /app/manifest.json <<EOF
{
  "title": "smartprintPRO",
  "description": "ImasD / smartprintPRO integration for Trimble Connect",
  "configCommand": "do_config",
  "enabled": true,
  "icon": "${EXTENSION_URL}/logo.svg",
  "url": "${EXTENSION_URL}"
}
EOF
fi

exec "$@"
