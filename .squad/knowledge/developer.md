# Developer Knowledge

## 2026-03-05T01:35:42+00:00
- Thread chat state is canonically stored in Zustand per-thread `messages`, and stream UI correctness depends on mutating those message objects (not transient local component state).
- Main-process agent streaming already emits rich event types; adding request-level correlation at the IPC envelope is the safest isolation boundary.
- The E2E harness is designed around `LOOM_TEST_MODE`, and scripted stream fixtures are the best way to deterministically test concurrency/isolation behavior.

## 2026-03-05T04:56:54+00:00
- Stream isolation is enforced in the renderer via `threadId` + `requestId` guards before any message/store mutation.
- Per-thread conversational state is canonical in Zustand (`threads`), and optional thread fields are a safe persistence-evolution path.
- Deterministic Electron E2E/visual setup relies on `LOOM_TEST_MODE` scripted stream events and `window.__appStore` test hooks.

## 2026-03-05T05:00:09+00:00
- Renderer test determinism relies on direct Zustand store control via `window.__appStore` in test-mode flows.
- E2E stream/isolation behavior is validated through scripted `LOOM_TEST_*` event streams and request-scoped message handling.
- Preload bridge typing in `src/shared/electron.d.ts` must stay aligned with exposed runtime properties in `src/main/preload.ts`.
- Visual regression assets are already integrated (`tests/__screenshots__/electron-visual/...`) and can be reused for docs screenshots reliably.

## 2026-03-05T05:01:22+00:00
- Renderer async data loads already follow a simple “fire and set state” pattern, so request-id guards fit naturally and are low-risk.
- Main-process IPC conventions strongly prefer structured `{ ok/error }`-style results over uncaught throws.
- Test infrastructure is solid: `createMockIpcMain`/renderer mocks make IPC lifecycle/race regressions straightforward to lock down.

## 2026-03-05T07:45:12+00:00
- Renderer state is strongly centralized in Zustand, and UI correctness depends on mutating canonical per-thread message state.
- Stream isolation (`threadId` + `requestId`) is a core invariant and must be preserved across all async event handlers.
- Preload channel allowlisting is the key security boundary, so shared IPC constants and strict typing reduce both drift and risk.
- The test harness is mature (`LOOM_TEST_MODE` + Playwright Electron + visual snapshots), making broad refactors safe when validated through `test:ci`.

## 2026-03-05T11:47:35+00:00
- `src/main/agent.ts` is the single integration point for Copilot session config, streaming events, and request/thread isolation behavior.
- Sidebar skill discovery and SDK runtime session config had drifted, so sharing a single skill-directory resolver prevents recurrence.
- Prompt text is the canonical `@agent`/`@skill` invocation surface in the current SDK usage (`MessageOptions` only exposes `prompt`/attachments/mode`).

## 2026-03-05T12:24:48+00:00
- `src/main/agent.ts` is the integration hub for Copilot session setup, streaming, and skill wiring.
- `getProjectSkillDirectories` is the shared source of truth for both skill listing and runtime `skillDirectories` config.
- E2E coverage is deterministic (`LOOM_TEST_MODE`) and includes strong concurrency/isolation checks for thread streams.

## 2026-03-05T12:34:33+00:00
- Stream correctness is strongly tied to `threadId + requestId` scoping in `agent.ts` and `ThreadPanel.tsx`.
- Zustand thread/message state is the canonical UI state, and renderer behavior should mutate store-backed message objects directly.
- IPC boundaries in this repo are intentionally defensive (normalize/guard unknown payloads instead of trusting shapes).
- The existing Playwright + Vitest setup gives fast confidence for both behavior and UI-regression changes.

## 2026-03-05T13:47:27+00:00
- Stream correctness is tightly coupled to `threadId + requestId` guards, so batching/optimization must preserve per-request isolation boundaries.
- Renderer responsiveness depends heavily on Zustand subscription granularity; selecting the active-thread slice is much safer than subscribing to full `threads`.
- The visual regression workflow is deterministic and already integrated, making screenshot-backed UI polish straightforward when baselines are updated intentionally.

## 2026-03-05T14:02:14+00:00
- README scope can drift; user-facing docs should stay separate from internal review/reliability notes.
- Final polished screenshots already live in `screenshots/` (`sidebar`, `thread-panel`, `settings-panel`, `diff-viewer`).
- Build flow is standard: `npm run build` → `build:main` + `build:renderer`.
- This repo is often dirty from unrelated artifacts, so path-scoped commits are important.

## 2026-03-05T14:10:38+00:00
- `test:ci` is the authoritative CI pipeline (`build` + `test:unit` + `test:e2e` + `test:visual`).
- E2E is deterministic Electron Playwright under `xvfb-run`, aligned with `LOOM_TEST_MODE` flows.
- Packaging is `electron-builder` on Linux, producing `release/loom_0.2.0_amd64.snap` and `release/Loom-0.2.0.AppImage`.

