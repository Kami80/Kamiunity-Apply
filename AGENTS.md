# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Apply 2027 product direction

- Build a completely free, static, local-first PWA suitable for GitHub Pages. Do not add paid APIs, accounts, analytics, or a hosted backend.
- Use `design/kamiunity/application-dossier.png` as the current Kamiunity visual source. The earlier deadline-first Today mock is retained as historical context.
- Use restrained neumorphism with soft edges: warm paper surfaces, turquoise primary actions, high-contrast text, visible focus states, and shadows that are never the only state indicator.
- Preserve spreadsheet-friendly workflows while prioritizing the student's next actions, deadlines, applications, programs, documents, calendar, and local backup.
- Make the workflow editable and connected: programs need their own URL, admissions details, and professor contacts; applications can start from saved programs; documents can link to multiple programs and applications from either side. Preserve these richer details in local backups and spreadsheet exports.
- Use the user's shared Google Sheet as the default read-only program catalogue feed, with the starter catalogue retained as the offline fallback.

## Kamiunity brand direction

- Rename and specialize this existing university application planner as Kamiunity; this is the same product, not a separate website.
- Create a custom Kamiunity logo first, then make the interface and language specific to graduate applications, professor contacts, deadlines, and document readiness instead of a generic productivity dashboard.
- Preserve the existing local-only storage, free static PWA architecture, and connected workflows through the rebrand.
- Proceed with the second generated screen, `design/kamiunity/application-dossier.png`, as the main application workspace after the user's instruction to continue. Extend its brand and typography across the existing routes.
- Use the generated logo at `design/kamiunity/kamiunity-logo.png`. In product copy, distinguish local device storage from encrypted backup files; do not repeat the mockup's inaccurate claim that all local storage is encrypted.
- Keep an explicit Add task action in task areas, including application task panels with no upcoming tasks and the Deadlines page. Creating a task from an application should preselect that application.

## Navigation and visual preference

- Use distinct navigation shells for desktop and mobile: a full desktop header and a five-item mobile bottom bar.
- The mobile bar is icon-only and ordered left-to-right as Applications, Programs, Add document, Deadlines, and Document vault; keep a raised central Add document action.
- Keep Backup & transfer as an icon-only utility in the upper-right of the mobile shell, and keep the primary date workspace focused on Deadlines.
- Keep the application workspace locked until a matched Google Form profile is saved locally; Profile remains the setup route and unlocks the other pages after the first successful sync.
- Use the active palette throughout the shell and all routes: yellow `#F4BF45`, mint `#A9DDD4`, pink `#F7B8C7`, and turquoise `#55C8BD`, with retro-vibrant accents, liquid-glass surfaces, and high-contrast dark text. Use darker derived tones only where the raw colors would reduce readability.
- Treat dark mode as a designed midnight-plum workspace: layer charcoal glass surfaces with warm paper-colored type, preserve the yellow/mint/pink/turquoise identity as luminous accents, and use dedicated dark empty-state artwork instead of simply inverting the light illustrations.
