# Workflow Examples Status

This document tracks the status of workflow examples.

## Current Examples

### ✅ 07_basic_workflow.go
- **Status**: Current, uses stigmer.Run() API
- **Features**: HTTP GET, task field references, implicit dependencies
- **API**: stigmer.Run(), wf.HttpGet(), task.Field()
- **Recommended**: ⭐ **START HERE** for learning workflows

### ✅ 08_agent_with_typed_context.go
- **Status**: Current, uses stigmer.Run() API
- **Features**: Agent with typed context variables
- **API**: stigmer.Run(), agent.New()

### ✅ 09_workflow_and_agent_shared_context.go
- **Status**: Current, uses stigmer.Run() API
- **Features**: Workflow and agent sharing configuration
- **API**: stigmer.Run(), ctx shared between workflow and agent

## Summary

All workflow examples now use the modern `stigmer.Run()` API pattern with:
- `agent.New(ctx, ...)` - Clean API, context as first parameter
- `workflow.New(ctx, ...)` - Clean API, context as first parameter
- Automatic synthesis when stigmer.Run() completes

No legacy examples remain.

---

*Last Updated: 2026-01-17*
