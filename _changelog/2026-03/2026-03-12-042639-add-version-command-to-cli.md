# Add `version` Command to Stigmer CLI

**Date**: March 12, 2026

## Summary

Added a `stigmer version` command so users can quickly check which version of the CLI they're running. The command prints the build version injected at compile time via ldflags, defaulting to `dev` for local builds.

## Problem Statement

The Stigmer CLI had no user-facing way to check its version. While `embedded.GetBuildVersion()` existed internally for agent execution metadata and binary extraction checks, there was no corresponding CLI command exposing this information.

### Pain Points

- Users couldn't verify which CLI version was installed
- Debugging and support conversations required workarounds to identify the running version
- Standard CLI expectation (`<tool> version`) was missing

## Solution

Created a new `version` subcommand under the "Configuration" command group, reusing the existing `embedded.GetBuildVersion()` function.

## Implementation Details

- **`client-apps/cli/cmd/stigmer/root/version.go`** — new `NewVersionCommand()` returning a cobra command that prints the build version to stdout
- **`client-apps/cli/cmd/stigmer/root.go`** — registered the command in the "config" group alongside `config` and `completion`

## Benefits

- Users can run `stigmer version` to see the installed version
- Consistent with CLI conventions across the ecosystem
- Zero new dependencies — reuses the existing `embedded` package

## Impact

All Stigmer CLI users gain a standard way to check version information, improving supportability and self-service debugging.

---

**Status**: ✅ Production Ready
