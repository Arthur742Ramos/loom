# Developer Knowledge

## 2026-03-05T01:35:42+00:00
- Thread chat state is canonically stored in Zustand per-thread `messages`, and stream UI correctness depends on mutating those message objects (not transient local component state).
- Main-process agent streaming already emits rich event types; adding request-level correlation at the IPC envelope is the safest isolation boundary.
- The E2E harness is designed around `LOOM_TEST_MODE`, and scripted stream fixtures are the best way to deterministically test concurrency/isolation behavior.

