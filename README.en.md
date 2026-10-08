# SyzerCLI-Orca

[Türkçe](README.md) · **English**

The **Orca plugin** for [SyzerCLI](https://github.com/yasinbalcik/SyzerCLI). It makes SyzerCLI a first-class agent inside [Orca](https://github.com/stablyai/orca). SyzerCLI is a separate project installed separately; this repo only contains the Orca side.

## What it does

- **Agent menu:** Syzer (S logo) in the "New terminal" menu.
- **Live status:** working / waiting / done in the sidebar, plus the running subagent list.
- **Session history:** Syzer sessions in the history panel with a subagent list; Resume runs `syzer --resume <id>`.
- **Usage:** Syzer provider in the status bar (percent, key count, remaining quota) and a Syzer filter under Settings → Stats & Usage.
- **Key manager:** list, activate, remove and bulk-add Syzer keys under Settings → AI Provider Accounts.
- **Tab restore:** after restarting Orca the Syzer tab comes back with its conversation.
- **Closes shells on quit:** Orca deliberately keeps terminals alive in a background daemon, so `pwsh`/`claude` processes pile up. The plugin closes every open terminal session when Orca quits normally (window **X** or tray → **Quit**). It cannot help if Orca is force-killed from Task Manager. Disable with `syzer orca config killShellsOnQuit off`.

## Install (Windows)

Requires Orca and [SyzerCLI](https://github.com/yasinbalcik/SyzerCLI) (the script installs it if missing).

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI-Orca/main/install.ps1 | iex
```

Manually: close Orca completely → `syzer orca install --shortcut` → start Orca from the **Orca (Syzer)** desktop shortcut. `syzer orca ...` downloads the latest plugin release from this repo and runs it, so there is nothing else to install.

## How it works

The patch is applied to Orca's `app.asar` (the original is backed up as `app.asar.syzer-orig`). A scheduled task (every 10 minutes and at logon) re-applies it while Orca is **closed**, e.g. after an Orca update. Patches are split into groups: a group that no longer matches a new Orca version is skipped, never half-applied. The patch marker changes whenever the patch source changes, so a stale patch cannot linger.

| Command | What it does |
|---|---|
| `syzer orca status` | patch state (version, applied/skipped groups) |
| `syzer orca patch [--dry-run]` | apply now (Orca must be closed) |
| `syzer orca restore` | go back to stock Orca |
| `syzer orca uninstall` | remove the scheduled task and shortcut |
| `syzer orca skip a,b` | debugging: skip groups (no argument: all enabled) |
| `syzer orca config killShellsOnQuit on\|off` | close terminals on quit |
| `syzer orca update` | download the latest plugin release |

Also works standalone: `node bin/syzer-orca.js <command>`. Logs: `~/.syzercli/orca/patch.log`, `quit.log`.

> A community patch, unaffiliated with the Orca team. Tested on Windows with Orca 1.4.x.

License: MIT
