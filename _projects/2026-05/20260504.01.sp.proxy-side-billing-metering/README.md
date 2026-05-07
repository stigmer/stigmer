# Sub-Project: 20260504.01.sp.proxy-side-billing-metering

## Parent Project

- **Parent**: 20260503.03.stripe-billing-integration
- **Parent Path**: [../../20260503.03.stripe-billing-integration/](../../20260503.03.stripe-billing-integration/)
- **Spawned From Task**: N/A

---

## Overview
Secure LLM billing by adding server-side usage metering in the proxy layer. The LLM and Cursor proxy controllers parse SSE responses to extract token usage, then call ExecutionBillingService in-process to debit credits — replacing the current runner-attested billing data with tamper-proof proxy-observed usage. Includes stripping runner llm_metrics in cloud mode, dual-header proxy access control (execution_id + mcp_server_id), and caching for classify_tool_approvals.

**Created**: 2026-05-04
**Status**: Active

## Sub-Project Information

### Goal
Ship tamper-proof billing metering with zero runner code changes (aside from passing mcp_server_id through the classify workflow). All changes in stigmer-cloud — SSE parsing in proxy controllers, wiring to ExecutionBillingService, llm_metrics stripping in updateStatus handler, and dual-header enforcement.

### Technology Stack
Java 21/Spring Boot (stigmer-service), MongoDB, Stripe API, gRPC/Connect, Temporal, Python (agent-runner integration), TypeScript/React (billing UI)

### Project Type
Feature Development

### Affected Components
stigmer-cloud billing bounded context (new), stigmer-service domain handlers, MongoDB collections, Stripe webhook integration, agent-runner UsageTracker billing hooks, web console billing pages, proto definitions (apis/), model-registry.json pricing policy

### Additional Context
Architecture plan finalized in plan file: secure_billing_metering_344ab189.plan.md. Key files: LlmProxyController.java, CursorProxyController.java, AgentExecutionUpdateStatusHandler.java, ExecutionBillingService.java. The existing ReportLlmCallUsage gRPC RPC (called by runner) is deprecated — the proxy calls the same service method in-process.

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260503.03.stripe-billing-integration/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
