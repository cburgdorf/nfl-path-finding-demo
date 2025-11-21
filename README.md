# NFL Pathfinding Demo

A tiny TypeScript web demo that overlays a coarse grid on `assets/map.png`, classifies each tile as water (`0`) or land (`1`), and draws a shortest water-only path between two water tiles you click. Numbers are derived from the map image.

## Getting started

1) Install dependencies: `npm install`
2) Build TypeScript once: `npm run build` (or use `npm run watch` while editing)
3) Serve locally: `npm run start` and open http://localhost:4173

Tips:
- Click any water tile to set the start, then another water tile to set the target. Land clicks are ignored; if no water-only path exists, the path won’t draw.
- A small debug box logs your clicks and path results.
- The path solver uses diagonal moves where available, so routes follow the shortest water-only line.

## Deploying to GitHub Pages

A workflow at `.github/workflows/gh-pages.yml` builds the project and publishes `index.html`, `style.css`, `assets/`, and `dist/` to Pages. Push to `master`, then in repo Settings → Pages choose “GitHub Actions” as the source. The deployed site will serve `./dist/main.js` and the map assets without extra configuration.

The dev server is a lightweight Node script with no extra dependencies. Generated files live in `dist/` and are ignored by git.
