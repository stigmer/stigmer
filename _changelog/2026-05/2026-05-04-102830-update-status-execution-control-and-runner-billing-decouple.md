# Agent execution: control signals from `updateStatus` and runner billing decoupling

**Date**: May 4, 2026

## Summary

The `updateStatus` RPC now returns an `UpdateStatusResponse` carrying an `ExecutionControlSignal` so the platform can tell runners to stop or warn without a separate billing client on the runner. Python (agent-runner / graphton) and TypeScript (cursor-runner) no longer call billing over gRPC from the runner process; graceful shutdown is driven from the status round-trip. Stubs and SDKs were regenerated across Go, Python, TypeScript, and Java.

## Problem Statement

Runners previously depended on a dedicated billing client to learn when to stop for quota or policy reasons. That split responsibility across two channels and complicated OSS packaging. Product direction is to centralize billing and policy reactions on the server path that already merges execution state.

### Pain Points

- Duplicate client surfaces (agent execution + billing) on runners
- Harder to reason about stop conditions in OSS-only deployments
- Tight coupling between runner code and billing transport

## Solution

Extend the agent execution API so `updateStatus` returns structured control metadata (`UpdateStatusResponse` / `ExecutionControlSignal`). Runners interpret `STOP` / `WARNING` (and related values) from that response and stop streaming accordingly. Billing-side effects remain a cloud concern on the `updateStatus` handler path (OSS server returns a neutral response).

## Implementation Details

- **Protos**: `command.proto`, `enum.proto`, `io.proto` — new messages/enums; `updateStatus` return type updated; codegen run for stubs (Go, Java, Python, TS), MCP server copies, embedded CLI copies, `tools/codegen/schemas`, SDKs.
- **Python**: Removed `billing_stop` usage pattern; added `graceful_stop` middleware; `AgentExecutionClient.update_status` returns parsed response; streaming respects platform signal; tests adjusted (`test_graceful_stop`, billing reporter test cleanup).
- **TypeScript cursor-runner**: Removed `billing-client` and its tests; `execute-cursor` and `stigmer-client` wired to new return type and stop behavior.
- **Go `stigmer-server`**: `update_status` handler returns `UpdateStatusResponse`.
- **Docs / site**: React SDK docs updates (`execution`, `composer`, `core`, resources), new `billing.mdx` and `identity-account.mdx` under `docs/sdk/react/`, site summary and lockfile refresh.
- **Model registry**: Synced JSON copies under graphton, cursor-runner, and `sdk/react` where the pipeline updates them.
- **Tests**: `model-pricing.test.ts` fixture updated with required `costTier` on `CursorModelPricing` (aligns with registry typing).

## Benefits

- Single control channel for persistence + platform signals
- Smaller runner dependency surface in OSS
- Clearer contract for “stop” semantics across languages

## Impact

- **API**: Breaking change for `updateStatus` consumers (return type); SDKs regenerated.
- **Runners**: Must handle `UpdateStatusResponse`; billing gRPC removed from runner packages.
- **Docs**: SDK and resource documentation reflects new flows and billing-related React guidance.

## Related Work

- Cloud `stigmer-service` Java handler changes (separate repo) consume the same proto contract for billing on the server path.
- Auth0 webhook cleanup project `next-task.md` clarification for `useIdentityAccountGate` vs Planton federated provisioning.

---

**Status**: Production ready (OSS); cloud billing wiring may still have follow-ups
**Timeline**: Multi-session refactor consolidated in this commit batch
