# Patch: Add HoloBox button

Changed file: `app.js`

What changed:
- Added **Thêm HoloBox** button to Admin Dashboard.
- Added **Thêm HoloBox** button to the Admin Devices tab.
- The button opens a modal where Admin selects the company and enters device details.
- Existing company-detail form remains available.
- If no company exists, the UI redirects Admin to the Company tab.

Deploy:
1. Replace `app.js` in the repository root.
2. Run `npm run check`.
3. Commit and push.
4. Render auto-deploys.

No SQL migration and no new environment variables are required.
