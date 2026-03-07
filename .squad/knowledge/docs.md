# Docs Knowledge

## 2026-03-05T01:35:42+00:00
- Streaming isolation is enforced by correlating updates with both `threadId` and `requestId`, which is the key guard against thread bleed.
- Thinking/tool-call rendering depends on persisted Zustand message fields (`thinking`, `toolCalls`) rather than transient UI-only buffers.
- Deterministic Electron E2E tests are driven through `LOOM_TEST_MODE` scripted events, injected per test via `launchLoomApp` env overrides.

## 2026-03-05T01:38:08+00:00
- Testing is already split cleanly: Vitest for unit/component tests and Playwright projects for Electron E2E + visual regression.
- Electron tests are stabilized via deterministic test-mode env vars (`LOOM_TEST_MODE`, scripted stream events).
- Visual snapshots are intentionally versioned under `tests/__screenshots__/electron-visual/` and rely on fixed browser/runtime settings.
- CI is standardized around a single `npm run test:ci` entrypoint, with Playwright Chromium deps installed in workflow.

## 2026-03-05T04:56:54+00:00
- Stream isolation is enforced with `threadId` + `requestId`, and usage now flows as a `usage` stream event.
- Token accounting is cumulative per thread in Zustand (`thread.tokenUsage`) and shown in `ThreadPanel` via `TokenCounter`.
- The token counter UI is intentionally subtle (compact value + muted tooltip with prompt/completion/cache breakdown).
- Deterministic Electron tests use `LOOM_TEST_MODE` scripted events, which now include `usage`.

## 2026-03-05T05:00:09+00:00
- E2E determinism depends on test-mode plumbing (`LOOM_TEST_MODE`) and controlled renderer store access.
- README/visual docs are aligned with real Playwright/Electron captures stored in `screenshots/`.
- Release versioning is synced across `package.json` and `package-lock.json`, with annotated tags used for milestones (`v0.2.0`).

## 2026-03-05T05:01:22+00:00
- README is the primary, detailed source of truth for architecture, features, and test workflows.
- Reliability work in Loom emphasizes IPC safety (structured errors) and race prevention (ignoring stale async results).
- Testing is intentionally deterministic, with explicit coverage for stream isolation and visual baselines.

## 2026-03-05T07:45:12+00:00
- `README.md` is the primary source of truth for architecture, reliability, testing, and UI evidence.
- The project strongly prefers deterministic verification (`LOOM_TEST_MODE` + Playwright visual baselines).
- Stream isolation (`threadId` + `requestId`) and structured IPC errors are core reliability conventions.
- UI changes are expected to ship with committed screenshot artifacts, including before/after captures.

## 2026-03-05T11:47:35+00:00
- `src/main/agent.ts` is the central integration point where Copilot session config, stream events, and request/thread isolation all converge.
- SDK agent/skill invocation is prompt-driven (`sendAndWait({ prompt })`), not a separate typed message field.
- Skill discovery is convention-based on `.github/copilot/skills` and `.copilot/skills`, and docs/screenshots are expected to track these shipped UX paths.

## 2026-03-05T12:24:48+00:00
- `src/main/agent.ts` is the central integration point for session setup and skill directory wiring.
- `getProjectSkillDirectories` is the shared source of truth for skill discovery/runtime config alignment.
- E2E coverage is deterministic via `LOOM_TEST_MODE` and includes stream-isolation/concurrency checks.

## 2026-03-05T12:34:33+00:00
- `README.md` is actively maintained as the primary source of truth for reliability/testing behavior.
- Stream correctness and safety are enforced through defensive main/renderer payload handling (with strict request-scoped behavior).
- `npm run test:ci` is the canonical full verification path and already covers build, Vitest, Playwright e2e, and visual regression.

## 2026-03-05T13:47:27+00:00
- `README.md` is treated as the primary source of truth for shipped behavior, reliability, and test/visual verification workflows.
- Stream correctness is a hard requirement centered on `threadId + requestId`, and even performance changes are expected to preserve that boundary.
- UI evidence is deterministic and convention-driven: Playwright baselines plus curated `screenshots/ui-polish-*-before|after.png` assets.

## 2026-03-05T14:02:14+00:00
- `README.md` is treated as the public source of truth and should stay user-focused, not internal-review focused.
- Final polished screenshots already exist under `screenshots/` (`sidebar`, `thread-panel`, `settings-panel`, `diff-viewer`).
- The standard verification path for this task is `npm run build` (`build:main` + `build:renderer`).
- The repo is often dirty with unrelated artifacts, so scoped commits (per-file intent) are important.

## 2026-03-05T14:10:38+00:00
- `npm run test:ci` is the canonical CI gate (`build + unit + e2e + visual`).
- Electron E2E is deterministic via `xvfb-run` + `LOOM_TEST_MODE`.
- Packaging is `electron-builder` on Linux, producing Snap/AppImage artifacts under `release/`.

## 2026-03-05T15:07:06+00:00
- CI test orchestration is centralized in `npm run test:ci` (`build -> unit -> e2e -> visual`), so workflow fixes should preserve that single entrypoint.
- Electron e2e launch depends on built output at `dist/main/main.js` and stable Linux runtime libs in Actions runners.
- Windows release packaging relies on native module rebuild paths (`node-gyp`/`electron-builder`), so explicit Python wiring in workflow env reduces runner-image drift failures.

