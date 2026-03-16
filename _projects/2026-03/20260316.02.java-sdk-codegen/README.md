# 20260316.02.java-sdk-codegen

## Overview
Generate a Stripe-style Java SDK for all Stigmer API resources using the same codegen pipeline as the Go and TypeScript SDKs. Publish to Maven Central.

**Created**: 2026-03-16  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Java SDK with Stripe-style API surface (StigmerClient → client.agents().create(input)) for all 17 resources, driven by the existing proto2schema + generator codegen pipeline, published as ai.stigmer:stigmer-java to Maven Central

## Technology Stack
Java 17+, gRPC-Java, Maven, Go codegen tooling, Buf, GitHub Actions

## Affected Components
tools/codegen/generator (new sdk_client_java.go), sdk/java (Maven project), apis (Java proto stubs via buf.gen.java.yaml), .github/workflows (Maven publishing)

## Success Criteria
- `buf generate --template buf.gen.java.yaml` produces Java proto stubs for all services
- `sdk_client_java.go` generates client classes for all 17 resources from service schemas
- `sdk/java/` is a compilable Maven project with `StigmerClient` as the entry point
- `make protos` chains Java stubs + Java SDK codegen alongside Go and TS
- Maven Central publishing is documented with pom.xml metadata, GPG signing, and GitHub Actions workflow
- Example code compiles and demonstrates CRUD + streaming patterns

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Relationship to Existing SDK Work

This project is a direct extension of the Go SDK codegen work completed on 2026-03-16:
- **Go SDK**: `sdk/go/` — Stripe-style, codegen-driven, production ready
- **TypeScript SDK**: `sdk/typescript/` — codegen generator exists (`sdk_client_ts.go`), SDK scaffolding in progress
- **Java SDK**: `sdk/java/` — this project

All three SDKs share Stage 1 of the codegen pipeline (`proto2schema` → JSON schemas). Only the Stage 2 generator and the language-specific SDK scaffolding differ per language.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

- Current phase: Not started
- Blockers: None
- Next up: Task 1 (Java proto stubs via Buf)

## Notes Summary

Key learnings, design decisions, and Maven Central publishing guide are in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

