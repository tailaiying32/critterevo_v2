# CritterEvo v2

An artificial life simulator where critters with evolved neural-network brains live, eat, fight, mate, and die in a continuous 2D world with climate-driven biomes. Successor to [CritterEvo](https://github.com/tailaiying32/CritterEvo).

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- Build plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

## Requirements

Node 22.12 or newer.

## Commands

```bash
npm install          # install all workspaces
npm run dev          # start the web app at http://localhost:5173
npm run sim -- --seed 42 --ticks 100000   # run headless and print the state hash
npm run check        # typecheck, lint, and test
```

## Deploying

Pushes to `main` run the checks and deploy the web app to GitHub Pages through `.github/workflows/deploy.yml`. One-time setup on GitHub: create the repository, push, then set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.

## Layout

```
packages/
  core/   Simulation engine. Pure TypeScript, no DOM, deterministic.
  web/    React + PixiJS app. Runs core in a Web Worker.
  cli/    Headless runner for experiments.
docs/     Design and implementation plan.
```

`core` must stay deterministic. ESLint blocks `Math.random`, `Date.now`, and `performance` there. Use the seeded `Rng` instead.
# critterevo_v2
