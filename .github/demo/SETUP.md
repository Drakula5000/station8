# Station 8 Demo Setup Guide

## What's Been Created

The demo is now ready to build and deploy. Here's what was created:

### Source Files (`.github/demo/`)
- `package.json` - React + tldraw dependencies
- `vite.config.js` - Build configuration with base path `/station8/demo/`
- `index.html` - Entry point with Google Fonts (Inter, Space Mono, Gaegu)
- `src/main.jsx` - React root
- `src/Demo.jsx` - Main component with visitor/owner mode switcher
- `src/demo.css` - **NEW** Aurora theme styling with Station 8 design system
- `src/sampleData.js` - Fabricated marine biology research board
- `.gitignore` - Excludes node_modules and build artifacts
- `README.md` - Documentation

### Demo Features
- **Mode Switcher**: Toggle between Visitor (read-only) and Owner (full editing)
- **Aurora Theme**: Futuristic research station aesthetic
  - Cyan accent color (#00ddff)
  - Dotted grid background with animated diagonal scan sweep
  - Glass-morphism effects on UI elements
  - Space Mono monospace font for branding
- **Sample Board**: Marine biology research with:
  - 2 frames (Marine Biology Research, Fieldwork Sites)
  - 7 sticky notes with research data
  - 3 text shapes with sample data and citations
  - 1 geo shape (chart placeholder)
  - 2 arrows connecting concepts
- **Responsive**: Mobile-friendly layout

## Next Steps

### 1. Install Dependencies

```bash
cd .github/demo
npm install
```

### 2. Test Locally

```bash
npm run dev
```

Visit `http://localhost:5173` to see the demo.

**What to test:**
- Mode switcher toggles between Visitor and Owner
- Visitor mode: read-only, can pan/zoom
- Owner mode: full editing, toolbar appears
- Aurora theme renders correctly (cyan accent, dotted grid, scan animation)
- Sample board loads with all shapes visible
- Responsive layout works on mobile

### 3. Enable GitHub Pages

1. Go to your GitHub repo → Settings → Pages
2. Source: **GitHub Actions** (not "Deploy from a branch")
3. Save

The workflow at `.github/workflows/deploy-demo.yml` builds and deploys automatically whenever files in `.github/demo/` change on `main`. You can also trigger it manually via the Actions tab.

The demo will be live at:
`https://drakula5000.github.io/station8/demo`

## Troubleshooting

### CORS Error When Opening HTML Directly
You saw this error because browsers block `file://` protocol from loading ES modules. Always use `npm run dev` for local testing.

### Demo Not Loading on GitHub Pages
- Verify GitHub Pages source is set to **GitHub Actions** in repo settings
- Check the Actions tab for build errors in the "Deploy Demo" workflow
- Wait 1-2 minutes after pushing for GitHub Pages to rebuild

### Styles Not Applying
- Verify `demo.css` is imported in `Demo.jsx`
- Check browser console for CSS loading errors
- Clear browser cache and hard refresh

### Board Not Loading
- Check browser console for tldraw errors
- Verify `sampleData.js` exports are correct
- Ensure tldraw version matches (4.5.10)

## Design System Reference

The demo uses Station 8's Aurora theme tokens:

```css
--s8-bg:             #080c18  /* Background */
--s8-accent:         #00ddff  /* Cyan accent */
--s8-text:           #dce8f8  /* Primary text */
--s8-text-mid:       #8b9cbd  /* Secondary text */
--s8-text-dim:       #6473a0  /* Tertiary text */
--s8-pill-bg:        rgba(8, 12, 24, 0.85)  /* Glass surfaces */
--s8-pill-border:    rgba(0, 221, 255, 0.32)  /* Glass borders */
```

All styling follows the main app's design system for consistency.
