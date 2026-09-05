# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Apply 2027 product direction

- Build a completely free, static, local-first PWA suitable for GitHub Pages. Do not add paid APIs, accounts, analytics, or a hosted backend.
- Use the selected deadline-first Today-screen mock at `design/reference-deadline-compass.png` as the visual source of truth.
- Use restrained neumorphism with soft edges: warm stone surfaces, teal primary actions, high-contrast text, visible focus states, and shadows that are never the only state indicator.
- Preserve spreadsheet-friendly workflows while prioritizing the student's next actions, deadlines, applications, programs, documents, calendar, and local backup.
