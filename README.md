# KAIST exchange guide

An honest, first-person guide to an exchange semester at KAIST in Daejeon, South Korea, written for DTU students from my fall 2025 exchange.

Read it at **https://nohaxrelax.github.io/kaist-guide/**

## How it's built

- `draft/` holds the guide text, one markdown file per section.
- `site-src/` turns it into the site: `build.mjs` (markdown to HTML), the CSS, the small interactive tools (won to krone converter, budget receipt, checklists) and their data.
- `docs/` is the built site that GitHub Pages serves.

To rebuild after editing the text:

```
cd site-src
npm install
npm run build     # writes docs/
npm run check     # links, markers and privacy checks
npm run serve     # preview at http://localhost:8080/
```

Facts are from fall 2025 unless marked. This is not an official DTU or KAIST page.
