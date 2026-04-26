# Station 8 Demo

Interactive demo showcasing Station 8's visitor and owner modes with sample marine biology research data.

## Local Development

```bash
cd .github/demo
npm install
npm run dev
```

Visit `http://localhost:5173`

## Build for GitHub Pages

```bash
npm run build
```

The GitHub Actions workflow (`.github/workflows/deploy-demo.yml`) builds and deploys automatically on push to `main`. The demo is served at:
`https://drakula5000.github.io/station8/demo`

## Structure

- `src/Demo.jsx` - Main demo component with mode switcher and sample data
- `src/demo.css` - Aurora theme styling
- `src/main.jsx` - React entry point
- `index.html` - HTML entry point
- `vite.config.js` - Build configuration

## Features

- **Visitor Mode**: Read-only view with search capability
- **Owner Mode**: Full editing with toolbar
- **Sample Data**: Marine biology research board with stickies, frames, text, and arrows
- **Aurora Theme**: Futuristic research station aesthetic with cyan accent and dotted grid
