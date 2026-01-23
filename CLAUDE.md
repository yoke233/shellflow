# One Man Band

A Tauri desktop app for orchestrating git worktrees with integrated terminal support.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, xterm.js
- **Backend**: Rust, Tauri 2.x
- **Build**: Vite, Cargo

## Project Structure

```
src/                    # React frontend
  components/           # UI components
  hooks/                # React hooks (useWorktrees, usePty, useGitStatus)
  lib/                  # Tauri invoke wrappers
  types/                # TypeScript types
src-tauri/              # Rust backend
  src/
    lib.rs              # Tauri commands
    worktree.rs         # Git worktree operations
    pty.rs              # Terminal/PTY management
    watcher.rs          # File system watcher
    config.rs           # User configuration
    state.rs            # App state types
```

## Development

```bash
npm install
npm run tauri dev
```

**Important**: Do not run the app. The user will always run and test the app themselves.

## Commits and Releases

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with release-please for automated versioning.

### Commit Message Format

```
<type>: <description>

[optional body]

[optional footer]
```

### Version Bump Rules

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `feat:` | Minor (0.1.0 → 0.2.0) | `feat: add dark mode toggle` |
| `fix:` | Patch (0.1.0 → 0.1.1) | `fix: resolve crash on startup` |
| `feat!:` or `BREAKING CHANGE:` | Major (0.1.0 → 1.0.0) | `feat!: change config format` |
| `docs:`, `chore:`, `refactor:`, `test:`, `style:` | No bump | `docs: update README` |

### Commit Types

- `feat` - New feature for the user
- `fix` - Bug fix for the user
- `docs` - Documentation only changes
- `style` - Formatting, missing semicolons, etc (no code change)
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `chore` - Maintenance tasks, dependency updates
- `build` - Changes to build system or external dependencies
- `ci` - CI configuration changes

### Release Process

1. Make commits using conventional commit format
2. Push to `main` branch
3. Release-please automatically creates/updates a release PR
4. Review and merge the release PR
5. GitHub Action builds and uploads binaries to the release

### Manual Version Sync

Version is defined in three places that release-please keeps in sync:
- `package.json` - `version` field
- `src-tauri/Cargo.toml` - `version` field
- `src-tauri/tauri.conf.json` - `version` field

## Configuration

User config is stored at `~/.config/onemanband/config.jsonc`:

```jsonc
{
  "main": {
    "command": "claude",  // Command to run in main pane
    "fontFamily": "Menlo, Monaco, monospace",
    "fontSize": 13
  },
  "worktree": {
    "directory": "{{ repo_directory }}/.worktrees",
    "copy": {
      "gitignored": true,
      "except": [".claude"]
    }
  }
}
```

### Adding Configurable Options

When adding new configurable options, update all three files:
1. `src-tauri/src/config.rs` - Rust struct and defaults
2. `src-tauri/src/default_config.jsonc` - Default config with comments
3. `src-tauri/src/config.schema.json` - JSON Schema for validation
