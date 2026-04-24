# Project: 20260423.03.stigmer-desktop-app

## Overview
Build the Stigmer Desktop application using Tauri (Rust shell + React web frontend). The desktop app provides the full Stigmer web console experience in a native application — sessions, agents, runner management, settings — plus native OS integration: stigmer:// URL scheme handling, system tray with runner status, background runner process management, and native notifications. Uses the existing @stigmer/react SDK and @stigmer/typescript SDK directly — no new SDK needed.

**Created**: 2026-04-23
**Status**: Active 🟢

## Project Information

### Primary Goal
Ship a Stigmer Desktop application that provides the complete web console experience natively on macOS, Linux, and Windows. The app handles stigmer:// URL scheme for browser-initiated runner launches, shows runner status in the system tray, manages background runner processes, and auto-updates. Distributed via website download (.dmg, .msi, .AppImage) and package managers (Homebrew, winget).

### Timeline
**Target Completion**: 4-6 weeks

### Technology Stack
Tauri 2.x (Rust), TypeScript/React (@stigmer/react SDK, @stigmer/typescript SDK), Go (CLI binary bundled as sidecar for runner process management)

### Project Type
Feature Development

### Affected Components
New: client-apps/desktop (Tauri app shell, system tray, URL handler, auto-updater, installers). Reuses: sdk/react (all UI components — SessionComposer, RunnerPicker, RunnerListPanel, etc.), sdk/typescript (all API clients), client-apps/web (reference for page routing and layout). Bundled: client-apps/cli binary as sidecar for agent-runner process management.

## Project Context

### Dependencies
Phase 3 persistent-runners-browser-launch project (launch token endpoints, stigmer:// flow design). @stigmer/react SDK must be stable (web-sdk-architecture-standards project in progress). Runner command stream complete (bidi stream exists). Tauri 2.x stable release.

### Success Criteria
- Desktop app installs on macOS/Linux/Windows via download or package manager
- Full web console experience available natively (sessions/agents/runners/settings)
- stigmer:// URL scheme handled by desktop app
- System tray shows runner status and quick actions
- Runner processes managed in background
- Auto-update works without user intervention
- App size under 50MB (Tauri target)

### Known Risks & Mitigations
Tauri 2.x maturity — some edge cases on Linux window managers. Cross-platform build pipeline complexity (macOS notarization, Windows code signing). Bundling Go CLI sidecar adds build complexity. System tray behavior varies across Linux desktop environments. Auto-update requires hosting infrastructure for update manifests.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._