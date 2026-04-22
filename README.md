# Research Hub

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

### Backend (Railway)
1. Connect this repo to Railway
2. Set environment variables:
   - `STUDIO_PASSWORD=<workspace-password>` or set it in-app on first run
   - `VISITOR_PASSWORD=<shared-visitor-password>` or set it in-app on first run
   - `FLASK_SECRET_KEY=<long-random-secret>`
   - `CORS_ALLOWED_ORIGINS=https://YOUR_DOMAIN,https://YOUR_DOMAIN`
3. Railway auto-detects Python and runs `python server.py`
4. Copy the Railway URL (e.g., `https://research-hub-production.up.railway.app`)

### Frontend (Vercel)
1. Connect this repo to Vercel
2. Set environment variable: `VITE_API_URL=<your-railway-url>`
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

Visit `http://localhost:5173`

If you do not provide `STUDIO_PASSWORD` and `VISITOR_PASSWORD`, the first visit will prompt you to create both passwords in the browser.
