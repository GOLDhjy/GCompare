# GCompare

[![Build](https://github.com/GOLDhjy/GCompare/actions/workflows/release.yml/badge.svg)](https://github.com/GOLDhjy/GCompare/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/GOLDhjy/GCompare)](https://github.com/GOLDhjy/GCompare/releases)
[![Downloads](https://img.shields.io/github/downloads/GOLDhjy/GCompare/total)](https://github.com/GOLDhjy/GCompare/releases)
[![Stars](https://img.shields.io/github/stars/GOLDhjy/GCompare)](https://github.com/GOLDhjy/GCompare/stargazers)
[![License](https://img.shields.io/github/license/GOLDhjy/GCompare)](LICENSE)

![GCompare v0.1.0](./public/Images/v0.1.0.png)

English README. 中文版: [README.md](README.md)

GCompare is a cross-platform text/file diff tool built with Tauri v2. It focuses on a lightweight, offline-first workflow for developers.

## Features
- Text diffing (Monaco diffEditor)
- Local file compare (open or drag-and-drop)
- System “Open with” associations for common text/code types
- Inline / Side-by-side switch
- Diff navigation (previous/next)
- Theme settings (system / light / dark)
- Git/P4 history panel: commit/changelist list + single-file compare (via git/p4 CLI)

## Download
See Releases:  
https://github.com/GOLDhjy/GCompare/releases

## Usage
- Open left/right file: buttons or shortcuts
- Drag files: drop on left/right side
- Open with: use “Open with GCompare”
- Switch view: use the Inline toggle
- Diff navigation: use the ↑ / ↓ buttons
- Git/P4 history: hover the History tab, click a commit/changelist to compare (Git first)
- Pin history panel: click Pin

## Shortcuts
- Open left: Ctrl/Cmd + O
- Open right: Ctrl/Cmd + Shift + O
- Toggle view: Ctrl/Cmd + 1 / 2

## Development
Requirements: Node.js, Rust, Tauri dependencies

```bash
npm install
npm run tauri dev
```

## Roadmap

### Done ✅
- Text diffing (Monaco diffEditor)
- Local file compare (open or drag-and-drop)
- System "Open with" associations for common text/code types
- Inline / Side-by-side switch
- Diff navigation: previous/next change
- Dark/Light theme toggle
- Git/P4 integration: single-file history compare (via git/p4 CLI, Git first)

### Planned 🚧
- Search: Find and highlight in diffs
- Paste text compare

## License
MIT License
