# Checkpoint: Agent-Runner Ollama Connection Regression Fixed

**Date**: 2026-01-25  
**Type**: Bug Fix (Critical Regression)  
**Status**: ✅ Complete

## What Was Fixed

Fixed critical regression where agent-runner could not connect to Ollama after daemon restart, causing all agent executions to fail with "All connection attempts failed".

## Root Cause

Supervisor was only setting `STIGMER_LLM_BASE_URL` environment variable but not `OLLAMA_BASE_URL` (which the agent-runner code actually reads), causing connection to fall back to `localhost:11434` which fails from Docker container.

## Solution

Added missing `OLLAMA_BASE_URL` environment variable to supervisor's Docker container configuration.

## Verification

- ✅ Both environment variables now set correctly
- ✅ Agent-runner connects to Ollama successfully  
- ✅ E2E tests passing (TestRunBasicAgent: 21.43s, TestRunFullAgent: 10.50s)
- ✅ Agent execution works end-to-end

## Files Changed

- `backend/services/stigmer-server/pkg/supervisor/supervisor.go` - Added OLLAMA_BASE_URL env var

## Related

- Original fix: `_changelog/2026-01/2026-01-22-051454-fix-ollama-langchain-explicit-base-url.md`
- This was a regression from that fix (supervisor code didn't have both variables)
