// Package approval provides interactive approval prompts for HITL (human-in-the-loop) flows.
//
// This package abstracts the approval prompt mechanism, enabling:
//   - Interactive TTY prompts using the Survey library
//   - Non-interactive mode for CI/CD pipelines
//   - Mock implementations for testing
//
// # Usage
//
// Create an interactive prompter and use it to collect approval decisions:
//
//	prompter := approval.NewInteractivePrompter()
//	decision, err := prompter.Prompt(ctx, approval.Options{
//	    ToolName: "write_file",
//	    Message:  "Write to protected file: /etc/hosts",
//	})
//	if err != nil {
//	    // Handle cancellation or error
//	    return err
//	}
//	// Use decision.Action and decision.Comment
//
// # Non-Interactive Mode
//
// For CI/CD pipelines or scripted environments, set NonInteractive and DefaultAction:
//
//	decision, err := prompter.Prompt(ctx, approval.Options{
//	    ToolName:       "write_file",
//	    NonInteractive: true,
//	    DefaultAction:  approval.ActionApprove,
//	})
//
// # Testing
//
// The Prompter interface enables mock implementations for testing:
//
//	type MockPrompter struct {
//	    Decision *approval.Decision
//	    Err      error
//	}
//
//	func (m *MockPrompter) Prompt(ctx context.Context, opts approval.Options) (*approval.Decision, error) {
//	    return m.Decision, m.Err
//	}
package approval
