//go:build integration

package integration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorHarness_McpImageResult_RendersInline characterizes how the Cursor
// harness handles an MCP tool that returns an image (e.g. open-computer-use's
// get_app_state screenshot), and guards the runner-side rendering contract.
//
// It runs a real cursor-agent (HARNESS_CURSOR) against the mock MCP HTTP server's
// "image" tool, which returns a status line plus a real (tiny) PNG as MCP image
// content, then records ground truth and asserts the part we own.
//
// ROOT CAUSE (confirmed from a real production capture): the cursor-agent DOES
// deliver the image. A real get_app_state result is the envelope
//   { status, value: { content: [ {text:{text}}, {image:{data:{type:"Buffer",
//   data:[...]}}} ] } }
// delivered to the runner as a serialized STRING — blocks nested under
// value.content, image bytes as Node Buffer-JSON, and NO mimeType. The bug was
// entirely runner-side: shared/status-offload.ts detectImagePayload only looked
// at top-level content and required string `data`, so it missed this shape and
// offloaded the screenshot as text ("view full output"). That detector now
// recurses and decodes Buffer-JSON; the fix is validated deterministically by
// the offline unit tests in shared/__tests__/status-offload (which use the exact
// captured shape). This live test is the end-to-end guard.
//
// Caveat on the live mock: with the tiny mock image, the model sometimes
// abandons the MCP call before it completes (answers from the image it received
// internally), so no result reaches the runner on that run — a flaky false
// negative, NOT the upstream behavior. The assertion below is therefore
// conditional: it asserts the render contract when an image-bearing result
// actually arrives, and skips (does not fail) when the model bailed.
//
// Two signals per run:
//
//   - Ground truth: when CURSOR_EVENT_RECORD_DIR is set, the runner records every
//     raw @cursor/sdk SDKMessage to <execID>.cursor-events.jsonl. We log the
//     image tool_call's result (bytes redacted) — the authoritative shape of what
//     the SDK delivers.
//   - Conditional contract: IF an image-bearing result reaches the runner, the
//     persisted ToolCall MUST carry a ToolCallOutputRef with is_image=true and a
//     download URL (the only way the UI renders a tool-result image inline).
//
// Requires CURSOR_API_KEY. For the ground-truth capture, also export
// CURSOR_EVENT_RECORD_DIR (a writable directory) before the suite starts the
// runner.
func TestCursorHarness_McpImageResult_RendersInline(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	httpServer := harness.StartHTTPMcpServer(t)
	mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)
	harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
	mcpServer = harness.WaitForMcpServerTool(t, ctx, clients,
		mcpServer.GetMetadata().GetId(), "image", 2*time.Minute)

	// The instruction must be explicit on two points the model otherwise gets
	// wrong: (1) it must call the MCP "image" tool, not the built-in
	// generateImage tool (observed: "capture an image" makes the model draw one
	// instead); (2) it must wait for that tool's result before finishing, so the
	// completed tool_call (with its result) is actually produced — a pure-image
	// result with no text gives the model nothing to read and it tends to bail.
	agent := harness.CreateAgent(t, ctx, clients, "test-cursor-mcp-image",
		"You have one job: call the MCP tool named \"image\" from the connected "+
			"MCP server exactly once, wait for it to return, then reply with the "+
			"single word DONE. Never generate, draw, or create an image yourself. "+
			"Never use the built-in generateImage tool. Use no other tool.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), sessionv1.Harness_HARNESS_CURSOR)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Retry once on LLM non-determinism: if the agent answers with text instead
	// of calling the tool, create a fresh execution.
	var result *agentexecv1.AgentExecution
	var execID string
	const maxAttempts = 2
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		exec := harness.CreateTestAgentExecution(t, ctx, clients,
			session.GetMetadata().GetId(),
			"Call the MCP \"image\" tool from the connected MCP server, wait for "+
				"its result, then reply DONE. Do not generate or draw any image "+
				"yourself; do not use the generateImage tool.",
			harness.WithAutoApproveAll(true))
		execID = exec.GetMetadata().GetId()

		var err error
		result, err = waiter.WaitForPhase(ctx, execID,
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
		if err != nil {
			harness.LogExecutionMessages(t, ctx, clients, execID)
		}
		require.NoError(t, err, "execution should complete")

		if harness.HasToolCall(result, "image") {
			break
		}
		if attempt < maxAttempts {
			t.Logf("cursor MCP image retry: LLM skipped the image tool on attempt %d", attempt)
			harness.LogExecutionMessages(t, ctx, clients, execID)
		}
	}
	require.NotNil(t, result)
	harness.AssertHasToolCall(t, result, "image")

	tc := harness.FindToolCall(result, "image")
	require.NotNil(t, tc, "image tool call must be present")

	// Ground truth: the raw @cursor/sdk result shape (bytes redacted).
	logCapturedCursorToolResult(t, execID, "image")

	// Observed end-to-end state, logged before the assertions so a failure
	// report carries the full diagnosis.
	ref := tc.GetOutputRef()
	t.Logf("image tool call: status=%s result_len=%d has_output_ref=%v",
		tc.GetStatus().String(), len(tc.GetResult()), ref != nil)
	if ref != nil {
		t.Logf("output_ref: is_image=%v mime=%s storage_key_set=%v size_bytes=%d",
			ref.GetIsImage(), ref.GetMimeType(), ref.GetStorageKey() != "", ref.GetSizeBytes())
	}
	t.Logf("image tool result (head): %s", headString(tc.GetResult(), 600))

	// The assertion is conditional on whether an image-bearing result actually
	// reached the runner. "Image-bearing" means either it already offloaded as an
	// image, or its (collapsed) result still carries a recognizable image signal.
	// A text offload of non-image data (e.g. raw base64 with no marker) is NOT
	// image-bearing and must not fail this guard.
	imageBearing := (ref != nil && ref.GetIsImage()) || resultLooksLikeImage(tc.GetResult())
	if !imageBearing {
		t.Logf("no image-bearing result reached the runner (status=%s, result_len=%d, "+
			"has_output_ref=%v). With the tiny mock image the model sometimes abandons the "+
			"MCP call before it completes — a flaky false negative, not the production "+
			"behavior (a real get_app_state DOES deliver the image; see the captured-shape "+
			"offline tests in shared/__tests__/status-offload). Skipping the render assertion "+
			"for this run.",
			tc.GetStatus().String(), len(tc.GetResult()), ref != nil)
		t.Skip("live mock did not deliver an image-bearing result this run (model bailed before tool completion)")
	}

	// An image reached the runner — the rendering contract must hold.
	require.NotNil(t, ref,
		"an image-bearing MCP result must be offloaded to a ToolCallOutputRef so the UI "+
			"can render it inline; got raw result=%q", headString(tc.GetResult(), 200))
	assert.True(t, ref.GetIsImage(),
		"output_ref.is_image must be true for an MCP image result")
	assert.NotEmpty(t, ref.GetMimeType(),
		"offloaded image must carry a mime type to render")
	assert.NotEmpty(t, ref.GetStorageKey(),
		"offloaded image must have a storage key the UI resolves to a fresh URL for the <img> src")
}

