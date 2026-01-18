# Agent Runner Documentation Index

## Overview

This directory contains comprehensive documentation for implementing and maintaining the agent-runner service. Documentation is organized by topic for easy lookup.

## 📚 Documentation Catalog

### ⚠️ Critical - Read First

1. **[Proto Imports](proto-imports.md)** ⚠️ **READ THIS FIRST**
   - Stub generation and import paths
   - Common import errors and fixes
   - PYTHONPATH configuration

2. **[Temporal Patterns](temporal-patterns.md)** ⚠️ **ACTIVITY REGISTRATION**
   - Activity decorator patterns
   - Registration in worker
   - Async/await patterns

3. **[gRPC Clients](grpc-clients.md)** ⚠️ **AUTHENTICATION & INTERCEPTORS**
   - Client setup with interceptors
   - Auth0 machine account patterns
   - SSL/TLS configuration

4. **[Sandbox Lifecycle](sandbox-lifecycle.md)** ⚠️ **SESSION-BASED REUSE**
   - Session-based sandbox management
   - Health checking and fallback
   - Cost optimization patterns

### Implementation Guides

5. **[Activity Implementation](activity-implementation.md)**
   - Creating new Temporal activities
   - Proto message handling
   - Error handling in activities

6. **[Error Handling](error-handling.md)**
   - Exception patterns
   - Execution status updates
   - Logging best practices

7. **[Event Streaming](event-streaming.md)**
   - Processing astream_events
   - Tool call tracking
   - Message updates

8. **[Token Management](token-management.md)**
   - User token flow (Redis)
   - Machine account tokens (Auth0)
   - Token rotation patterns

9. **[Configuration](configuration.md)**
   - Environment variables
   - Config dataclass patterns
   - Validation and defaults

### Learning & Evolution

10. **[Learning Log](learning-log.md)** 📖 **CHECK BEFORE IMPLEMENTING**
    - All discoveries and fixes
    - Organized by topic
    - Real-world solutions

11. **[Improvements History](improvements.md)**
    - Rule evolution timeline
    - Major pattern changes
    - Lessons learned

## 🎯 Quick Lookup by Problem

### "Import Error: No module named 'ai.stigmer'"
→ See [Proto Imports](proto-imports.md) - Stub Generation

### "Cannot connect to Temporal"
→ See [Temporal Patterns](temporal-patterns.md) - Connection Setup

### "gRPC UNAUTHENTICATED error"
→ See [gRPC Clients](grpc-clients.md) - Auth0 Configuration

### "Sandbox creation timeout"
→ See [Sandbox Lifecycle](sandbox-lifecycle.md) - Health Checking

### "Redis connection failed"
→ See [Token Management](token-management.md) - Redis Configuration

### "Activity execution failed"
→ See [Error Handling](error-handling.md) - Exception Patterns

### "Event stream not processing"
→ See [Event Streaming](event-streaming.md) - Stream Debugging

## 📋 Documentation Standards

### When to Create New Docs

Create a new reference doc when:
- A new major feature area is added (e.g., "MCP Resolution")
- A topic has 5+ entries in learning log
- Patterns are complex enough to need dedicated explanation

### When to Update Existing Docs

Update existing docs when:
- Patterns change or improve
- New edge cases discovered
- Better examples found in real code
- Errors in current documentation

### When to Add to Learning Log

Add to learning log when:
- You fixed a non-obvious issue
- You discovered a new pattern
- You solved something that took >30 minutes
- You want to save others from the same problem

## 🔄 Self-Improvement Process

1. **Check First**: Always check learning log before solving a problem
2. **Document Discoveries**: Add new learnings to appropriate topic
3. **Update References**: Enhance reference docs with examples
4. **Improve Rule**: Invoke `@improve-this-rule.mdc` if patterns change
5. **Commit Changes**: Use `@complete-stigmer-work.mdc` to finalize

## 📊 Documentation Coverage

Current topics covered:
- ✅ Proto imports and stubs
- ✅ Temporal activities
- ✅ gRPC clients and auth
- ✅ Sandbox management
- ✅ Error handling
- ✅ Token management
- ⏳ MCP resolution (TODO)
- ⏳ Sub-agent delegation (TODO)
- ⏳ Performance optimization (TODO)

## 🎓 Learning Philosophy

**These docs are living knowledge bases**, not static references:

- **Grow organically** as we discover patterns
- **Evolve continuously** as implementations improve
- **Capture real problems** with real solutions
- **Save time** by preventing repeated issues

**Remember**: Every error you solve, every pattern you discover, every optimization you make should be documented here for the next developer (which might be you in 3 months).

## Related Files

- Main Rule: `../implement-agent-runner-features.mdc`
- Improvement Rule: `../improve-this-rule.mdc`
- Service Code: `../../../worker/`, `../../../grpc_client/`
