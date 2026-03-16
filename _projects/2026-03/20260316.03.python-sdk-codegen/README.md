# 20260316.03.python-sdk-codegen

## Overview
Generate a Stripe-style Python SDK for all Stigmer API resources using the same codegen pipeline as Go, TypeScript, and Java SDKs. Publish to PyPI.

**Created**: 2026-03-16  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Python SDK with Stripe-style API surface (client.agents.create(input)) for all 17 resources, driven by the existing proto2schema + generator codegen pipeline, published as stigmer-python to PyPI

## Technology Stack
Python 3.11+, gRPC-Python (grpcio), pyproject.toml, Go codegen tooling, Buf, GitHub Actions

## Affected Components
tools/codegen/generator (new sdk_client_python.go), sdk/python (Python package), apis/stubs/python (existing proto stubs), .github/workflows (PyPI publishing)

## Success Criteria
- `sdk_client_python.go` generates client modules for all 17 resources from service schemas
- `sdk/python/` is an installable Python package with `StigmerClient` as the entry point
- `pip install -e sdk/python/` works and all generated code imports cleanly
- `make protos` chains Python SDK codegen alongside Go, TS, and Java
- PyPI publishing is set up with Trusted Publisher (OIDC) and GitHub Actions
- `pip install stigmer` is the end-user install command
- Example code runs and demonstrates CRUD + streaming patterns

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Relationship to Existing SDK Work

This project is the fourth language in the codegen-driven SDK family:
- **Go SDK**: `sdk/go/` — production ready
- **TypeScript SDK**: `sdk/typescript/` — codegen generator exists, scaffolding in progress
- **Java SDK**: `sdk/java/` — quick project `20260316.02.java-sdk-codegen`
- **Python SDK**: `sdk/python/` — this project

### Advantage: Python proto stubs already exist
Unlike Java (which needs new buf config), Python proto stubs are already generated at `apis/stubs/python/stigmer/` with their own `pyproject.toml`. The SDK just needs to depend on `stigmer-stubs`.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

- Current phase: Not started
- Blockers: None
- Next up: Task 1 (Python codegen generator)

## Notes Summary

Key learnings, design decisions, and PyPI publishing guide are in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

