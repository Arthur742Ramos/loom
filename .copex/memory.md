# Copex Project Memory

## Entries

- [2026-03-05T01:04:39+00:00] [pattern] [sdk] Build advanced testing infrastructure for Loom (an Electron desktop coding app).
- [2026-03-05T01:04:39+00:00] [pattern] [sdk] Visual/Screenshot testing** — Playwright screenshot comparison for UI regression.
- [2026-03-05T01:04:39+00:00] [decision] [sdk] Read the existing codebase first to understand the architecture (Electron main/renderer split, React components, the store pattern).
- [2026-03-05T01:04:39+00:00] [pattern] [sdk] Testing stack + config foundation
- [2026-03-05T01:04:39+00:00] [pattern] [sdk] Add RTL stack: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- [2026-03-05T01:04:39+00:00] [decision] [sdk] **Vitest over Jest**: faster TS setup and simpler multi-environment config; trade-off is less legacy plugin ecosystem than Jest.
- [2026-03-05T01:04:39+00:00] [decision] [sdk] **Env-gated mock backend for E2E**: deterministic CI and still exercises real UI/IPC/store; trade-off is not validating live Copilot integration in default CI.
- [2026-03-05T01:04:39+00:00] [decision] [sdk] **Playwright `toHaveScreenshot` baselines committed in-repo**: robust regression detection; trade-off is baseline maintenance overhead.
- [2026-03-05T01:18:56+00:00] [preference] [sdk] Multiple concurrent agent calls in different threads don't interfere
- [2026-03-05T01:18:56+00:00] [preference] [sdk] Streaming updates don't cause visual overlap
- [2026-03-05T01:18:56+00:00] [decision] [sdk] Read everything first, understand the architecture, then fix.
- [2026-03-05T01:18:56+00:00] [pattern] [sdk] IPC stream envelope pattern: `event.sender.send('agent:stream', threadId, data)`
- [2026-03-05T01:18:56+00:00] [decision] [sdk] **Decision:** add `requestId` stream scoping
- [2026-03-05T01:18:56+00:00] [decision] [sdk] Trade-off:** slightly larger IPC payloads for strong isolation guarantees
- [2026-03-05T01:18:56+00:00] [decision] [sdk] **Decision:** render thinking/tools from persisted message state
- [2026-03-05T01:18:56+00:00] [decision] [sdk] Trade-off:** less transient UI state, more explicit message UI components
- [2026-03-05T01:33:43+00:00] [preference] [sdk] Refactor `ThreadPanel` to avoid conditional early-return before later hooks
- [2026-03-05T01:33:43+00:00] [preference] [sdk] In `agent.ts`, prefer SDK-provided tool IDs when available
- [2026-03-05T01:33:43+00:00] [preference] [sdk] Whether thinking/tool panels are always expanded vs collapsible in completed messages
- [2026-03-05T01:38:07+00:00] [preference] [sdk] Renderer uses direct `window.require('electron')` checks (no preload/contextBridge abstraction), so tests must mock `window.require`.
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Trade-off:** slightly larger IPC payloads for strong isolation guarantees
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Trade-off:** less transient UI state, more explicit message UI components
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Decision:** scripted LOOM test mode for E2E determinism
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Trade-off:** extra test harness complexity for high-confidence concurrency coverage
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Decision:** include hook-order hardening in same fix scope
- [2026-03-07T01:57:00+00:00] [decision] [sdk] **Trade-off:** slightly broader `ThreadPanel` change for major stability gain
