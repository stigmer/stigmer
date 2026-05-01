# Fix Cursor Runner Default Model Compatibility

**Date:** 2026-05-01
**Scope:** backend/services/cursor-runner

## Problem

The cursor-runner hardcoded `"composer-2"` as the fallback model when the
execution spec did not specify a model name. After the platform Cursor API
key was rotated from an Admin API key to an MCP integration key, agent runs
began failing immediately (RUNNING -> ERROR, zero content events) because
the MCP key does not support the `composer-2` model.

## Root Cause

The Cursor Dashboard issues different API key types with different model
access. The MCP integration key (generated from the Integrations/MCP tab)
does not include `composer-2` in its supported models. With the previous
Admin API key, `composer-2` was available; after the rotation, it was not.

## Fix

Changed the default model fallback from `"composer-2"` to `"default"` in
`execute-cursor.ts`. The `"default"` model identifier tells the Cursor API
to use whatever model the key is authorized for, making the runner
compatible with any valid Cursor API key type. Executions that explicitly
specify a model via `executionConfig.modelName` are unaffected.

## Files Changed

- `backend/services/cursor-runner/src/activity/execute-cursor.ts`
