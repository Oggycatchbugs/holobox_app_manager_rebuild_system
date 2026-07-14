# TLC HoloBox Manager — Phase 1 Foundation

Phase 1 rebuilds the manager foundation while preserving the familiar Company Home layout.

## Included

- Custom Admin/Company login for demo use
- Normalized Supabase tables; no full-system JSON writes
- Per-device hashed token authentication
- Correct separation of power, connectivity, runtime, mode, and model status
- Private Supabase Storage media
- Video/image advertisement playlist with drag-and-drop order
- Audio and editable Assistant scripts for Company Operator
- Desired vs reported device state
- Manifest versioning, signed media URLs, size and SHA-256 metadata
- Device heartbeat and event APIs
- Admin audit log
- Archive instead of destructive deletion for company/device data

## Not included in Phase 1

- QR and visitor records
- Appointment sync
- Check-in sessions
- Door controller
- Final avatar/STT/TTS runtime
- Robot arm state machine

## Local start

```bash
npm install
cp .env.example .env
npm run check
npm start
```

Open `http://localhost:3000`.

Full first-deploy instructions are in [`DEPLOY_FIRST_TIME.md`](DEPLOY_FIRST_TIME.md).
