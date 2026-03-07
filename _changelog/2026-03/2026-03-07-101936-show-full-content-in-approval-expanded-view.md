# Show Full Content in Approval Expanded View

**Date**: March 7, 2026

## Summary

Enhanced the expanded approval view to show full, untruncated content for all tool types before the user makes their approval decision. Previously, shell/execute commands were truncated to 60 characters and MCP tools only showed the single largest argument value. Now the user sees everything they are approving.

## Problem Statement

When a tool call requires approval, the expanded view between the separators is the user's primary window into what they are about to approve. This view was incomplete for two tool categories.

### Pain Points

- **Shell/execute tools**: The command was only visible in the header line, truncated to 60 characters (e.g., `● Shell(cd /Users/.../agent-fleet && ...)`). The content body between the separators was empty because `resolveDisplayContent` returned nothing for shell tools with no Result yet. Long chained commands or complex scripts were impossible to review.
- **Unknown/MCP tools**: `ExpandedApprovalContent` used `extractLargestArg`, which returned only the raw value of whichever argument was longest. All other arguments — including their key names — were invisible. A tool with `{org: "default", target: "production", config: "<yaml>"}` would only show the YAML, with no indication of the org or target parameters.

## Solution

Targeted changes to `ExpandedApprovalContent` in `render_approval.go` to ensure every approval-gated tool shows its full context. The fix is scoped to the approval flow only — compact/collapsed rendering for completed tools is unchanged.

## Implementation Details

### Shell/Execute Tools

Added a fallback in `ExpandedApprovalContent`: when `resolveDisplayContent` returns empty (no Result yet) and the tool is a shell tool, extract the full command from `args["command"]`. This mirrors how write tools show their file content via `contentArgField`.

The fix is deliberately not in `toolDisplayMap` (adding `contentArgField: "command"`) because that would break completed shell tools with no output — they should show "(no output)", not the command text.

### Unknown/MCP Tools

Replaced `extractLargestArg(tc.Args)` with a new `formatExpandedArgs(tc.Args)` function that formats all arguments as key-value pairs without truncation:
- Short scalar values are shown inline: `org: "default"`
- Multi-line or long strings are shown with the key on its own line followed by the full value

### What remains unchanged

- **Write/Edit/Create**: Already showed full file content from args — no change needed
- **Delete**: Only has a path (shown in header) with no content body — correct as-is
- **Approval question line**: Still truncated — fine for a single-line prompt
- **Post-approval collapsed view**: Still truncated — appropriate for the compact display

## Benefits

- Users can review the exact command being executed before approving shell tools
- Users can see all parameters being passed to MCP/third-party tools
- Approval decisions are now fully informed across all tool types
- No change to compact post-approval display — keeps the timeline clean

## Impact

Affects the CLI approval flow for all users. The expanded view (between separators) before the approval prompt now shows complete content for shell and MCP tools. No behavioral changes to non-interactive mode, collapsed views, or post-approval rendering.

---

**Status**: ✅ Production Ready
