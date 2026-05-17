package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/encoding/protojson"
)

// HistoryExporter captures Temporal workflow event histories and writes them
// as JSON files compatible with worker.ReplayWorkflowHistoryFromJSONFile().
type HistoryExporter struct {
	temporalClient client.Client
	outputDir      string
}

// NewHistoryExporter creates an exporter that writes history JSON files to outputDir.
func NewHistoryExporter(temporalClient client.Client, outputDir string) *HistoryExporter {
	return &HistoryExporter{
		temporalClient: temporalClient,
		outputDir:      outputDir,
	}
}

// Export fetches the complete event history for a workflow execution and writes
// it as a JSON file. The output format matches Temporal's standard history JSON
// (the same format produced by `temporal workflow show --output json`), which is
// directly consumable by worker.ReplayWorkflowHistoryFromJSONFile().
func (e *HistoryExporter) Export(ctx context.Context, workflowID, runID, filename string) error {
	if err := os.MkdirAll(e.outputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory %s: %w", e.outputDir, err)
	}

	iter := e.temporalClient.GetWorkflowHistory(ctx, workflowID, runID, false, 0)

	// Collect all events into a single history structure that matches
	// the format expected by ReplayWorkflowHistoryFromJSONFile:
	// {"events": [{...}, {...}, ...]}
	type historyJSON struct {
		Events []json.RawMessage `json:"events"`
	}
	var history historyJSON

	marshaler := protojson.MarshalOptions{
		UseProtoNames: true,
	}

	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return fmt.Errorf("read event from history iterator: %w", err)
		}

		eventBytes, err := marshaler.Marshal(event)
		if err != nil {
			return fmt.Errorf("marshal event %d: %w", event.GetEventId(), err)
		}
		history.Events = append(history.Events, json.RawMessage(eventBytes))
	}

	if len(history.Events) == 0 {
		return fmt.Errorf("workflow %s has empty event history", workflowID)
	}

	outputPath := filepath.Join(e.outputDir, filename)
	data, err := json.MarshalIndent(history, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal history JSON: %w", err)
	}

	if err := os.WriteFile(outputPath, data, 0o644); err != nil {
		return fmt.Errorf("write history file %s: %w", outputPath, err)
	}

	return nil
}

// ExportByExecutionID is a convenience method that exports the inner workflow
// history using the standard workflow ID convention: "workflow-exec-{executionId}".
// This is the Go inner workflow started by the ExecuteWorkflow activity.
func (e *HistoryExporter) ExportByExecutionID(ctx context.Context, executionID, filename string) error {
	workflowID := fmt.Sprintf("workflow-exec-%s", executionID)
	return e.Export(ctx, workflowID, "", filename)
}

// NewTemporalClient creates a Temporal SDK client connected to the given address.
// The caller is responsible for closing the returned client.
func NewTemporalClient(address string) (client.Client, error) {
	c, err := client.Dial(client.Options{
		HostPort:  address,
		Namespace: "default",
	})
	if err != nil {
		return nil, fmt.Errorf("dial temporal at %s: %w", address, err)
	}

	// Verify connectivity with a lightweight health check
	_, err = c.WorkflowService().GetSystemInfo(context.Background(), &workflowservice.GetSystemInfoRequest{})
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("temporal health check failed at %s: %w", address, err)
	}

	return c, nil
}
