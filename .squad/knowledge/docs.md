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

