# Loom repository instructions

## Build and test commands

- Install deps: `npm install`
- Start the app locally:
  - `npm run dev` starts the main-process watch build plus the renderer dev server on port 9000
  - `npm start` launches Electron from `dist/main/main.js`
- Production builds:
  - `npm run build`
  - `npm run build:main`
  - `npm run build:renderer`
  - `npm run package`
- Type checking: `npm run typecheck`
- Unit tests (Vitest):
  - Full suite: `npm run test:unit`
  - Single file: `npx vitest run tests/unit/renderer/app.test.tsx`
  - Single test: `npx vitest run tests/unit/renderer/app.test.tsx -t "renders welcome screen when no project is selected"`
- Electron E2E tests (Playwright):
  - CI/Linux wrapper: `npm run test:e2e`
  - Local single spec: `npx playwright test tests/e2e/app-flow.spec.ts --project=electron-e2e`
  - Single named test: `npx playwright test tests/e2e/app-flow.spec.ts --project=electron-e2e -g "opens app, creates thread, sends prompt, and receives response"`
- Visual regression tests (Playwright):
  - CI/Linux wrapper: `npm run test:visual`
  - Local single spec: `npx playwright test tests/visual/ui-regression.spec.ts --project=electron-visual`
  - Update baselines: `npx playwright test tests/visual/ui-regression.spec.ts --project=electron-visual --update-snapshots`
- Full CI-equivalent run: `npm run test:ci`
- Live smoke checks: `npm run test:live-integrations` (requires `LOOM_SMOKE_GH_TOKEN`; can also use `LOOM_LIVE_MCP_URL` and `LOOM_LIVE_MCP_AUTH_HEADER`)

Notes tied to this repo:
- The `test:e2e` and `test:visual` package scripts wrap Playwright with `xvfb-run` for CI/Linux. On Windows, invoke `npx playwright test ... --project=...` directly.
- Playwright runs expect a built app; if `dist/` is stale, run `npm run build` first.
- CI installs Chromium explicitly with `npx playwright install chromium` before Playwright runs.

## High-level architecture

- This is an Electron app split into three bundles:
  - `src/main/*` = privileged main-process code
  - `src/main/preload.ts` = the context-isolated IPC bridge
  - `src/renderer/*` = the React UI bundled separately by `webpack.renderer.config.js`
- `src/main/main.ts` is the runtime entrypoint. It creates the `BrowserWindow`, enables `contextIsolation`/`sandbox`, and wires up the Git, terminal, Copilot agent, auth, updater, project-picker, and test-only IPC handlers.
- `src/main/preload.ts` is the only renderer bridge. Renderer code talks to Electron through `window.electronAPI`; renderer bundles do not have direct Node access.
- `src/shared/types.ts` is the shared contract layer for IPC channel names and diff/git payloads. Main and renderer stay in sync through this file.
- `src/main/agent.ts` is the Copilot orchestration layer. It:
  - keeps one resumable Copilot session per Loom thread
  - serializes requests per thread to avoid concurrent session races
  - batches high-frequency stream events before sending `agent:stream` to the renderer
  - merges project-discovered skills, custom agents, and MCP servers into each session config
  - forwards permission prompts and `ask_user` prompts back to the renderer over IPC
- `src/main/auth.ts` owns GitHub auth. It checks environment tokens first, then the encrypted token stored under the Electron userData directory, then `gh auth token`; login uses the GitHub device flow and sends completion back to the renderer over IPC.
- `src/main/git.ts` handles repository operations through `simple-git`, parses diffs for the renderer, and creates per-thread worktrees under `.copilot-worktrees/<threadId>` on branches named `copilot/<threadId>`.
- `src/main/terminal.ts` owns the embedded shell via `node-pty`. Terminals are one-per-thread, and the spawned environment is sanitized to strip token/secret-like variables.
- Renderer state lives in the persisted Zustand store in `src/renderer/store/appStore.ts`. It owns projects, threads, messages, token usage, MCP config, UI state, and persistence pruning.
- The renderer flow is project-centric: `Sidebar` selects a project/branch, `appStore` persists that selection, and the active thread follows the current project so chat, diff, and terminal panels all stay scoped to the same repo context.
- `src/renderer/components/Sidebar.tsx` is not just navigation; it also discovers project instructions/skills/agents/MCP servers, loads branch data, and exposes project-level actions.
- `src/renderer/components/ThreadPanel.tsx` is the main interaction surface. User prompts go out over `agent:send`; streamed status, reasoning, tool-call, usage, and completion events come back over `agent:stream` and are folded into the persisted thread/message state.
- `ThreadPanel` lazy-loads `DiffView` and `TerminalView`, so git diff rendering and terminal lifecycle are separate renderer panels backed by `git:*` and `terminal:*` IPC handlers instead of ad hoc local state.
- `src/renderer/components/SettingsPanel.tsx` is the integration health surface: it checks GitHub auth, Copilot model availability, project MCP discovery, app version, and updater status from the main process.
- Tests use two distinct harnesses:
  - Vitest runs `tests/unit/main/**` in a Node environment and `tests/unit/renderer/**` in jsdom
  - Playwright launches the built Electron app in `LOOM_TEST_MODE=1`, uses mocked agent/auth flows, and drives state through `window.__appStore`

## Key repository conventions

- Treat IPC changes as a cross-cutting change. New channels must stay aligned across:
  - `src/shared/types.ts` (channel constants and shared payload types)
  - `src/main/preload.ts` (allowed send/invoke/on channel lists)
  - the relevant `src/main/*.ts` handler implementation
- Keep renderer code browser-only. If UI code needs filesystem, git, auth, terminal, or agent behavior, add it behind the preload bridge instead of importing Node/Electron APIs into the renderer.
- Project Copilot assets are discovered from fixed locations:
  - instructions: `.github/copilot-instructions.md`
  - skills: `.github/copilot/skills/` and `.copilot/skills/`
  - custom agents: `.github/agents/`
  - MCP servers: `.vscode/mcp.json` and `.github/copilot/mcp.json`
  If discovery paths change, update both the main-process discovery logic and the Sidebar/SettingsPanel messaging together.
- This repo commits a shared Playwright MCP server in `.github/copilot/mcp.json`. Use it for browser-driven UI investigation before adding one-off browser automation helpers.
- Thread state is project-scoped and persistent. `appStore` keeps recent threads/messages in localStorage, trims persisted history to the most recent 100 threads / 50 messages each, and switches the active thread when the selected project changes.
- Playwright and E2E tests are intentionally offline/deterministic. They rely on `LOOM_TEST_MODE`, mocked Copilot responses, and test-only hooks such as `window.__appStore` instead of live backend calls.
- UI changes should usually be validated with the visual Playwright suite. Snapshot baselines live under `tests/__screenshots__/electron-visual/...`.
- Renderer unit tests depend on a clean persisted store. Shared cleanup clears localStorage in `tests/unit/setup.ts`, and renderer tests commonly reset the Zustand store with `resetAppStore()`.
