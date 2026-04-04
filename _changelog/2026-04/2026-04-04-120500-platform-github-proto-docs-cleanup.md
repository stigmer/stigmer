# Platform GitHub Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Restructured proto comments in the platform/github service to follow the `@internal` convention established by the agent resource, separating SDK-facing descriptions from implementation details. Improved message and field comments to be SDK-user-focused.

## Problem Statement

The GitHubService proto (`apis/ai/stigmer/platform/github/v1/service.proto`) had thorough documentation but did not follow the `@internal` convention used across all other Stigmer proto packages. SDK-facing and internal details were mixed in every comment, and message descriptions used abstract proto-role language rather than SDK-consumer-oriented phrasing.

### Pain Points

- Service comment mixed implementation details (client_secret handling, token non-persistence) with SDK-facing content
- RPC comments embedded backend mechanics (CSRF construction, secret protection) without `@internal` separation
- Message comments described the proto's role ("Request to get...") instead of what the SDK user provides or receives

## Solution

Applied the same `@internal` convention used in agent, session, skill, and all other Stigmer resources. Rewrote message and field comments from the perspective of an SDK consumer.

## Implementation Details

### Service comment
Separated into SDK-facing description ("Use this service to connect a GitHub account via OAuth...") and `@internal` block for platform utility classification, secret protection, and token lifecycle details.

### RPC comments
Both `getOAuthAuthorizeUrl` and `exchangeOAuthCode` restructured: first sentence as a standalone verb-led summary, SDK-facing usage context, then `@internal` for backend mechanics (authorization skip reasoning, secret handling, storage responsibility).

### Message and field comments
All four messages rewritten from passive proto-role descriptions to SDK-user-focused language. Field comments for `redirect_uri` moved registration constraints behind `@internal`.

### Pipeline decision
Confirmed that the platform namespace stays outside the SDK docs generation pipeline — this is an internal utility service, not a domain resource. The proto comment improvements serve internal developers reading the source.

## Benefits

- Proto comments now follow the same `@internal` convention as every other Stigmer resource
- If platform is ever added to the SDK docs pipeline, comments are already structured correctly
- Internal developers can distinguish SDK-facing from implementation-only documentation

## Impact

- **Files modified**: 1 (`apis/ai/stigmer/platform/github/v1/service.proto`)
- **Scope**: Documentation refinement only — no functional changes

## Related Work

- Prior sessions cleaned up agent, agentexecution, agentinstance, environment, executioncontext, session, skill, mcpserver, iam, commons, workflow, organization, and project protos
- SDK docs auto-generation pipeline (proto2schema + sdk_docs.go)

---

**Status**: Production Ready
