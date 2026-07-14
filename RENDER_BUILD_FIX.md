# Render build fix

The original Phase 1 `package-lock.json` accidentally contained dependency download URLs for an internal package mirror. Render cannot access that mirror, so `npm ci` waited on network retries.

This revision:
- replaces every dependency URL with the public npm registry;
- pins Node.js to 24.14.1 / Node 24 LTS;
- uses `npm ci --no-audit --no-fund` on Render;
- explicitly sets the npm registry to `https://registry.npmjs.org`.

Render settings:
- Build Command: `npm ci --no-audit --no-fund`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment: `NODE_VERSION=24.14.1`
- Environment: `NPM_CONFIG_REGISTRY=https://registry.npmjs.org`
