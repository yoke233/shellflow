# One Man Band

A desktop application for macOS that orchestrates git worktrees and launches Claude Code CLI instances in each.

## Features

- **Project Management**: Add git repositories and manage multiple workspaces
- **Worktree Orchestration**: Create isolated git worktrees with random names (e.g., "fuzzy-tiger")
- **Claude Integration**: Launch Claude CLI in each workspace with a dedicated terminal
- **File Watching**: Real-time display of changed files in each workspace
- **Terminal Access**: Shell access in each workspace for additional commands

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
- Claude CLI installed (`claude` command available)

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
│  │  Sidebar   │  │  Claude Pane      │  │  Right Panel    │ │
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
│  │ WorkspaceMgr │  │   PtyMgr     │  │  FileWatcher │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                                                   │
│  ┌──────────────┐                                           │
│  │    git2      │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

## Usage

1. **Add a Project**: Click the + button in the sidebar and select a git repository
2. **Create a Workspace**: Click "Add workspace" under a project to create a new worktree
3. **Use Claude**: Select a workspace to open Claude CLI in that worktree
4. **View Changes**: The right panel shows files changed in the active workspace
5. **Terminal Access**: Use the terminal in the right panel for shell commands

## Data Storage

- **Workspaces**: Created in `~/.workspaces/<repo-name>/<workspace-name>/`
- **State**: Persisted in `~/.onemanband/state.json`

## License

MIT
