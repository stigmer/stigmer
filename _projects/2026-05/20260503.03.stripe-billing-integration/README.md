# Project: 20260503.03.stripe-billing-integration

## Overview
Implement a prepaid credit-based billing system for Stigmer Cloud with Stripe integration. Customers purchase credits upfront via Stripe Checkout and consume them as their AI agents execute. Includes a custom MongoDB credit ledger, versioned pricing policies with per-harness/per-tier margins, execution reservation and per-LLM-call debit enforcement, auto-recharge via saved payment methods, usage dashboards, and enterprise invoicing.

**Created**: 2026-05-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Ship a production-ready, cloud-only prepaid billing system that enables Stigmer to monetize AI agent execution usage with transparent pricing, real-time credit enforcement, and Stripe-powered payment processing.

### Timeline
**Target Completion**: 2 months

### Technology Stack
Java 21/Spring Boot (stigmer-service), MongoDB, Stripe API, gRPC/Connect, Temporal, Python (agent-runner integration), TypeScript/React (billing UI)

### Project Type
Feature Development

### Affected Components
stigmer-cloud billing bounded context (new), stigmer-service domain handlers, MongoDB collections, Stripe webhook integration, agent-runner UsageTracker billing hooks, web console billing pages, proto definitions (apis/), model-registry.json pricing policy

## Project Context

### Dependencies
Stripe account and API keys, Stripe Tax product, existing UsageTracker and CostCapMiddleware in agent-runner, existing model-registry.json, existing usage report RPCs

### Success Criteria
- Orgs can purchase credit packs via Stripe Checkout; credits are deducted in real-time per LLM call during agent execution; executions are blocked when credits are exhausted; auto-recharge works with saved payment methods; billing dashboard shows balance
- spend
- and per-agent breakdown; enterprise orgs can use invoiced billing; all ledger operations are idempotent and auditable.

### Known Risks & Mitigations
Double-crediting on Stripe webhook retries, execution overrun beyond reserved credits, Cursor Harness cost attribution uncertainty, floating-point rounding drift in ledger, tax jurisdiction complexity for prepaid credits, revenue recognition compliance

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