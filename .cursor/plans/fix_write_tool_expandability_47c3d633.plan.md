---
name: Fix Write Tool Expandability
overview: "The Write tool (and other non-read tools) in the execution TUI cannot be expanded because of two independent bugs: (1) running tool blocks finalized via DoneEvent are never converted to expandable blocks, and (2) write tools have no preview/expanded content configured."
todos:
  - id: store-toolcall-on-blocks
    content: Add toolCall field to contentBlock and update newRunningToolBlock to store ToolCallInfo
    status: completed
  - id: fix-done-finalization
    content: Fix DoneEvent and StreamErrorEvent finalization to create expandable blocks using stored ToolCallInfo
    status: in_progress
  - id: add-content-arg-fields
    content: Add contentArgField/contentArgFallbacks to toolDisplayInfo and configure write tool entries with previewFileContent
    status: pending
  - id: resolve-display-content
    content: Add resolveDisplayContent helper and update renderKnown, renderKnownHeader, and RenderExpanded to use it
    status: pending
  - id: verify-build
    content: Run go build to verify changes compile and existing tests pass
    status: pending
isProject: false
---

# Fix Write Tool Expandability in Execution TUI

## Problem Analysis

There are **two independent bugs** preventing the Write tool (and similar tools) from being expandable:

### Bug 1: Running tools finalized via DoneEvent are never expandable

When execution completes, any tools still tracked as "running" are finalized in the `DoneEvent` handler by simply replacing the spinner emoji with a checkmark:

```58:69:client-apps/cli/pkg/executiontui/handle_events.go
	case ToolCompletedEvent:
		tc := e.ToolCall
		preview := renderToolResultPreview("", []toolrender.ToolCallInfo{tc})
		full := renderToolResultExpanded("", []toolrender.ToolCallInfo{tc})
		if idx, ok := m.runningTools[e.ToolCallID]; ok && idx < len(m.blocks) {
			// Replace the running block in-place with the final expandable result.
			m.blocks[idx] = newToolCallBlock(preview, full)
			delete(m.runningTools, e.ToolCallID)
		} else {
			// Safety fallback: if no running block was tracked, append new block.
			m.blocks = append(m.blocks, newToolCallBlock(preview, full))
		}
```

vs. the DoneEvent finalization:

```106:112:client-apps/cli/pkg/executiontui/handle_events.go
		for _, idx := range m.runningTools {
			if idx < len(m.blocks) {
				m.blocks[idx].content = renderToolFinalized(m.blocks[idx].content)
			}
		}
		m.runningTools = make(map[string]int)
```

The DoneEvent path only does string replacement (`renderToolFinalized` replaces the hourglass with a checkmark) but **never converts the block to an expandable `newToolCallBlock**`. The block remains a `newRunningToolBlock`, which has `expandable: false`.

This is why Write blocks show a checkmark but no expand arrow -- the `ToolCompletedEvent` for the last tool often races with (or never arrives before) `DoneEvent`.

### Bug 2: Write tools have no preview or expanded content

Even when a Write tool does go through the proper `ToolCompletedEvent` path, it is configured with `previewNone`:

```121:124:client-apps/cli/pkg/toolrender/render.go
	"write":          {icon: "📝", label: "Write", primaryField: "path"},
	"write_file":     {icon: "📝", label: "Write", primaryField: "path"},
	"create_file":    {icon: "📝", label: "Create", primaryField: "path"},
	"overwrite_file": {icon: "📝", label: "Write", primaryField: "path"},
```

No `preview` field means `previewNone`. The collapsed view shows only the header. The expanded view via `RenderExpanded` would show content IF `tc.Result` is non-empty, but for write tools the interesting content (what was written) is in `tc.Args["contents"]`, not in `tc.Result`.

---

## Implementation Plan

### Step 1: Store ToolCallInfo on running blocks for DoneEvent finalization

Add a `toolCall` field to `contentBlock` in [blocks.go](client-apps/cli/pkg/executiontui/blocks.go) so that running tool blocks carry their tool call data. Update `newRunningToolBlock` to accept and store the `ToolCallInfo`.

```go
type contentBlock struct {
    // ... existing fields ...
    
    // toolCall is stored on running tool blocks so that DoneEvent 
    // finalization can create a proper expandable block.
    toolCall *toolrender.ToolCallInfo
}
```

Update `newRunningToolBlock`:

