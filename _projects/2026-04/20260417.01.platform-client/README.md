# Project: 20260417.01.platform-client

## Overview
Add PlatformClient IAM resource with OAuth2 client_id + client_secret credentials, a token endpoint (POST /oauth/token), and user token minting so platform builders can embed Stigmer React components in browser apps without OIDC federation setup. Follows the industry-standard pattern used by Twilio, Stream, Liveblocks, and Knock.

**Created**: 2026-04-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable platform builders to embed Stigmer in their browser apps with minimal friction: create a PlatformClient, call the token endpoint from their backend with user identity, and use the returned token in the React SDK via getAccessToken. Users are auto-provisioned on first encounter (reusing JIT provisioning machinery).

### Timeline
**Target Completion**: 3 weeks

### Technology Stack
Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), React (Console UI), MDX (docs)

### Project Type
Feature Development

### Affected Components
PlatformClient proto (stigmer), token endpoint REST controller (stigmer-cloud), PlatformClientTokenAuthenticationProvider (stigmer-cloud), JIT provisioning reuse (stigmer-cloud), Node/Go/Python SDK auth config (stigmer), React components for PlatformClient CRUD (stigmer), Console pages (stigmer), federation/SDK docs (stigmer)

## Project Context

### Dependencies
Changes span two repos: stigmer (protos, SDK, docs, UI) and stigmer-cloud (Java service implementation). Proto changes in stigmer must be published before stigmer-cloud can consume them. Depends on existing JIT provisioning machinery (FederatedAutoProvisioner) from the 20260416.01.jit-provisioning project.

### Success Criteria
- Platform builder can create a PlatformClient in the Console, get `client_id` + `client_secret`, call `POST /oauth/token` from their backend with user identity, receive a short-lived token, and use it in the React SDK via `getAccessToken`
- Unknown users are auto-provisioned on first token request (reusing JIT provisioning machinery)
- All three auth paths (API key, PlatformClient, Federation) coexist cleanly in the auth chain
- SDK supports `clientId` + `clientSecret` as a new auth option in Node, Go, and Python
- Documentation includes a quick-start guide demonstrating a 5-minute integration

### Known Risks & Mitigations
New REST endpoint (POST /oauth/token) outside the existing gRPC framework requires separate routing and security configuration. Stigmer-signed JWT issuance introduces a new signing key that must be managed securely. Token replay and abuse vectors need rate limiting. Cross-repo coordination between stigmer and stigmer-cloud for proto changes.

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