UI tweak patch

Files included:
- app.js
- styles.css

Changes:
1. Language switch uses flag buttons (VN/US) instead of text labels.
2. Remove the quick Create HoloBox button from the admin dashboard; keep device creation in the device/company flow.
3. Remove browser controls from the customer home preview video so the preview area shows a clean video without pause/progress/fullscreen UI.

How to apply:
- Copy app.js and styles.css into the project root, replacing the old files.
- Run: npm run check
- Commit and push.
- After Render deploys, hard refresh the browser with Ctrl + F5.
