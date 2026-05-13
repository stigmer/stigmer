package root

import (
	"encoding/json"
	"os"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

func newExecutionApproveCommand() *cobra.Command {
	var taskName string
	var outcome string
	var comment string
	var dataFile string
	var toolCallID string
	var action string

	cmd := &cobra.Command{
		Use:   "approve <execution-id>",
		Short: "Submit approval for a waiting execution",
		Long: `Submit an approval decision for an execution waiting on human input.

For workflow executions (wex_):
  Requires --task and --outcome flags.
  Use --data-file to submit form data for custom outcomes.

For agent executions (aex_):
  Requires --tool-call and --action flags.`,
		Example: `  # Approve a workflow task
  stigmer execution approve wex_01abc123 --task review --outcome approve

  # Deny a workflow task with comment
  stigmer execution approve wex_01abc123 --task review --outcome deny --comment "needs changes"

  # Approve with form data
  stigmer execution approve wex_01abc123 --task review --outcome approved --data-file form.json

  # Approve an agent tool call
  stigmer execution approve aex_01xyz789 --tool-call tc_abc --action approve

  # Deny an agent tool call
  stigmer execution approve aex_01xyz789 --tool-call tc_abc --action deny`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			clierr.Handle(runExecutionApprove(executionApproveInput{
				ExecutionID: args[0],
				TaskName:    taskName,
				Outcome:     outcome,
				Comment:     comment,
				DataFile:    dataFile,
				ToolCallID:  toolCallID,
				Action:      action,
			}))
		},
	}

	cmd.Flags().StringVar(&taskName, "task", "", "task name to approve (workflow executions)")
	cmd.Flags().StringVar(&outcome, "outcome", "approve", "approval outcome (workflow executions)")
	cmd.Flags().StringVar(&comment, "comment", "", "approval comment")
	cmd.Flags().StringVar(&dataFile, "data-file", "", "JSON file with form data (workflow executions)")
	cmd.Flags().StringVar(&toolCallID, "tool-call", "", "tool call ID to approve (agent executions)")
	cmd.Flags().StringVar(&action, "action", "approve", "approval action: approve or deny (agent executions)")

	return cmd
}

type executionApproveInput struct {
	ExecutionID string
	TaskName    string
	Outcome     string
	Comment     string
	DataFile    string
	ToolCallID  string
	Action      string
}

func runExecutionApprove(input executionApproveInput) error {
	execType, err := execution.ResolveType(input.ExecutionID)
	if err != nil {
		return err
	}

	client, err := connectForExecution()
	if err != nil {
		return err
	}
	defer client.Close()

	switch execType {
	case execution.ExecutionTypeWorkflow:
		return runWorkflowApprove(input, client)
	case execution.ExecutionTypeAgent:
		return runAgentApprove(input, client)
	}

	return nil
}

func runWorkflowApprove(input executionApproveInput, client *stigmer.Client) error {
	if input.TaskName == "" {
		return errors.New("--task is required for workflow execution approvals")
	}

	var formData map[string]interface{}
	if input.DataFile != "" {
		data, err := os.ReadFile(input.DataFile)
		if err != nil {
			return errors.Wrapf(err, "failed to read data file '%s'", input.DataFile)
		}
		if err := json.Unmarshal(data, &formData); err != nil {
			return errors.Wrapf(err, "failed to parse JSON in '%s'", input.DataFile)
		}
	}

	err := execution.ApproveWorkflow(&execution.ApproveWorkflowOptions{
		ExecutionID: input.ExecutionID,
		TaskName:    input.TaskName,
		Outcome:     input.Outcome,
		Comment:     input.Comment,
		FormData:    formData,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Approval submitted: task=%s outcome=%s", input.TaskName, input.Outcome)
	return nil
}

func runAgentApprove(input executionApproveInput, client *stigmer.Client) error {
	if input.ToolCallID == "" {
		return errors.New("--tool-call is required for agent execution approvals")
	}

	err := execution.ApproveAgent(&execution.ApproveAgentOptions{
		ExecutionID: input.ExecutionID,
		ToolCallID:  input.ToolCallID,
		Action:      input.Action,
		Comment:     input.Comment,
		Client:      client,
	})
	if err != nil {
		return err
	}

	climsg.Success("Approval submitted: tool-call=%s action=%s", input.ToolCallID, input.Action)
	return nil
}
