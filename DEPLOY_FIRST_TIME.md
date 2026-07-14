# TLC HoloBox Manager Phase 1 — First Deploy

This guide follows the agreed workflow: local check → Supabase SQL → GitHub → Render → device runtime.

## 0. Before starting

Requirements on Windows:

- Node.js 20 LTS or newer
- Git
- A Supabase project
- A Render account
- Python 3.11 for the mini-PC runtime

Do not commit `.env`, the Supabase secret key, or a device token to GitHub.

The Supabase URL for this project is:

```env
SUPABASE_URL=https://qdgtfqfmdsrgbllwabvd.supabase.co
```

Use the base URL above. Do not append `/rest/v1`.

The secret key that was previously shared in chat should be rotated before production use. Enter the rotated value directly in Render and your local `.env`.

---

## 1. Preview only by opening `index.html`

Double-clicking `index.html` is only useful for checking the login-page layout, colors, logo, and spacing.

API login, database, uploads, power/mode controls, and media preview require the Node server.

---

## 2. Run the manager locally

Open PowerShell in the project folder:

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Fill `.env`:

```env
PORT=3000
NODE_ENV=development
SUPABASE_URL=https://qdgtfqfmdsrgbllwabvd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_THE_ROTATED_SECRET_KEY
SUPABASE_BUCKET=holobox-media
SESSION_SECRET=PASTE_A_LONG_RANDOM_VALUE
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
ADMIN_INITIAL_NAME=TLC Admin
UPLOAD_MAX_BYTES=262144000
SIGNED_URL_TTL_SEC=3600
HEARTBEAT_WARNING_SEC=45
HEARTBEAT_OFFLINE_SEC=90
DEVICE_HEARTBEAT_INTERVAL_SEC=15
```

Generate a session secret:

```powershell
npm run generate-secret
```

Copy the output into `SESSION_SECRET`.

Run checks and start:

```powershell
npm run check
npm start
```

Open:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:3000/health
```

Before the SQL migration is run, `/health` will report a database error. This is expected.

---

## 3. Back up the old demo state

Before running Phase 1, open Supabase → Table Editor → `holobox_state`.

Copy the `data` JSON from the current row into a local backup file such as:

```text
legacy_holobox_state_backup_2026-07-15.json
```

Do not commit that backup if it contains user information or credentials.

Phase 1 leaves the old `holobox_state` table untouched, but no longer reads or writes it.

---

## 4. Create the Supabase schema and private bucket

Open Supabase:

```text
SQL Editor → New query
```

Open this project file:

```text
supabase/migrations/001_phase1_foundation.sql
```

Paste the complete SQL into the editor and press **Run** once.

The migration creates:

- `organizations`
- `users`
- `playlists`
- `devices`
- `device_credentials`
- `device_reported_states`
- `media_assets`
- `playlist_items`
- `device_manifests`
- `assistant_scripts`
- `device_events`
- `audit_logs`
- `app_settings`
- private Storage bucket `holobox-media`
- transactional playlist reorder function
- Row Level Security on every application table

Do not create a public bucket manually. The SQL creates or updates it as private.

After SQL succeeds, restart the local Node server. On first startup, the server creates the platform admin from `ADMIN_INITIAL_USERNAME` and `ADMIN_INITIAL_PASSWORD` if no admin exists.

---

## 5. Test locally before GitHub

Test this flow:

1. Log in as the initial admin.
2. Create company `Glidfer` with a company-operator username and a password of at least 8 characters.
3. Open Glidfer.
4. Create `GLIDFER-HB-001`.
5. Copy the device token shown once after creation.
6. Use **View as Company**.
7. Upload a video, image, and audio file.
8. Drag advertisements to change playlist order.
9. Add an Assistant script and attach audio.
10. Press the Home power button and switch modes.
11. Return to Admin and verify the device shows `Offline` until the mini PC starts sending heartbeat.

Expected behavior:

- Power off is shown as `Powered Off`/`Đã tắt`, not as a false online state.
- A device with no heartbeat is `Offline`.
- A device with heartbeat but missing model/runtime error becomes `Error`/`Cần hỗ trợ`.
- Uploading media and a heartbeat at the same time cannot overwrite each other.
- `/api/state` is read-only compatibility; `PUT /api/state` returns HTTP 410.

---

## 6. Push to GitHub

Do not commit these:

```text
.env
node_modules/
Supabase secret key
device token
```

Recommended commands:

```powershell
git init
git add .
git commit -m "Build Holobox Manager Phase 1 foundation"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

For later fixes, replace only the changed files, then:

```powershell
git add path\to\changed-file-1 path\to\changed-file-2
git commit -m "Fix Phase 1 issue"
git push
```

Render will auto-deploy the new commit.

---

