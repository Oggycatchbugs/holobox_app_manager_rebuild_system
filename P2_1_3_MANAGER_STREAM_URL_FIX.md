# Manager P2.1.3 — Separate Camera Stream and Screen Display URLs

The Manager now reads:

- `telemetry.cameraStreamUrl` / `telemetry.streamUrl` for the technical camera stream.
- `telemetry.holoboxScreenUrl` for the customer-facing HoloBox screen.

No SQL migration or new Render environment variable is required.