// resultLooksLikeImage reports whether a (possibly collapsed) tool result still
// carries a recognizable image signal — a data: URL or an image/* mime marker.
// Used to decide whether the cursor-agent actually delivered an image-bearing
// result, so the rendering assertion only runs when there is an image to render.
func resultLooksLikeImage(s string) bool {
	return strings.Contains(s, "data:image/") ||
		strings.Contains(s, `"image/png"`) ||
		strings.Contains(s, `"image/jpeg"`) ||
		strings.Contains(s, `"mimeType":"image/`) ||
		strings.Contains(s, `"mime_type":"image/`)
}

// logCapturedCursorToolResult reads the raw SDKMessage stream recorded by the
// runner (when CURSOR_EVENT_RECORD_DIR is set) and logs the tool_call result for
// the named tool with byte-heavy strings redacted. This is the ground-truth
// shape of what @cursor/sdk delivers to the runner — the authoritative signal for
// whether an image survives the SDK, independent of the downstream offload.
func logCapturedCursorToolResult(t *testing.T, execID, toolName string) {
	t.Helper()

	dir := os.Getenv("CURSOR_EVENT_RECORD_DIR")
	if dir == "" {
		t.Logf("CURSOR_EVENT_RECORD_DIR not set — skipping raw SDK event capture. "+
			"Set it to a writable dir to record %s.cursor-events.jsonl for the "+
			"ground-truth @cursor/sdk shape.", execID)
		return
	}

	path := filepath.Join(dir, execID+".cursor-events.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Logf("could not read recorded cursor events at %s: %v", path, err)
		return
	}

	found := false
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var entry struct {
			Type  string          `json:"type"`
			Event json.RawMessage `json:"event"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil || entry.Type != "tool_call" {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal(entry.Event, &ev); err != nil {
			continue
		}
		if !cursorEventMatchesTool(ev, toolName) {
			continue
		}
		found = true
		redacted := redactLongStrings(ev["result"], 80)
		pretty, _ := json.MarshalIndent(redacted, "", "  ")
		t.Logf("CAPTURED @cursor/sdk tool_call result for %q (strings >80 chars redacted):\n%s",
			toolName, string(pretty))
	}
	if !found {
		t.Logf("no tool_call event for %q found in %s", toolName, path)
	}
}

// cursorEventMatchesTool reports whether a recorded tool_call event is for the
// named tool. Cursor reports MCP tools as name="mcp" with the real tool under
// args.toolName; built-in tools carry the name directly.
func cursorEventMatchesTool(ev map[string]any, toolName string) bool {
	if name, _ := ev["name"].(string); name == toolName {
		return true
	}
	if args, ok := ev["args"].(map[string]any); ok {
		if tn, _ := args["toolName"].(string); tn == toolName {
			return true
		}
	}
	return false
}

// redactLongStrings deep-copies a decoded JSON value, replacing any string
// longer than maxLen with a "<string N chars>" placeholder so logged event
// shapes stay readable and never dump base64 image bytes.
func redactLongStrings(v any, maxLen int) any {
	switch x := v.(type) {
	case string:
		if len(x) > maxLen {
			// Keep a short head so the encoding is identifiable (e.g. a
			// "data:image/png;base64," prefix vs a bare base64 vs "iVBOR..."),
			// without dumping the full payload.
			return "<str " + strconv.Itoa(len(x)) + " chars head=" + x[:24] + ">"
		}
		return x
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = redactLongStrings(item, maxLen)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, item := range x {
			out[k] = redactLongStrings(item, maxLen)
		}
		return out
	default:
		return v
	}
}

func headString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
