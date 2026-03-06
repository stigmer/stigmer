package root

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

func benchHeader() committedItem {
	return committedItem{
		kind: kindHeader,
		header: &sessionHeaderInfo{
			AgentName: "bench-agent",
			SessionID: "ses-bench-12345",
			Subject:   "Benchmark subject for performance testing",
			Model:     "sonnet-4.6",
		},
	}
}

func benchToolCompact() committedItem {
	return committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "go test ./..."},
			Status: "completed",
			Result: "ok pkg/a 0.1s\nok pkg/b 0.2s\nok pkg/c 0.3s",
		}},
	}
}

func benchReadGroup() committedItem {
	reads := make([]toolrender.ToolCallInfo, 5)
	for i := range reads {
		reads[i] = toolrender.ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("pkg/service/handler_%d.go", i+1)},
			Status: "completed",
			Result: "package service\n\nfunc Handle() error {\n\treturn nil\n}\n",
		}
	}
	return committedItem{kind: kindReadGroup, toolCalls: reads}
}

func benchApproval() committedItem {
	return committedItem{
		kind:   kindApproval,
		action: "approve",
		toolCalls: []toolrender.ToolCallInfo{{
			Name:   "write_file",
			Args:   map[string]interface{}{"path": "config.go", "contents": "package config\n"},
			Status: "completed",
		}},
	}
}

func benchText() committedItem {
	return committedItem{
		kind: kindAIMessage,
		text: "I'll help you refactor the authentication module. Let me start by reading the existing code to understand the current structure.",
	}
}

// buildRealisticHistory creates a history that mirrors a real session:
// header, AI messages, tool calls, read groups, approvals, and lifecycle events.
func buildRealisticHistory(n int) []committedItem {
	items := make([]committedItem, 0, n)
	items = append(items, benchHeader())

	for i := 1; i < n; i++ {
		switch i % 7 {
		case 0:
			items = append(items, benchText())
		case 1:
			items = append(items, benchToolCompact())
		case 2:
			items = append(items, committedItem{
				kind: kindToolCompact,
				toolCalls: []toolrender.ToolCallInfo{{
					Name: "read_file",
					Args: map[string]interface{}{"path": fmt.Sprintf("file_%d.go", i)},
				}},
			})
		case 3:
			items = append(items, benchReadGroup())
		case 4:
			items = append(items, benchApproval())
		case 5:
			items = append(items, committedItem{
				kind: kindHumanMessage,
				text: "Please also update the tests for the refactored module.",
			})
		case 6:
			items = append(items, committedItem{
				kind: kindSystemMessage,
				text: "Session resumed from checkpoint.",
			})
		}
	}
	return items
}

// =============================================================================
// Per-kind benchmarks
// =============================================================================

func BenchmarkRenderCommittedItem_Header(b *testing.B) {
	item := benchHeader()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, false)
	}
}

func BenchmarkRenderCommittedItem_ToolCompact(b *testing.B) {
	item := benchToolCompact()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, false)
	}
}

func BenchmarkRenderCommittedItem_ToolExpanded(b *testing.B) {
	item := benchToolCompact()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, true)
	}
}

func BenchmarkRenderCommittedItem_ReadGroup(b *testing.B) {
	item := benchReadGroup()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, false)
	}
}

func BenchmarkRenderCommittedItem_ReadGroupExpanded(b *testing.B) {
	item := benchReadGroup()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, true)
	}
}

func BenchmarkRenderCommittedItem_Approval(b *testing.B) {
	item := benchApproval()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, false)
	}
}

func BenchmarkRenderCommittedItem_Text(b *testing.B) {
	item := benchText()
	opts := toolrender.CompactOptions{}
	b.ResetTimer()
	for range b.N {
		renderCommittedItem(item, opts, false)
	}
}

// =============================================================================
// Batch rendering benchmarks — realistic mixed histories at various sizes.
// These measure the full cost of rendering all items to a single string.
// =============================================================================

func BenchmarkRenderHistoryBatch(b *testing.B) {
	for _, size := range []int{10, 50, 100, 500} {
		items := buildRealisticHistory(size)
		opts := toolrender.CompactOptions{}
		b.Run(fmt.Sprintf("compact_%d", size), func(b *testing.B) {
			for range b.N {
				renderHistoryBatch(items, opts, false)
			}
		})
		b.Run(fmt.Sprintf("expanded_%d", size), func(b *testing.B) {
			for range b.N {
				renderHistoryBatch(items, opts, true)
			}
		})
	}
}

// =============================================================================
// Allocation benchmark — measures bytes allocated per batch render.
// =============================================================================

func BenchmarkRenderHistoryBatch_Allocs(b *testing.B) {
	items := buildRealisticHistory(100)
	opts := toolrender.CompactOptions{}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_ = renderHistoryBatch(items, opts, false)
	}
}

// =============================================================================
// Builder pre-growth benchmark — verifies strings.Builder.Grow amortization.
// =============================================================================

func BenchmarkRenderHistoryBatch_BuilderGrowth(b *testing.B) {
	items := buildRealisticHistory(500)
	opts := toolrender.CompactOptions{}
	b.ReportAllocs()
	b.ResetTimer()

	var sink strings.Builder
	for range b.N {
		sink.Reset()
		result := renderHistoryBatch(items, opts, false)
		sink.WriteString(result)
	}
}
