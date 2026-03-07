# Lead Knowledge

## 2026-03-05T01:35:42+00:00
- Thread state and chat persistence are centralized in Zustand with per-thread message arrays
- Agent streaming already emits rich event types (`chunk`, `thinking`, `tool_start`, `tool_end`, `status`, `done`, `error`)
- Recent per-thread status refactor (`ebe5a02`) introduced a renderer regression around thinking display path
- Webpack build is transpile-focused; runtime regressions can slip past build and surface in unit runtime

## 2026-03-05T01:38:08+00:00
- Electron main process is organized as `setup*Handlers()` modules and IPC returns `{ error }` objects rather than throwing.
- Renderer uses direct `window.require('electron')` checks (no preload/contextBridge abstraction), so tests must mock `window.require`.
- Global Zustand store (`useAppStore`) is persisted (`loom-state`) and exposed on `window.__appStore`, which is useful for deterministic E2E setup.
- `main.ts` already includes test-oriented IPC hooks (`test:screenshot`, `test:exec`) that can support automation.
- There is currently **no** test framework, no test files, and no GitHub Actions workflow.

## 2026-03-05T04:56:54+00:00
- Thread isolation is enforced in renderer via `requestId` and active-request maps, not just threadId
- Agent stream events are normalized in main process and intentionally minimal
- Store persistence keeps trimmed thread history and is robust to large state via quota guards
- Renderer tests rely on `window.electronAPI` mocks and deterministic scripted agent streams
- `TitleBar.tsx` exists but is currently unused in `App.tsx`; ThreadPanel header is the real integration point

## 2026-03-05T05:00:09+00:00
- Electron main is modularized by handler domains (`auth`, `git`, `terminal`, `agent`) with IPC-centric contracts.
- Renderer state is centralized in a persisted Zustand store and is the backbone for both UI and deterministic test control.
- E2E/visual tests are built around scripted `LOOM_TEST_MODE` and direct store manipulation for determinism.
- Current failing path is in Playwright setup (`setProjectInStore`) due missing `__appStore` exposure in production bundle context.

## 2026-03-05T05:01:22+00:00
- Renderer streaming is already request-scoped (`threadId` + `requestId`) and state-driven via Zustand.
- Main-process modules follow `setup*Handlers()` and generally prefer returning `{ error }` over throws.
- Existing tests are solid and extensible, with good Electron IPC mocks (`mockIpcMain`, `mockElectronRenderer`) and deterministic scripted E2E flows.

## 2026-03-05T07:45:12+00:00
- Main process is modular and handler-driven (`setup*Handlers`), with structured IPC returns favored over throws.
- Renderer is Zustand-centered with persisted state and strong request-scoped stream isolation logic in `ThreadPanel`.
- Test strategy is already strong: deterministic `LOOM_TEST_MODE`, solid unit mocks, Playwright Electron e2e/visual coverage.
- Current largest leverage points are typing/DRY cleanup in IPC+agent paths and render churn reduction in `ThreadPanel`/`Sidebar`.

## 2026-03-05T11:47:35+00:00
- `src/main/agent.ts` is the core integration point and already merges project agents/MCP per request, with strong request/thread stream isolation.
- Sidebar skill/agent discovery and runtime session config are currently decoupled, which caused the skills regression.
- Renderer already inserts `@skill`/`@agent` mentions into chat input; main sends raw prompt text through unchanged.
- Test infrastructure is solid (Vitest mocks + Playwright Electron harness), but SDK config paths need explicit non-test-mode coverage.

## 2026-03-05T12:24:48+00:00
- Main-process agent integration is centralized in `src/main/agent.ts` with helper-driven config composition.
- Skill discovery is intentionally centralized via `getProjectSkillDirectories`, reused by both listing and runtime config.
- E2E harness depends on `LOOM_TEST_MODE` and `window.__appStore` for deterministic control and assertions.

## 2026-03-05T12:34:33+00:00
- Main/renderer IPC contracts are explicit and heavily tested with deterministic mocks.
- Concurrency/isolation is a first-class concern (`requestId` scoping, per-thread locks, active request maps).
- The project already has strong unit + Playwright coverage, but no dedicated lint pipeline.
- `src/main/agent.ts` and `src/renderer/components/ThreadPanel.tsx` are the highest-leverage and highest-risk polish points.

## 2026-03-05T13:47:27+00:00
- Stream correctness is explicitly request-scoped (`threadId` + `requestId`) and protected by per-thread locks in main.
- `ThreadPanel.tsx` and `Sidebar.tsx` are the biggest render-risk surfaces due to size and many store subscriptions.
- Visual testing is deterministic and already wired for CI via Playwright Electron harness (`LOOM_TEST_MODE` + store injection).
- The project favors surgical, test-backed fixes over broad rewrites, especially in `agent.ts` and stream paths.
- Screenshot workflows and README integration are already established and should be extended, not reinvented.

## 2026-03-05T14:02:14+00:00
- `README.md` had drifted into internal engineering changelog content; user-facing docs need tighter scope.
- Final polished screenshots are already available under `screenshots/` (`sidebar`, `thread-panel`, `settings-panel`, `diff-viewer`).
- Build path is standard and reliable: `npm run build` (`build:main` + `build:renderer` via webpack).
- The working tree is often dirty with unrelated artifacts, so path-scoped commits are important.

## 2026-03-05T14:10:38+00:00
- `npm run test:ci` is the authoritative CI path: `build + unit + e2e + visual`.
- E2E is deterministic and Electron-based (`xvfb-run`, Playwright project `electron-e2e`), with stream-isolation coverage already in place.
- Packaging is via `electron-builder` (`npm run package`) and succeeded on Linux, producing Snap/AppImage artifacts.
- The repo can be dirty with unrelated `.squad`/report artifacts; safest approach is surgical/no-touch on unrelated files.

## 2026-03-05T15:07:06+00:00
- CI test orchestration is intentionally centralized in `npm run test:ci`.
- E2E is Electron + Playwright-based and launched from built artifact `dist/main/main.js`.
- Workflow changes are the highest-leverage, lowest-risk path for this failure mode.
- Windows release packaging currently depends on successful native rebuild (`node-pty`) in CI.

