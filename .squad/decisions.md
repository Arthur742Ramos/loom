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

## 2026-03-05T04:56:54+00:00
- **Decision:** track tokens from `assistant.usage` events in stream path
- **Trade-off:** strongest fidelity to Copilot runtime events, but depends on provider emitting usage consistently
- **Decision:** place TokenCounter in ThreadPanel header
- **Trade-off:** best visibility with low clutter, but slightly denser header controls
- **Decision:** cumulative per-thread token accounting by default
- **Trade-off:** useful longitudinal signal, less immediate per-turn granularity unless added later
- **Decision:** CSS-based subtle animations (no new deps)
- **Trade-off:** lightweight and consistent with current stack, less sophisticated than numeric tween libs

## 2026-03-05T05:00:09+00:00
- **Decision**: fix only reproducible CI breakage first (e2e store exposure), avoid speculative build/main.ts edits.
- **Trade-off**: may diverge from original task assumptions, but keeps changes minimal and evidence-based.
- **Decision**: gate `__appStore` exposure to test mode (not global production).
- **Trade-off**: slightly more preload/type wiring, stronger production safety.
- **Decision**: reuse existing visual Playwright flow for README screenshots.
- **Trade-off**: ties docs screenshot refresh to test fixtures, but yields deterministic and repeatable assets.

## 2026-03-05T05:01:22+00:00
- Prioritize **correctness under concurrency** (tool correlation + prompt handling) over minimal code churn.
- Add **runtime validation** at IPC/config boundaries to prevent malformed-data crashes.
- Keep fixes surgical and phase-committed so each bug cluster is independently reviewable and revertable.

## 2026-03-05T07:45:12+00:00
- **Phase quality/type work first** to reduce risk before UI/perf changes.
- **Preserve streaming isolation behavior over code churn minimization** (correctness-first under concurrency).
- **Use deterministic visual workflow** (extra baseline maintenance, better confidence).
- **Prefer surgical refactors over architectural rewrites** to keep each commit independently reviewable and reversible.

## 2026-03-05T11:47:35+00:00
- **Centralize skill directory resolution** in one helper to prevent future drift between listing and runtime wiring.
- **Keep agent invocation text-based** (`@agent` in prompt) unless hard evidence requires an explicit selection API path.
- **Prefer minimal main-process edits + targeted tests** over broader renderer/protocol changes.
- **Use deterministic screenshot workflow** even if it adds small fixture/setup overhead, for reliable proof and CI reproducibility.

## 2026-03-05T12:24:48+00:00
- Chose evidence-based scope: run full e2e first, then fix only if failing.
- Accepted no-code-change outcome to avoid unnecessary churn in stable stream/session paths.
- Used an empty commit to satisfy “commit and push if passing” without sweeping unrelated dirty workspace changes.

## 2026-03-05T12:34:33+00:00
- **Decision:** keep polish surgical and behavior-preserving; avoid architecture rewrites.
- **Trade-off:** less dramatic cleanup, lower regression risk.
- **Decision:** no new lint tool introduction in this pass.
- **Trade-off:** faster/risk-limited delivery, no new automated style gate.
- **Decision:** prioritize typed boundaries and error clarity in critical paths first (`agent.ts`, `ThreadPanel.tsx`).
- **Trade-off:** some non-critical `any` usage may remain where SDK dynamics make strict typing costly.

## 2026-03-05T13:47:27+00:00
- **Decision:** prioritize concurrency-safe performance optimizations first (selectors, batching, lazy-loading) before visual polish details.
- **Trade-off:** less flashy early output, much lower regression risk in core chat/stream behavior.
- **Decision:** keep IPC contracts backward-compatible while adding batching support.
- **Trade-off:** slightly more adapter logic, safer rollout.
- **Decision:** preserve deterministic Playwright workflow for before/after evidence.
- **Trade-off:** higher snapshot maintenance, stronger confidence and reproducibility.
- **Decision:** keep changes surgical in high-leverage files rather than restructuring store architecture wholesale.
- **Trade-off:** incremental gains instead of maximum theoretical perf rewrite, but much safer delivery.

## 2026-03-05T14:02:14+00:00
- Kept the architecture section as a brief mermaid overview for clarity; removed all deep implementation notes.
- Kept only polished screenshots; removed all before/after and internal fix evidence blocks.
- Added a license section that truthfully states no `LICENSE` file exists, instead of inventing license terms.
- Isolated the commit to `README.md` only to avoid including unrelated workspace changes.

## 2026-03-05T14:10:38+00:00
- **Decision:** Use evidence-based remediation (run everything first, patch only failing paths).
- **Trade-off:** If no failure reproduces locally, outcome can be no-code-change.
- **Decision:** Run release/package explicitly in addition to CI tests.
- **Trade-off:** Longer validation cycle, higher confidence in shipping path.
- **Decision:** Use an empty commit to satisfy “commit and push” without sweeping unrelated workspace changes.
- **Trade-off:** No functional diff in commit, but traceable verification point.

## 2026-03-05T15:07:06+00:00
- **Decision:** prioritize workflow/environment fixes before app code edits.
- **Trade-off:** slower initial diagnosis if issue were in app code, but far lower regression risk.
- **Decision:** add explicit Electron runtime deps instead of relying only on Playwright `--with-deps`.
- **Trade-off:** slightly more maintenance in workflow, much clearer reproducibility.
- **Decision:** fix Windows rebuild via pinned Python toolchain.
- **Trade-off:** extra setup step, but removes runner-image drift from release path.

