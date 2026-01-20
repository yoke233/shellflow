<div align="center">
  <img src="src-tauri/icons/web/icon-512.png" alt="One Man Band" width="128" height="128" />

  <h1>One Man Band</h1>

  <p><strong>A GUI git worktree orchestrator for AI-driven development</strong></p>

  <p>
    <a href="https://github.com/shkm/One-Man-Band/releases"><img src="https://img.shields.io/github/v/release/shkm/One-Man-Band?style=flat-square" alt="Release" /></a>
    <a href="https://github.com/shkm/One-Man-Band/blob/main/LICENSE"><img src="https://img.shields.io/github/license/shkm/One-Man-Band?style=flat-square" alt="License" /></a>
    <a href="https://github.com/shkm/One-Man-Band/stargazers"><img src="https://img.shields.io/github/stars/shkm/One-Man-Band?style=flat-square" alt="Stars" /></a>
  </p>

  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#configuration">Configuration</a> •
    <a href="#development">Development</a>
  </p>
</div>

<br />

<p align="center">
  <img src="screenshot.png" alt="One Man Band Screenshot" width="800" />
</p>

<br />

Heavily inspired by [Conductor](https://docs.conductor.build) and [Worktrunk](https://worktrunk.dev), with more focus on simplicity.

> [!WARNING]
> Currently early and everything is subject to change/break between versions.
> Also I used a whole lot of AI to build this.

## Features

- **Project Management** — Add git repositories and manage multiple worktrees
- **Worktree Orchestration** — Create isolated git worktrees with random names (e.g., "fuzzy-tiger")
- **Configurable Main Command** — Launch Claude, Aider, or any CLI tool in each worktree
- **File Watching** — Real-time display of changed files in each worktree
- **Terminal Access** — Shell access in each worktree for additional commands

## Installation

Download the latest release for your platform from the [Releases](https://github.com/shkm/One-Man-Band/releases) page.

| Platform              | Download         |
| --------------------- | ---------------- |
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel)         | `.dmg` (x64)     |
| Linux                 | `.AppImage`      |
| Windows               | `.exe`           |

## Technology Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Rust (Tauri 2.x)
- **Terminal**: xterm.js
- **Git**: git2 (libgit2 bindings)
- **PTY**: portable-pty

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Claude Code CLI installed (`claude` command available)

### Setup

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

The built application will be available at:

- `src-tauri/target/release/bundle/macos/One Man Band.app`
- `src-tauri/target/release/bundle/dmg/One Man Band_*.dmg`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri WebView (React)                                      │
│  ┌────────────┐  ┌───────────────────┐  ┌─────────────────┐ │
│  │  Sidebar   │  │  Main Pane        │  │  Right Panel    │ │
│  │            │  │  (tabbed xterm)   │  │  ┌───────────┐  │ │
│  │ - Projects │  │                   │  │  │ Changed   │  │ │
│  │ - Workspcs │  │                   │  │  │ Files     │  │ │
│  │            │  │                   │  │  ├───────────┤  │ │
│  │            │  │                   │  │  │ Terminal  │  │ │
│  └────────────┘  └───────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                      Tauri IPC
                            │
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ WorktreeMgr  │  │   PtyMgr     │  │  FileWatcher │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                                                   │
│  ┌──────────────┐                                           │
│  │    git2      │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

## Data Storage

- **Worktrees**: Created in `<repo>/.worktrees/<worktree-name>/` by default
- **State**: Persisted in `~/.onemanband/state.json`

## Configuration

Settings are stored in `~/.config/onemanband/config.jsonc`. The file is created with defaults on first run.

```jsonc
{
  // Main terminal pane (runs your AI coding tool)
  "main": {
    "command": "claude", // Command to run: "claude", "aider", etc.
    "fontFamily": "Menlo, Monaco, 'Courier New', monospace",
    "fontSize": 13,
  },

  // Shell terminal (bottom-right pane)
  "terminal": {
    "fontFamily": "Menlo, Monaco, 'Courier New', monospace",
    "fontSize": 13,
  },

  // Worktree settings
  "worktree": {
    // Directory for worktrees. Final path: {directory}/{worktree_name}
    // Supports placeholder: {{ repo_directory }}
    "directory": "{{ repo_directory }}/.worktrees",

    // Copy settings for new worktrees
    "copy": {
      // Copy gitignored files (e.g., .env, node_modules)
      "gitignored": false,
      // Glob patterns to exclude from copying
      "except": [".claude"],
    },
  },
}
```

### Terminal Options

Both `main` and `terminal` sections support:

- **fontFamily**: CSS font-family string for the terminal
- **fontSize**: Font size in pixels

### Worktree Options

- **directory**: Base directory for worktrees with `{{ repo_directory }}` placeholder support
- **copy.gitIgnored**: Copy gitignored files to new worktrees
- **copy.except**: Glob patterns to exclude from copying (default: `[".claude"]`)

### Attribution

Drum icon is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) [VectorPortal](https://vectorportal.com).

## License

MIT
