# Research Hub

A searchable research workspace with infinite canvas boards and spreadsheets.

## Stack

- **Frontend**: React + Vite + Excalidraw
- **Backend**: Flask + Python
- **Search**: Keyword + semantic (sentence-transformers)
- **OCR**: Tesseract

## Deploy

### Backend (Railway)
1. Connect this repo to Railway
2. Railway auto-detects Python and runs `python server.py`
3. Copy the Railway URL (e.g., `https://research-hub-production.up.railway.app`)

### Frontend (Vercel)
1. Connect this repo to Vercel
2. Set environment variable: `VITE_API_URL=<your-railway-url>`
3. Point your domain `YOUR_DOMAIN` to the Vercel deployment

## Local Development

```bash
# Backend
python server.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`
