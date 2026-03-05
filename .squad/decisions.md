# Shared Squad Decisions

## 2026-03-05T01:35:42+00:00
- **Decision:** add `requestId` stream scoping
- **Trade-off:** slightly larger IPC payloads for strong isolation guarantees
- **Decision:** render thinking/tools from persisted message state
- **Trade-off:** less transient UI state, more explicit message UI components
- **Decision:** scripted LOOM test mode for E2E determinism
- **Trade-off:** extra test harness complexity for high-confidence concurrency coverage
- **Decision:** include hook-order hardening in same fix scope
- **Trade-off:** slightly broader `ThreadPanel` change for major stability gain

## 2026-03-05T01:38:08+00:00
- **Vitest over Jest**: faster TS setup and simpler multi-environment config; trade-off is less legacy plugin ecosystem than Jest.
- **Env-gated mock backend for E2E**: deterministic CI and still exercises real UI/IPC/store; trade-off is not validating live Copilot integration in default CI.
- **Playwright `toHaveScreenshot` baselines committed in-repo**: robust regression detection; trade-off is baseline maintenance overhead.
- **Minimal production code changes for testability** (export pure helpers + optional test IDs): keeps behavior intact while enabling meaningful tests.

