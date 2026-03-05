# Loom

![Tests](https://github.com/Arthur742Ramos/loom/actions/workflows/tests.yml/badge.svg)
![Release](https://github.com/Arthur742Ramos/loom/actions/workflows/release.yml/badge.svg)
![Version](https://img.shields.io/github/v/tag/Arthur742Ramos/loom?label=version)
![Platform](https://img.shields.io/badge/platform-Electron-47848F)

> An agentic desktop coding app powered by GitHub Copilot, built for thread-based multi-agent workflows.

## ✨ Key Features

- 🧵 Parallel coding threads with isolated state and worktree context
- 🤖 Multi-agent orchestration across independent threads
- 🔒 Request-scoped streaming isolation for safe concurrency
- 🧠 Reasoning and tool trace rendering directly in chat
- 🧮 Per-thread token accounting for prompt/completion/cache usage
- 🌑 Codex-inspired dark UI with integrated terminal and Git views

## 📸 Screenshots

| Sidebar | Thread Panel |
| --- | --- |
| ![Sidebar](screenshots/sidebar.png) | ![Thread Panel](screenshots/thread-panel.png) |

| Settings | Diff Viewer |
| --- | --- |
| ![Settings](screenshots/settings-panel.png) | ![Diff Viewer](screenshots/diff-viewer.png) |

## 📦 Installation

### Download (recommended)

Get the latest Windows binaries from [Releases](../../releases):

- `Loom Setup.exe` — one-click installer
- `Loom-portable.exe` — portable executable

### Prerequisites

- GitHub Copilot subscription (Individual, Business, or Enterprise)
- GitHub CLI (`gh`) for authentication: <https://cli.github.com>
- Node.js + npm (only required for building/running from source)

### Build from source

```bash
git clone https://github.com/Arthur742Ramos/loom.git
cd loom
npm install
npm run build
```

## ▶️ Getting Started

```bash
# Start webpack watchers
npm run dev

# In another terminal, launch Electron
npm start
```

Then authenticate (`gh auth login`), open a local project, create a thread, and start prompting agents.

## 🧭 Usage Overview

1. Open a project folder in Loom.
2. Create one or more threads for parallel tasks.
3. Send prompts in each thread and follow streamed responses.
4. Use built-in terminal and Git panels to inspect, edit, and commit work.
5. Monitor per-thread token usage in the thread header.

## 🏗 Architecture Overview

```mermaid
flowchart LR
  UI[Renderer\nReact + TypeScript + Monaco]
  PRELOAD[Preload Bridge\ncontextIsolation-safe API]
  MAIN[Electron Main Process\nIPC handlers + orchestration]
  GIT[Git Layer\nsimple-git + worktrees]
  TERM[Terminal Layer\nnode-pty + xterm.js]
  AGENT[Agent Backend\nGitHub Copilot API]

  UI <-- IPC --> PRELOAD
  PRELOAD <-- allowlisted channels --> MAIN
  MAIN --> GIT
  MAIN --> TERM
  MAIN --> AGENT
```

## 🤝 Contributing

Contributions are welcome. Open an issue for discussion, then submit a pull request with a clear description and test coverage for behavioral changes.

## 📄 License

This repository currently does not include a `LICENSE` file.
