// test
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
- **Built-in Git** — diff viewer, staging, commits, worktree management
- **Integrated terminal** — per-thread terminal powered by xterm.js
- **GitHub Copilot backend** — uses your Copilot account for AI
- **Dark theme** — Codex-inspired minimal dark UI

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
