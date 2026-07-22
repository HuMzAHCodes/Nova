# Nova — Frontend Practices

## Must-have rules (standing conventions — never violated)
1. Components must be highly reusable.
2. If a component contains multiple sub-components, split into independent folders — each file handling exactly one thing. Example: `navbar/` splits into independent `Logo/`, `SearchBar/`, `Dropdown/` components rather than staying one file.
3. No inline styling — Tailwind utility classes only.
4. A theme file defines all colors as named tokens (`primary`, `secondary`, etc.) — never raw hex values scattered through components.
5. If a component's code exceeds 100 lines, it must be split into independent components.
6. Logic and layout are treated as separate concerns within a component. Example: the main `Navbar` file only composes child components (`<Logo/>`, `<SearchBar/>`, `<Dropdown/>`) — it does not itself contain business logic or deep markup.

## Supplementary practices (additions layered on top — don't override the rules above)
- **Atomic hierarchy:** a `ui/` folder for pure, reusable primitives (Button, Input, Modal — likely Radix wrappers), separate from feature-specific composed components.
- **Props conventions:** `onX` naming for callbacks, `isX`/`hasX` for booleans; avoid prop-drilling past 2-3 levels before reaching for context.
- **Custom hooks for logic extraction:** pull non-visual logic into `useX` hooks so components stay close to pure presentation — the frontend equivalent of keeping controllers thin on the backend.
- **Co-location:** a component's file, its sub-components, and any component-specific types live together in one folder rather than split across generic `components/`, `types/` top-level folders.

---
_Applies to all frontend work in this project, starting Week 6._
