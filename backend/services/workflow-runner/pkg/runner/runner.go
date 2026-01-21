package runner

import (
	"github.com/stigmer/stigmer/backend/services/workflow-runner/cmd/worker"
)

// Run starts the workflow-runner (extracted for BusyBox pattern)
// This allows the CLI to call this function directly instead of running a separate binary
func Run() error {
	// Call the existing Execute function which handles the cobra command
	worker.Execute()
	return nil
}
