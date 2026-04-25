![Station 8](./assets/header.svg)

A searchable research workspace with infinite canvas boards and spreadsheets.

The app now has two access modes:

- `owner view`: the full internal workspace
- `visitor view`: a read-only workspace view plus scoped share links

At `YOUR_DOMAIN`, everyone sees the same password gate. The password they enter determines whether they land in the owner view or the visitor view. Scoped share links still work, and they use the same visitor password.

## Stack

- **Frontend**: React + Vite + tldraw
- **Backend**: Flask + Python
- **Search**: Keyword + semantic (sentence-transformers)
- **OCR**: Tesseract

## Deploy

### Backend (Render)
1. Create or update the Render web service from this repo.
2. Make sure the service has a persistent disk mounted at `/var/data`.
   The committed `render.yaml` now declares this disk and sets `S8_STORAGE_DIR=/var/data`.
3. Set environment variables:
   - `OWNER_PASSWORD=<workspace-password>` or `STUDIO_PASSWORD=<workspace-password>`
   - `VISITOR_PASSWORD=<shared-visitor-password>` or set it in-app on first run
   - `FLASK_SECRET_KEY=<long-random-secret>`
   - `CORS_ALLOWED_ORIGINS=https://YOUR_DOMAIN,https://YOUR_DOMAIN`
   - Optional: `S8_ALLOW_PROD_AUTH_SETUP=true` only if you intentionally want browser-based password setup in production
4. Render runs `python server.py`.
5. Your live JSON data and uploads will persist across deploys because the backend now reads/writes from:
   - `/var/data/data`
   - `/var/data/uploads`
6. Copy the Render URL (e.g. `https://your-app.onrender.com`)

### Frontend (Vercel)
1. Connect this repo to Vercel
2. Set environment variable: `VITE_API_URL=<your-render-url>`
3. Point your domain `YOUR_DOMAIN` to the Vercel deployment

## Local Development

```bash
# Backend
export FLASK_SECRET_KEY=dev-secret
python3 server.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Visit `http://127.0.0.1:5173`

If you do not provide `OWNER_PASSWORD`/`STUDIO_PASSWORD` and `VISITOR_PASSWORD`, local development can prompt you to create both passwords in the browser. In production, browser-based setup should stay disabled unless you explicitly opt in with `S8_ALLOW_PROD_AUTH_SETUP=true`.

### Storage paths

By default, the backend stores files in local repo folders:
- `data/`
- `uploads/`

To move them somewhere persistent in production, set one of:
- `S8_STORAGE_DIR=/some/root`
  Then the app will use `/some/root/data` and `/some/root/uploads`.
- `S8_DATA_DIR=/some/data/path`
- `S8_UPLOADS_DIR=/some/uploads/path`

`S8_DATA_DIR` and `S8_UPLOADS_DIR` override `S8_STORAGE_DIR` if all three are set.
