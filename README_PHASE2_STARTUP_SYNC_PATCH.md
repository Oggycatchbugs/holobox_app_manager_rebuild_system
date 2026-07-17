# Manager patch — Phase 2 startup sync bridge

## Changes

- Adds a default language per HoloBox (`vi` or `en`) and places it in the device manifest.
- Uses the Runtime-reported `/holobox_screen_display` URL as the customer preview through an iframe.
- Admin `Sync` now means `Restart & Sync`:
  1. first warning always appears;
  2. if the Runtime reports an active customer session, the server returns `ACTIVE_SESSION` and the UI requires a second force confirmation;
  3. the next heartbeat tells the Runtime to restart and force one startup sync.
- Mode changes remain immediate and do not restart the Runtime.
- Playlist upload, reorder and delete actions state that content applies at the next Runtime startup.
- Deleted cloud media is archived for seven days before the Storage object is purged.
- Manager shows web manifest version, local installed version, device language and real reported screen.

## Database migration

Run `supabase/migrations/002_phase2_startup_sync_bridge.sql` before deploying this patch.

It adds:

- `devices.default_language`
- `media_assets.purge_after`

## Local screen URL

The Runtime heartbeat should report:

```env
MANAGER_SCREEN_URL=http://127.0.0.1:8000/holobox_screen_display
```

For another computer on the same LAN, use the mini-PC IPv4. An HTTPS Render page may block an HTTP local iframe depending on browser mixed-content policy; the preview also includes an “open in new tab” link.

## Verification performed

`npm run check` passed for all Manager JavaScript files. Real Supabase/Render interaction must still be verified after applying the SQL migration.
