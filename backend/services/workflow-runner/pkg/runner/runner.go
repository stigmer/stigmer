package runner

import (
	"github.com/stigmer/stigmer/backend/services/workflow-runner/cmd/worker"
)

// Run starts the workflow-runner in Temporal worker mode (BusyBox pattern)
// This allows the CLI to call this function directly without spawning a separate binary
//
// Note: This bypasses the cobra command structure and directly calls the worker mode
// because the zigflow CLI root command doesn't have an "internal-workflow-runner" subcommand.
func Run() error {
	// Directly run in Temporal worker mode (stigmer integration)
	// Don't go through worker.Execute() which would try to parse cobra commands
	return worker.RunTemporalWorkerMode()
}
