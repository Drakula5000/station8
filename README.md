![Station 8](./.github/assets/header.svg)

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/Drakula5000/station8/ci.yml?style=flat&labelColor=black&color=ccffff&label=CI)](https://github.com/Drakula5000/station8/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat&labelColor=black&color=aaffff)](./LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-black?style=flat&labelColor=black&color=66ffff&logo=python&logoColor=white)](https://www.python.org/)
[![tldraw](https://img.shields.io/badge/tldraw-4.x-black?style=flat&labelColor=black&color=00aaff)](https://tldraw.dev/)

<br>

Searchable whiteboards for research. Every picture, sticky, and spreadsheet cell is indexed.<br>
Whiteboards beat walls of text. But FigJam and Miro can't search the images on them... and images are worth 1k words.

</div>

<br>

![The problem with whiteboards.](./.github/assets/h-problem.svg)

I use whiteboards for research, because people prefer it to reading pages of analysis and findings. But FigJam, Miro, et al. don't have the kind of searchability you get with documents. So a photo from a slide at a conference or a picture of a jellyfish is invisible to their search.

Station 8 fixes that for me -- a searchable database for everything in my canvas-based research. Drop an image on a board and OCR runs in your browser, words printed inside the image become findable immediately. Tag the image with alt text and that's searchable too. Stickies, docs, spreadsheet cells, all of it indexed in one place.

The search results also take you directly to the search hits, zooming your camera for you, and lighting up your find. Search specific boards or the whole database, our search will take you on the guided tour of your hits.

You can create or import Google Docs and Sheets directly into the same workspace, so people can search your entire research database in one spot.

Station 8 is a free (or almost-free if depending on your usage) way to show-off your research and how you think. You could put a link in your résumé or recruiter outreach so they can see your research and passion on a relevant topic. The economy and labor market are tough right now, and I want you to shine without sacrificing meals.

<div align="center">
<a href="https://drakula5000.github.io/station8"><img src="./.github/assets/demo-link.svg" alt="→ TRY THE LIVE DEMO" width="260" /></a>
</div>

<br>

![Product Demo](./.github/assets/demo.svg)

<br>

![A free, searchable research database. Online.](./.github/assets/h-database.svg)

What I needed, and most independent researchers do too: a workspace that lives online for free, holds everything in one place (canvas, docs, sheets), and lets me find anything in it, including text inside images. Nothing else covers all four.

| tool | free online hosting | infinite canvas | canvas + docs + sheets | searches inside images | navigates to result |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Station 8** | **✓** | ✓ | ✓ | ✓ | ✓ |
| FigJam | ✓ | ✓ | ✗ | ✗ | ✗ |
| Miro | ✓ | ✓ | ✗ | enterprise only | ✗ |
| AFFiNE | ✓ | ✓ | ✗ | ✗ | ✗ |
| Obsidian | ✗ local-only | ✗ | ✗ | plugin | ✗ |
| Heptabase | ✗ $8.99/mo | ✓ | ✗ | ✗ | ✗ |
| Notion | ✓ | ✗ | ✗ | ✗ | ✗ |

### The trade-off for being free

Search uses TF-IDF, not LLM embeddings. It finds exact matches and statistically related terms based on what's in your corpus -- so "sea creatures" can surface jellyfish content if that's what your boards talk about. It won't make conceptual leaps a language model would, but it's fast, private, runs on tiny hardware, and never sends your data anywhere.

One login, two access levels: the owner password lets you edit everything, the visitor password is read-only. You can share individual boards with a private link too.

<br>

<a id="stack"></a>

![Stack](./.github/assets/h-stack.svg)

- **Frontend:** [tldraw](https://tldraw.dev) (canvas), [Tesseract.js](https://tesseract.projectnaptha.com/) (OCR), [react-spreadsheet](https://github.com/iddan/react-spreadsheet) (native sheets)
- **Backend:** Flask (Python), scikit-learn (TF-IDF search ranking)
- **Storage & hosting:** Supabase (data + image bucket), Vercel (frontend), Render (backend, free tier)

<br>

![Requirements](./.github/assets/h-requirements.svg)

You'll need four free accounts. Create them before you start — the free tier on each is enough to run Station 8.

- [GitHub](https://github.com) — to fork this repo (you're already here)
- [Supabase](https://supabase.com) — stores your boards and uploaded images (free tier: 500 MB database, 1 GB file storage; pauses after 1 week of inactivity)
- [Render](https://render.com) — runs the backend (free tier: sleeps after 15 min of inactivity, first request after sleep takes 30–90 sec)
- [Vercel](https://vercel.com) — hosts the frontend, the website your visitors see (free Hobby plan, no restrictions)

<br>

<a id="getting-started"></a>

![Getting Started](./.github/assets/h-getting-started.svg)

Five steps: fork → Supabase → Render → Vercel → log in. Each step builds on the previous one, so do them in order.

**1. Fork this repo.**

Click **Fork** at the top-right of this page. This gives you your own copy of Station 8 to deploy and customize.

<details>
<summary><strong>2. Set up Supabase.</strong></summary>

<br>

This is where your data lives — board content, workspace settings, and uploaded images.

- Create a new project at [supabase.com](https://supabase.com). Pick any region close to you.
- Go to **Project Settings → API** (or click the **Connect** button at the top of your project) and copy two values — you'll need them in the next steps:
  - **Project URL** (looks like `https://abcdefg.supabase.co`)
  - **anon / public key** (a long string starting with `eyJ...`)
- Go to **SQL Editor** and run this to create the table that stores all your data:
  ```sql
  create table json_storage (
    id text primary key,
    data jsonb
  );
  ```
  Leave Row Level Security (RLS) disabled on this table — it's off by default and Station 8 expects it that way. If you enable RLS, the backend won't be able to read or write data.
- Go to **Storage** and create a new bucket called `uploads`. Make sure **Public bucket** is turned on — this lets image URLs work directly from Supabase's CDN without going through your backend.

</details>

<details>
<summary><strong>3. Deploy the backend to Render.</strong></summary>

<br>

The backend handles search, saves, and serves your API. Render's free tier works, but it sleeps after 15 minutes of inactivity — the first request after sleep takes 30–90 seconds to wake up. This is normal.

Click the button below to deploy the backend. It reads the `render.yaml` in your fork and pre-fills the build/start commands for you — you just need to fill in the environment variables.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

When the deploy form appears:
- Pick the **Free** instance type.
- Fill in the environment variables Render prompts you for:

  | Variable | Value |
  |:---|:---|
  | `OWNER_PASSWORD` | The password you'll use to edit your workspace. **Required** — without it you're locked out (the app can't prompt you to create one in production). |
  | `VISITOR_PASSWORD` | The password you'll share with people who should have read-only access. **Required** — same reason. |
  | `SUPABASE_URL` | Your Supabase Project URL from step 2. |
  | `SUPABASE_KEY` | Your Supabase anon key from step 2. |
  | `CORS_ALLOWED_ORIGINS` | Your Vercel URL (you'll get this in step 4 — come back and add it). Example: `https://my-station8.vercel.app`. If you later add a custom domain, add it here too, comma-separated. |

  `FLASK_SECRET_KEY` is auto-generated for you. You don't need to fill it in.

- Click **Deploy Blueprint**. Render kicks off the first build and gives you a URL like `https://your-app.onrender.com` — copy it, you'll need it next.

</details>

<details>
<summary><strong>4. Deploy the frontend to Vercel.</strong></summary>

<br>

The frontend is the website your visitors see — the canvas, search, everything visual.

- Go to [vercel.com](https://vercel.com) → **Add New…** → **Project** → import your forked Station 8 repo from GitHub.
- Under **Configure Project**:
  - Click **Edit** next to **Root Directory** and select `frontend`.
  - Vercel should auto-detect the **Framework Preset** as **Vite**. If it doesn't, select Vite manually.
  - The build command and output directory are auto-detected — leave them as-is.
- Add these environment variables:

  | Variable | Value |
  |:---|:---|
  | `VITE_API_URL` | Your Render URL from step 3 (e.g. `https://your-app.onrender.com`). |
  | `VITE_TLDRAW_LICENSE_KEY` | Get a free key at [tldraw.dev/community/license](https://tldraw.dev/community/license). A free hobby license (non-commercial, shows a small watermark) is available. Without a key, the canvas shows a license warning on production HTTPS domains. Localhost works without one. |

- Click **Deploy**. Vercel gives you a URL like `https://my-station8.vercel.app` — that's your Station 8.

> **Now go back to Render** and add your Vercel URL as the `CORS_ALLOWED_ORIGINS` environment variable. Go to your Render service → **Environment** → find `CORS_ALLOWED_ORIGINS` → paste your Vercel URL → **Save**. Without this, your frontend can't talk to your backend — every API call will fail with a CORS error.

</details>

**5. Open your Station 8 and log in.**

Visit your Vercel URL. The backend may take 30–90 seconds to wake up on the first visit (Render free tier cold start). Once it's ready, you'll see the login screen — use the `OWNER_PASSWORD` you set in step 3.

Share your Vercel URL + the `VISITOR_PASSWORD` with anyone you want to give read-only access.

<details>
<summary><strong>Adding Google Docs and Sheets to your workspace</strong></summary>

<br>

Google Docs and Sheets are first-class document types in Station 8 — they live in the sidebar alongside boards, embed directly in the workspace, and their content is fully searchable. To use them, you connect your Google account via OAuth. Once connected, any Doc or Sheet you have access to can be added and searched, and you can share them all to visitors in one click.

You'll need a Google Cloud OAuth client (free, ~5 min). The order matters — Google blocks each step until the previous one is done.

**1. Create a Google Cloud project.**
Open [console.cloud.google.com](https://console.cloud.google.com/) (sign in with the Google account you want Station 8 to read from). Top bar → "Select a project" → **New project** → name it `Station 8` → **Create**. Wait ~10 seconds, then switch into it from the same dropdown.

**2. Enable the three APIs Station 8 uses.**
Left sidebar (☰) → **APIs & Services → Library**. Search and enable each separately:
- **Google Drive API** → click result → **Enable** → back arrow
- **Google Docs API** → **Enable** → back arrow
- **Google Sheets API** → **Enable** → back arrow

**3. Configure the OAuth consent screen.**
Left sidebar → **APIs & Services → OAuth consent screen** (in Google's newer UI this is called **Google Auth Platform** — click **Get started** if prompted). Pick **External** as the user type → **Create**.

> "External" sounds scary but for self-hosting it just means non-Workspace Google accounts can authenticate. It doesn't make your data public — it only controls who can sign in.

Fill in: app name `Station 8`, your email as "User support email", your email as "Developer contact". Click **Save and Continue** through every step (Scopes, Test users, Summary) — you can leave them all blank for now.

**4. Add yourself (and anyone else who'll use this Station 8) as a Test user.**
Your OAuth app stays in **Testing** mode forever — you do NOT need to publish it or go through Google's app verification for personal/team self-hosting. But Testing mode means **only emails listed under Test users can sign in**. Up to 100 emails allowed.

Go to the **Audience** tab (in the older UI: **OAuth consent screen → Test users**) → **Add users** → paste your Google email → **Save**. Add any other Station 8 users the same way. **If you skip this, you'll get an "Access blocked: Station 8 has not completed verification" error when you try to sign in.**

**5. Create the OAuth client credentials.**
In the newer UI: **Clients** tab → **Create Client**. In the older UI: **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID**.
- Application type: **Web application**
- Name: `Station 8 Web`
- Under **Authorized redirect URIs**, click "+ ADD URI" and paste your Render backend URL with the callback path:
  - `https://<your-app>.onrender.com/api/google/callback`
  - If you also want to develop locally, add: `http://127.0.0.1:5001/api/google/callback`
- **Create**.

**6. Copy the Client ID and Client secret** from the popup. The secret is only shown once — copy it now or you'll have to regenerate.

**7. Add the Google credentials to Render.**

Go to your Render service → **Environment** and add these variables:

| Variable | Value |
|:---|:---|
| `GOOGLE_CLIENT_ID` | The Client ID from step 6. |
| `GOOGLE_CLIENT_SECRET` | The Client Secret from step 6. |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<your-app>.onrender.com/api/google/callback` (must match what you entered in step 5). |
| `FRONTEND_URL` | Your Vercel URL (e.g. `https://my-station8.vercel.app`). This tells the backend where to redirect your browser after Google sign-in completes. Without it, the redirect goes to the wrong place. |

Save. Render will redeploy with the new variables.

Once deployed, open your Station 8, click **Connect Google** in the sidebar footer → sign in → grant Drive access → done. Creating a new Doc or Sheet inside Station 8 now creates a real file in your Drive automatically.

**For local development**, put the same credentials in `.env` at the project root (gitignored — never commit this file):

```bash
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:5001/api/google/callback
```

Restart the dev server (`.env` is loaded by `start.sh` on launch — a running server won't pick it up).

</details>

<br>
<br>

![Acknowledgements](./.github/assets/h-acknowledgements.svg)

[tldraw](https://tldraw.dev), [Tesseract.js](https://tesseract.projectnaptha.com/), and [react-spreadsheet](https://github.com/iddan/react-spreadsheet) do the heavy lifting.

<br>

![AI Transparency](./.github/assets/h-ai-transparency.svg)

I vibecoded this app. AI transparency is important for your security, safety, and guaging the longevity of a software. You might ask your own AI agents or, even better, an engineering friend to review this code before you use it.

<br>

<a id="license"></a>

![License](./.github/assets/h-license.svg)

MIT. See [LICENSE](./LICENSE).

tldraw requires its own license key for production use. A free 100-day trial and a free hobby license (non-commercial, shows a watermark) are available at [tldraw.dev/community/license](https://tldraw.dev/community/license).

---

<details>
<summary><strong>Running Station 8 on your own computer</strong></summary>

<br>

This is for people who want to run Station 8 locally — to tinker with the code, test changes, or just try it without deploying anywhere. You'll need Python 3.11+ and Node.js 18+ installed.

```bash
# Backend (terminal 1)
pip install -r requirements.txt
export FLASK_SECRET_KEY=dev-secret
python server.py

# Frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Visit `http://127.0.0.1:5173`. The app will prompt you to set an owner and visitor password on first run. Supabase is optional — without it, data is stored in local JSON files under `data/`.

</details>
