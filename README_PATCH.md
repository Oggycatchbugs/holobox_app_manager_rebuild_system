Patch changes:
1. Remove the Assistant tab from the Admin sidebar.
2. Replace VN/US text language buttons with SVG flag icons (reused from the previous project style).
3. This patch keeps the earlier clean video preview behavior and dashboard cleanup if you already merged the previous UI tweaks.

Files:
- app.js
- styles.css

Apply:
- Copy app.js and styles.css into the project root.
- Run: npm run check
- Commit and push.
- After Render deploys, press Ctrl + F5.