```go
func newRunningToolBlock(content string, tc *toolrender.ToolCallInfo) contentBlock {
    return contentBlock{
        blockType: blockToolResult,
        content:   content,
        toolCall:  tc,
    }
}
```

### Step 2: Fix DoneEvent and StreamErrorEvent finalization

In [handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go), update the finalization loops in `DoneEvent` and `StreamErrorEvent` to create proper expandable blocks when `toolCall` data is available:

```go
for _, idx := range m.runningTools {
    if idx < len(m.blocks) {
        b := m.blocks[idx]
        if b.toolCall != nil {
            tc := *b.toolCall
            tc.Status = "completed"
            preview := renderToolResultPreview("", []toolrender.ToolCallInfo{tc})
            full := renderToolResultExpanded("", []toolrender.ToolCallInfo{tc})
            m.blocks[idx] = newToolCallBlock(preview, full)
        } else {
            m.blocks[idx].content = renderToolFinalized(m.blocks[idx].content)
        }
    }
}
```

Update the `ToolRunningEvent` handler to pass the tool call info:

```go
case ToolRunningEvent:
    tc := e.ToolCall
    block := newRunningToolBlock(renderToolRunning(e.ToolCall), &tc)
    m.blocks = append(m.blocks, block)
    m.runningTools[e.ToolCallID] = len(m.blocks) - 1
```

### Step 3: Add write tool content support

For write tools, the displayable content is in the args (`contents` or `content` field), not in `tc.Result`. Add a helper and a content fallback field to `toolDisplayInfo` in [render.go](client-apps/cli/pkg/toolrender/render.go):

- Add `contentArgField` and `contentArgFallbacks` fields to `toolDisplayInfo` to specify which arg fields contain displayable content
- Update the write tool entries to use `previewFileContent` and point to the content arg:

```go
"write":          {icon: "📝", label: "Write", primaryField: "path", 
                   contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"},
                   preview: previewFileContent},
"write_file":     {icon: "📝", label: "Write", primaryField: "path",
                   contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"},
                   preview: previewFileContent},
"create_file":    {icon: "📝", label: "Create", primaryField: "path",
                   contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"},
                   preview: previewFileContent},
"overwrite_file": {icon: "📝", label: "Write", primaryField: "path",
                   contentArgField: "contents", contentArgFallbacks: []string{"content", "file_content"},
                   preview: previewFileContent},
```

### Step 4: Add content resolution helper

In [render_known.go](client-apps/cli/pkg/toolrender/render_known.go) or a new helper, add a function to resolve display content:

```go
func resolveDisplayContent(tc ToolCallInfo, info toolDisplayInfo) string {
    if tc.Result != "" {
        return tc.Result
    }
    if info.contentArgField != "" {
        return extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
    }
    return ""
}
```

Update `renderKnown` and the header/preview functions to use this instead of raw `tc.Result` when building previews and metadata.

### Step 5: Update RenderExpanded for write tools

In [render.go](client-apps/cli/pkg/toolrender/render.go), update `RenderExpanded` to use the content resolution helper so that write tools show their written content in the expanded view:

```go
func RenderExpanded(tc ToolCallInfo) string {
    info, known := toolDisplayMap[tc.Name]
    // ... header generation ...
    
    content := resolveDisplayContent(tc, info)
    if content == "" {
        return header
    }
    
    filename := extractFilename(tc.Args)
    fullContent := formatFullResultWithGutter(content, filename)
    // ...
}
```

---

## Files Changed


| File                                                | Change                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `client-apps/cli/pkg/executiontui/blocks.go`        | Add `toolCall` field, update `newRunningToolBlock`                                                                   |
| `client-apps/cli/pkg/executiontui/handle_events.go` | Fix DoneEvent/StreamErrorEvent finalization, pass ToolCallInfo to running blocks                                     |
| `client-apps/cli/pkg/toolrender/render.go`          | Add `contentArgField`/`contentArgFallbacks` to `toolDisplayInfo`, update write tool entries, update `RenderExpanded` |
| `client-apps/cli/pkg/toolrender/render_known.go`    | Add `resolveDisplayContent` helper, update `renderKnown` and `renderKnownHeader`                                     |


## Expected Result

After these changes:

- **Write tools will show expandable content** with a 3-line preview of what was written (collapsed) and full syntax-highlighted content (expanded)
- **Running tools finalized via DoneEvent** will become proper expandable blocks instead of static text with a checkmark
- **Edit tools** can follow the same pattern later (add content from args)

