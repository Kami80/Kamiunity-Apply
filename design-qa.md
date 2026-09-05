# Apply 2027 design QA

## Comparison setup

- Source reference: `design/reference-deadline-compass.png`
- Implementation capture: `design/implementation-today-final.jpg`
- Reference dimensions: 1487 × 1058 px
- Browser viewport: 1487 × 1058 CSS px at device pixel ratio 1
- State: seeded local data, Today route, no modal or toast open
- Visual density: desktop, comfortable application-planning workspace

The source and implementation were inspected together in the same comparison input at matching dimensions. Additional layout checks were made at 768 × 1024 and 390 × 844.

## Findings and fixes

### Pass 1

- **P1 · Layout/navigation:** The initial implementation used stacked nav icons and a compact center group, while the source used a wide raised navigation tray with horizontal icon-label pairs. Fixed in `src/styles.css` by matching tray width, placement, item direction, active elevation, and underline.
- **P1 · Layout/scale:** The initial page gutters, title scale, timeline width, timeline card height, and vertical rhythm were too compact. Fixed by matching the 45 px desktop gutters, larger date heading, 630 px timeline panel, 170 px next-action card, and source-like row spacing.
- **P2 · Shapes/states:** Timeline nodes and due-state treatments lacked the source's raised circular markers and soft status wells. Fixed with restrained neumorphic node elevation plus neutral, urgent, and complete wells.
- **P2 · Content/alignment:** The deadline band used a narrow label column, left-aligned dates, and omitted the year on the cross-year deadline. Fixed with the source-like label width, centered deadline cells, and conditional year formatting.

### Pass 2

- **P2 · Spacing:** Desktop task copy and due wells drifted horizontally from the source. Fixed by adjusting the task-row inset and the gap before the trailing chevron while keeping the timeline rail anchored.
- **P2 · Responsiveness:** The mobile navigation tray increased document width by 18 px. Fixed with edge-to-edge negative margins inside the padded header; all six routes now report no horizontal overflow at 390 px.
- **P2 · Responsive readability:** Tablet due wells left too little room for long task names. Fixed with narrower responsive wells and row spacing; mobile collapses the well to an icon-only state.

## Functional and accessibility verification

- All six top-level destinations render and navigate through hash routes.
- Program and task modals open, accept input, and close by button or Escape without unintended data changes.
- Application table and board views switch correctly.
- Document metadata/detail states render from IndexedDB.
- Backup passphrase validation, encrypted backup download, and Excel export return success feedback.
- The service worker was verified by stopping the local server and successfully reloading the complete app offline.
- The production build precaches the app shell, fonts, icon assets, main bundle, styles, and lazy Excel bundle under a content-derived cache version.
- Semantic headings, labeled form fields, visible keyboard focus, reduced-motion support, status announcements, and practical touch targets are present.
- Viewport checks at 1487, 768, and 390 px found no horizontal document overflow or clipped core controls.
- Browser console review found no errors or warnings during the verified flows.

## Final assessment

No open P0, P1, or P2 findings remain. Minor antialiasing differences in the browser capture do not change hierarchy, spacing, or usability.

final result: passed
