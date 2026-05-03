# Session Notes: 2026-05-03 — Phase 2.5+2.6 (Runner + Workflow Integration)

## Accomplishments

- Implemented full billing execution lifecycle in the Temporal workflow (authorize before dispatch, finalize after completion)
- Wired per-LLM-call billing reporting into the Python agent-runner (via StatusBuilder.process_event)
- Wired per-turn billing reporting into the TypeScript cursor-runner (via streaming loop)
- Implemented graceful stop mechanisms for both runners when billing signals STOP
- Created comprehensive unit tests across all three languages

## Decisions Made

1. **Phase ordering**: Phase 2.6 (Temporal) first because `reportLlmCallUsage` resolves org_id from the reservation document — authorize must run before any reporting
2. **Cursor stop mechanism**: Break from streaming loop on STOP + early return with billing-exhausted status (preToolUse hooks are static files, can't be modified mid-execution)
3. **Billing is best-effort from runner perspective**: If the RPC fails, execution continues — the reservation caps financial exposure
4. **Global billing sequence**: Unlike UsageTracker's per-scope sequence, billing uses a single global counter across main + sub-agent calls
5. **BillingStopMiddleware is always injected**: Separate from CostCapMiddleware (which is optional/user-configured) — platform enforcement vs user budget

## Key Code Changes

### stigmer-cloud (Java)
- `InvokeAgentExecutionWorkflowInput.java`: Added `orgId` field
- `BillingActivities.java`: New Temporal activity interface (authorize + finalize)
- `BillingActivitiesImpl.java`: Delegates to `ExecutionBillingService`
- `InvokeAgentExecutionWorkflowImpl.java`: Authorization gate + finalization in detached scope
- `AgentExecutionTemporalWorkerConfig.java`: Registered billing activities with worker

### stigmer (Python)
- `billing_client.py`: New `BillingReporter` gRPC client
- `billing_stop.py`: New `BillingStopMiddleware` (graphton library)
- `agent.py`: Injected BillingStopMiddleware + exposed via `_graphton_billing_stop`
- `status_builder.py`: Added `_report_billing_usage()` post-processing hook
- `setup.py`: Wired BillingReporter onto StatusBuilder

### stigmer (TypeScript)
- `billing-client.ts`: New `BillingClient` (Connect-RPC)
- `model-pricing-data.ts`: Added `costTier` field
- `model-pricing.ts`: Updated DEFAULT_PRICING with costTier
- `execute-cursor.ts`: Billing reporting in stream loop + exhaustion handling
- `stigmer-client.ts`: Made transport readonly (accessible to BillingClient)

## Open Questions for Next Session

1. **Sub-agent billing sequence**: The current implementation uses `len(all_calls_across_scopes)` as the billing sequence. This is correct but could be expensive if there are many calls. Consider caching the counter.
2. **Cursor SDK hook dynamism**: Confirmed that hooks are static (written once before send). The fallback (break from stream loop) is the correct approach.
3. **End-to-end testing**: Phase 2 is now feature-complete. Consider an integration test that runs authorize → report × N → finalize with a real MongoDB.

## Next Session Plan

- Phase 3: Stripe Credit Purchases
  - Start with Stripe Customer creation per org
  - Implement Checkout Session creation
  - Build webhook handler for credit provisioning
  - Or: Run end-to-end integration tests for Phase 2 first