## 7. Create a new Render Web Service

In Render:

1. Select **New +** → **Web Service**.
2. Connect the GitHub repository.
3. Choose branch `main`.
4. Runtime: **Node**.
5. Region: choose the nearest available stable region.
6. Build command:

```text
npm ci
```

7. Start command:

```text
npm start
```

8. Health Check Path:

```text
/health
```

9. Auto-Deploy: **Yes**.

You can also use `render.yaml`, but manual creation is easier to verify the first time.

### Required Render environment variables

Add these under **Environment**:

```env
NODE_ENV=production
SUPABASE_URL=https://qdgtfqfmdsrgbllwabvd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_THE_ROTATED_SECRET_KEY
SUPABASE_BUCKET=holobox-media
SESSION_SECRET=PASTE_A_LONG_RANDOM_VALUE
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
ADMIN_INITIAL_NAME=TLC Admin
UPLOAD_MAX_BYTES=262144000
SIGNED_URL_TTL_SEC=3600
HEARTBEAT_WARNING_SEC=45
HEARTBEAT_OFFLINE_SEC=90
DEVICE_HEARTBEAT_INTERVAL_SEC=15
```

Do not add `PORT`; Render provides it automatically.

The Service Role/Secret key must only exist in Render and local `.env`. It must never appear in `app.js`, `index.html`, GitHub, or the mini PC.

Deploy, then open:

```text
https://YOUR-SERVICE.onrender.com/health
```

Expected:

```json
{
  "ok": true,
  "version": "14.0.0-phase1-foundation",
  "supabaseConfigured": true,
  "database": true
}
```

If `database` is false:

- verify SQL migration was run;
- verify the base Supabase URL;
- verify the secret key has no quotes or line breaks;
- restart/redeploy Render after correcting variables.

---

## 8. Python virtual environment for the mini-PC runtime

The Node manager does not use a Python `venv`. The Python `venv` is only for `holobox_device_runtime_yolo_agent`.

Copy the files from the provided runtime Phase 1 patch over the matching runtime files:

```text
device_agent.py            → runtime root
config.py                  → runtime root
.env.example               → runtime root
device.js                  → runtime/static/device.js
device.css                 → runtime/static/device.css
index.html                 → runtime/templates/index.html
requirements.txt           → runtime root
```

Open PowerShell in the runtime folder:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

If PowerShell blocks activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Fill the device `.env`:

```env
HOLOBOX_DEVICE_CODE=GLIDFER-HB-001
DEVICE_NAME=Glidfer HoloBox
DEVICE_TOKEN=PASTE_THE_DEVICE_TOKEN_SHOWN_ON_CREATION
MANAGER_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com
LOCAL_STREAM_URL=http://127.0.0.1:8000
HEARTBEAT_INTERVAL_SEC=15
MANIFEST_SYNC_HOUR=7
```

Do not put the Supabase key on the mini PC. The mini PC only needs the Manager URL and its own device token.

Run in two terminals while testing:

Terminal 1:

```powershell
.\.venv\Scripts\Activate.ps1
python stream_server.py
```

Terminal 2:

```powershell
.\.venv\Scripts\Activate.ps1
python device_agent.py
```

The patched agent:

- authenticates with the device token;
- sends heartbeat every 15 seconds;
- receives desired power and mode;
- syncs at startup;
- syncs once daily at `MANIFEST_SYNC_HOUR`;
- syncs immediately when Admin presses **Sync**;
- verifies downloaded size and SHA-256 checksum;
- keeps the previous local manifest if the new sync fails;
- supports advertisement images in the beta playback page.

---

## 9. First deployed end-to-end test

1. Open the Render site and log in as Admin.
2. Create Glidfer and one HoloBox.
3. Copy the device token into runtime `.env`.
4. Start `stream_server.py` and `device_agent.py`.
5. Wait 15–30 seconds.
6. Refresh Admin Dashboard.
7. Verify status changes from `Offline` to `Online` or `Connecting`.
8. View as Company.
9. Upload an advertisement.
10. Admin presses **Sync** on the device.
11. Verify runtime downloads the media.
12. Change playlist order and press Admin **Sync** again.
13. Switch Company mode and power; verify `desiredPowerState` and `desiredMode` update immediately in Manager.

The current runtime patch maps these commands to beta local modes. The final Assistant/Ads state machine will replace this bridge in the later runtime phase.

---

## 10. Later debugging workflow

Every fix should be delivered with:

1. changed file list;
2. SQL migration, only when the database changes;
3. new/changed environment variables;
4. local test steps;
5. post-deploy test steps.

When a new SQL migration is needed, run the migration before pushing code that depends on it.

Do not rerun destructive SQL or delete old tables unless a migration explicitly instructs you to do so.
