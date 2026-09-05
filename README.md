# Apply 2027

A free, static, offline-first PWA for managing graduate program research, applications, tasks, and documents. Data stays in the browser through IndexedDB; there is no account, backend, analytics, or paid service.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The GitHub Pages-ready site is generated in `dist/client`.

## Deploy for free with GitHub Pages

1. Push this folder to a GitHub repository.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` or `master`, or run the included workflow manually.

The included workflow builds and publishes the app. Hash-based navigation and relative asset paths make it work from both user sites and repository subpaths.

## Data and backups

- Programs, applications, tasks, and documents are stored locally in IndexedDB.
- Encrypted `.applyvault` backups use PBKDF2-SHA256 and AES-GCM in the browser.
- Excel import/export is available for moving existing trackers into or out of the app.
- Clearing browser site data removes local records, so regular encrypted backups are recommended.
