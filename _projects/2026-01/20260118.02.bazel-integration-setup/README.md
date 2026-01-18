# Bazel Integration Setup

**Status**: 🚧 In Progress  
**Created**: 2026-01-18  
**Type**: Quick Project (1-2 sessions)

## Overview

Integrate Bazel build system into stigmer OSS repository matching the cloud version's structure and build approach.

## Goal

Set up Bazel build system with MODULE.bazel, BUILD.bazel files, and bazelw wrapper to match stigmer-cloud's build approach, enabling consistent builds across both repositories.

## Technology Stack

- **Build System**: Bazel
- **Languages**: Go (backend services), Python (agent-runner)
- **Tools**: Gazelle (automatic BUILD file generation)

## Affected Components

- Root level (MODULE.bazel, WORKSPACE, bazelw)
- `apis/` (BUILD.bazel files for proto generation)
- `backend/services/stigmer-server/` (Go service)
- `backend/libs/go/` (Go libraries)
- Agent-runner (if applicable)

## Success Criteria

- ✅ `./bazelw build //...` successfully builds all targets
- ✅ Proto generation works via Bazel
- ✅ Go services build via Bazel
- ✅ Gazelle generates BUILD files automatically
- ✅ Structure matches stigmer-cloud's Bazel setup
- ✅ Documentation updated with Bazel build instructions

## Tasks

See [tasks.md](tasks.md) for detailed task breakdown.

## Notes

See [notes.md](notes.md) for learnings and decisions made during implementation.

## Resume

To resume this project, drag [next-task.md](next-task.md) into any chat window.
