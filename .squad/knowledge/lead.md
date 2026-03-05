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

