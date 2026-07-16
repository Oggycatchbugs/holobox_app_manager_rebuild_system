# Manager live-state patch

This patch fixes the Company Home preview logic.

## Changes

- The stream URL no longer determines online/offline status. Online status still comes from authenticated device heartbeats.
- In Assistant mode, the preview uses heartbeat telemetry:
  - person/session active -> Assistant/stream;
  - no person for 30 seconds -> Advertising;
  - ADS_ONLY -> Advertising immediately.
- Company Home silently refreshes device state every 5 seconds and rerenders only when the display/status signature changes, so an advertisement video is not restarted on every poll.

## Apply

Replace `app.js` in the Manager project, then:

```bash
npm run check
git add app.js
git commit -m "Fix runtime heartbeat preview and assistant idle ads switching"
git push
```

No SQL or environment changes are required on the Manager service.
