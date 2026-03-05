# Loom

An agentic desktop coding app powered by GitHub Copilot — weaving thread-based multi-agent workflows.

## Architecture

```
[Electron UI (React + TypeScript + Monaco)]
  ⇅ IPC
[Electron Main Process (Node.js)]
  ├── Git operations (simple-git, worktrees)
  ├── Terminal (node-pty + xterm.js)
  └── Agent backend (GitHub Copilot API)
```

## Features

- **Thread-based workflow** — create parallel agent tasks, each isolated
- **Multi-agent orchestration** — run agents simultaneously in worktrees
- **Stream-safe responses** — request-scoped streaming prevents cross-thread bleed during concurrent runs
- **Reasoning + tool traces** — model thinking blocks and tool call results render inline per assistant message
- **Built-in Git** — diff viewer, staging, commits, worktree management
- **Integrated terminal** — per-thread terminal powered by xterm.js
- **GitHub Copilot backend** — uses your Copilot account for AI
- **Dark theme** — Codex-inspired minimal dark UI

## Installation

### Download (easiest)

Grab the latest `.exe` from [**Releases**](../../releases):

- **Loom Setup.exe** — one-click installer (recommended)
- **Loom-portable.exe** — no install needed, just run

### Prerequisites

- **GitHub Copilot** subscription (Individual, Business, or Enterprise)
- **GitHub CLI** (`gh`) — for authentication ([install](https://cli.github.com))

### Build from source

```bash
git clone https://github.com/Arthur742Ramos/loom.git
cd loom
npm install
npm run package    # builds + creates installer in release/
```

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# In another terminal, start Electron
npm start

# Build for production
npm run build
npm run package
```

## Testing

```bash
# Run full CI-equivalent suite (build + unit + e2e + visual)
npm test

# Run full CI-equivalent suite explicitly
npm run test:ci

# Run only unit tests
npm run test:unit

# Run Electron end-to-end test flow
npm run test:e2e

# Run Playwright visual regression tests
npm run test:visual
```

### Coverage map

- **Unit tests (`tests/unit`)**
  - Main process: `src/main/agent.ts`, `src/main/git.ts`
  - Renderer components: `Sidebar`, `ThreadPanel`, `App`, `WelcomeScreen`
- **E2E tests (`tests/e2e`)**
  - App flow: open app → create thread → send prompt → verify completed response
  - Stream isolation: verifies concurrent thread streaming, thinking/tool traces, and de-duplication behavior
- **Visual tests (`tests/visual`)**
  - Screenshot regression checks for sidebar, thread panel, settings panel, and diff viewer

Visual baselines are committed under `tests/__screenshots__/electron-visual/`.
To refresh snapshots intentionally:

```bash
xvfb-run -a playwright test --project=electron-visual --update-snapshots
```

### Test fixtures and utilities

- `tests/fixtures/`: deterministic agent responses, thread state, MCP config, diff fixtures
- `tests/utils/mockLlm.ts`: scripted LLM stream helpers
- `tests/utils/mockMcpServer.ts`: lightweight MCP mock server
- `tests/utils/createGitFixtureRepo.ts`: reproducible git repo fixtures
- `tests/utils/electronApp.ts`: Playwright Electron launcher with deterministic test mode

Thread stream integrity coverage is in `tests/e2e/thread-stream-isolation.spec.ts` (thread isolation, thinking visibility, tool results, and streaming de-duplication checks).

Deterministic Electron stream tests can be scripted with:
- `LOOM_TEST_MODE=1`
- `LOOM_TEST_AGENT_RESPONSE` (fallback response text)
- `LOOM_TEST_AGENT_SCRIPT` (or `LOOM_TEST_AGENT_EVENTS`) as JSON events (`status`, `thinking`, `tool_start`, `tool_end`, `chunk`, `done`, `error`) with optional `delayMs`

### CI

GitHub Actions workflow `.github/workflows/tests.yml` runs:
1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. `npm run test:ci`

## Authentication

Set your GitHub token via one of:
1. Environment variable: `GITHUB_TOKEN`
2. GitHub CLI: `gh auth login`

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.ts     # Window management, IPC setup
│   ├── agent.ts    # GitHub Copilot API integration
│   ├── git.ts      # Git operations (status, diff, worktrees)
│   └── terminal.ts # node-pty terminal management
├── renderer/       # React frontend
│   ├── App.tsx     # Root layout
│   ├── components/ # UI components
│   │   ├── Sidebar.tsx      # Thread list & project picker
│   │   ├── ThreadPanel.tsx  # Chat, diff, terminal tabs
│   │   ├── TitleBar.tsx     # Custom window title bar
│   │   └── WelcomeScreen.tsx
│   ├── store/      # Zustand state management
│   └── styles/     # CSS (Codex-inspired dark theme)
└── shared/         # Shared types & IPC constants
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron |
| UI framework | React 18 + TypeScript |
| Code editor | Monaco Editor |
| Terminal | xterm.js + node-pty |
| State | Zustand |
| Git | simple-git |
| AI backend | GitHub Copilot API |
| Bundler | Webpack |
