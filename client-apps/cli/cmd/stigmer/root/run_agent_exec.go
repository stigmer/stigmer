package root

import (
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	executioncontextv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
)

// ---------------------------------------------------------------------------
// Layer 1: Shared flag struct + registration
// ---------------------------------------------------------------------------

// agentExecFlags contains CLI flags common to any command that executes an
// agent. Both runOptions and draftOptions embed this struct so that flag
// definitions and preparation logic exist in exactly one place.
type agentExecFlags struct {
	Message         string
	AttachFlags     []string
	ApproveDefault  string
	Verbose         bool
	Detach          bool
	OrgOverride     string
	WorkspaceFlags  []string
	BranchFlag      string
	CommitFlag      string
	EnvFlags        []string
	EnvFileFlags    []string
	SecretFlags     []string
	SecretFileFlags []string
	Model           string
	AutoApproveAll  bool
	Mode            string
}

// registerAgentExecFlags registers the flags shared by every agent-execution
// command (run, draft skill, draft agent, ...). Each caller may add its own
// command-specific flags after calling this function.
func registerAgentExecFlags(cmd *cobra.Command, f *agentExecFlags) {
	cmd.Flags().StringVarP(&f.Message, "message", "m", "",
		"initial message/prompt for execution")

	cmd.Flags().StringArrayVar(&f.AttachFlags, "attach", []string{},
		"file or directory to attach as input (can be repeated)")

	cmd.Flags().StringVar(&f.ApproveDefault, "approve-default", "",
		"auto-resolve approval prompts in non-interactive mode (approve, skip, reject)")

	cmd.Flags().BoolVarP(&f.Verbose, "verbose", "v", false,
		"show execution IDs and phase transitions in the TUI transcript")

	cmd.Flags().BoolVar(&f.Detach, "detach", false,
		"start execution and return immediately without streaming")

	cmd.Flags().StringArrayVarP(&f.WorkspaceFlags, "workspace", "w", []string{},
		"workspace source: HTTPS git URL or local filesystem path (can be repeated)")

	cmd.Flags().StringVar(&f.BranchFlag, "branch", "",
		"git branch to clone (only valid with git --workspace URL)")

	cmd.Flags().StringVar(&f.CommitFlag, "commit", "",
		"git commit SHA to checkout (only valid with git --workspace URL)")

	cmd.Flags().StringArrayVar(&f.EnvFlags, "env", []string{},
		"runtime environment variable (KEY=VALUE, can be repeated)")

	cmd.Flags().StringArrayVar(&f.EnvFileFlags, "env-file", []string{},
		"load environment from file (can be repeated, later files override earlier)")

	cmd.Flags().StringArrayVar(&f.SecretFlags, "secret", []string{},
		"secret environment variable (KEY=VALUE, can be repeated, encrypted)")

	cmd.Flags().StringArrayVar(&f.SecretFileFlags, "secret-file", []string{},
		"load secrets from file (can be repeated, all values encrypted)")

	cmd.Flags().StringVar(&f.Model, "model", "",
		"LLM model to use (e.g., claude-sonnet-4-6)")

	cmd.Flags().BoolVar(&f.AutoApproveAll, "auto-approve", false,
		"automatically approve all tool executions without prompting (bypasses approval policies)")

	cmd.Flags().StringVar(&f.Mode, "mode", "",
		`interaction mode: "agent" (default, full access) or "plan" (read-only analysis)`)
}

// validateMode checks that the --mode flag value is a recognized interaction
// mode. Empty string (unset) is valid and means "use default" (agent).
func validateMode(mode string) error {
	switch mode {
	case "", "agent", "plan":
		return nil
	default:
		return fmt.Errorf("invalid --mode value %q: must be \"agent\" or \"plan\"", mode)
	}
}

// ---------------------------------------------------------------------------
// Layer 2: Shared preparation
// ---------------------------------------------------------------------------

// preparedAgentExec holds the validated, resolved inputs that are ready for
// agent execution. The caller is responsible for closing Conn when done.
//
// Fields fall into two categories:
//   - Processed values derived from raw flags (DefaultAction, WorkspaceEntries,
//     RuntimeEnv, AttachResult) — the raw flag is consumed and not stored.
//   - Pass-through values copied verbatim from agentExecFlags (Message,
//     Detach, Verbose) — needed by downstream consumers without transformation.
type preparedAgentExec struct {
	DefaultAction    approval.Action
	WorkspaceEntries []*sessionv1.WorkspaceEntry
	RuntimeEnv       envfile.EnvMap
	Client           *stigmer.Client
	OrgID            string
	AttachResult     AttachmentResult

	Message        string
	Detach         bool
	Verbose        bool
	OutputMode     OutputMode
	Model          string
	AutoApproveAll bool
	Mode           string
}

// prepareAgentExec validates the common flags, resolves environment variables,
// connects to the backend, and processes attachments. The returned struct
// contains everything needed to execute an agent (once the agent is resolved).
//
// The spinner (sp) is updated at key steps to show preparation progress.
// The caller owns the spinner lifecycle — this function neither starts nor
// stops it.
//
// The caller MUST defer prep.Client.Close() on success.
func prepareAgentExec(flags agentExecFlags, sp *spinner.Spinner) (*preparedAgentExec, error) {
	var defaultAction approval.Action
	if flags.ApproveDefault != "" {
		var err error
		defaultAction, err = approval.ParseAction(flags.ApproveDefault)
		if err != nil {
			return nil, errors.Wrap(err, "invalid --approve-default value")
		}
	}

	if err := validateMode(flags.Mode); err != nil {
		return nil, err
	}

	workspaceEntries, err := parseWorkspaceEntries(flags.WorkspaceFlags, flags.BranchFlag, flags.CommitFlag)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workspace configuration")
	}

	runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
		flags.EnvFileFlags,
		flags.SecretFileFlags,
		flags.EnvFlags,
		flags.SecretFlags,
	)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load environment")
	}

	sp.Update("Connecting...")
	client, orgID, err := connectToBackend(flags.OrgOverride)
	if err != nil {
		return nil, err
	}

	if _, ok := runtimeEnv["STIGMER_ORG_ID"]; !ok && orgID != "" {
		runtimeEnv["STIGMER_ORG_ID"] = &executioncontextv1.ExecutionValue{
			Value: orgID,
		}
	}

	var attachResult AttachmentResult
	if len(flags.AttachFlags) > 0 {
		sp.Update("Processing attachments...")
		processor := NewAttachmentProcessor(client)
		localRoots := localWorkspaceRoots(workspaceEntries)
		res, err := processor.ProcessFiles(flags.AttachFlags, localRoots)
		if err != nil {
			_ = client.Close()
			return nil, errors.Wrap(err, "failed to process attachments")
		}
		attachResult = *res
	}

	return &preparedAgentExec{
		DefaultAction:    defaultAction,
		WorkspaceEntries: workspaceEntries,
		RuntimeEnv:       runtimeEnv,
		Client:           client,
		OrgID:            orgID,
		AttachResult:     attachResult,
		Message:          flags.Message,
		Detach:           flags.Detach,
		Verbose:          flags.Verbose,
		Model:            flags.Model,
		AutoApproveAll:   flags.AutoApproveAll,
		Mode:             flags.Mode,
	}, nil
}

// ---------------------------------------------------------------------------
// Layer 3: Shared agent execution
// ---------------------------------------------------------------------------

// resolvedAgentExecInput holds everything needed to create and stream an
// agent execution once the agent has been resolved. This is the common
// execution path shared by `stigmer run agent` and `stigmer draft`.
type resolvedAgentExecInput struct {
	Agent            *agentv1.Agent
	Message          string
	RuntimeEnv       envfile.EnvMap
	AttachResult     *AttachmentResult
	WorkspaceEntries []*sessionv1.WorkspaceEntry
	Model            string
	AutoApproveAll   bool
	Mode             string
	Detach           bool
	DownloadDir      string // empty = skip artifact download
	OrgID            string
	DefaultAction    approval.Action
	Verbose          bool
	OutputMode       OutputMode
	Client           *stigmer.Client
}

// executeResolvedAgent creates a session (if workspace is configured), creates
// the agent execution, streams it in the alt-screen TUI, and optionally
// downloads artifacts. This is the single source of truth for the "run a
// resolved agent" flow used by both `run` and `draft`.
//
// The spinner (sp) provides animated progress feedback during session and
// execution creation. It may arrive already running (from the run path) or
// stopped (from the draft path after printing agent info). Start() handles
// both: it resumes a stopped spinner or updates an active one.
// The spinner is stopped before streaming begins.
func executeResolvedAgent(input resolvedAgentExecInput, sp *spinner.Spinner) error {
	execInput := CreateAgentExecutionInput{
		AgentID:           input.Agent.Metadata.Id,
		OrgID:             input.OrgID,
		Message:           input.Message,
		RuntimeEnv:        input.RuntimeEnv,
		Attachments:       input.AttachResult.Attachments,
		WorkspaceFileRefs: input.AttachResult.WorkspaceFileRefs,
		Model:             input.Model,
		Mode:              input.Mode,
		AutoApproveAll:    input.AutoApproveAll,
		Client:            input.Client,
	}

	if len(input.WorkspaceEntries) > 0 {
		instanceID := input.Agent.GetStatus().GetDefaultInstanceId()
		if instanceID == "" {
			sp.Stop()
			return errors.New("agent has no default instance — cannot create workspace session")
		}

		sp.Start("Creating workspace...")
		session, err := createSessionForAgent(instanceID, input.OrgID, input.WorkspaceEntries, input.Client)
		if err != nil {
			sp.Stop()
			return errors.Wrap(err, "failed to create workspace session")
		}

		execInput.SessionID = session.GetMetadata().GetId()
	}

	sp.Start("Creating execution...")
	exec, err := createAgentExecution(execInput)
	if err != nil {
		sp.Stop()
		return errors.Wrap(err, "failed to create execution")
	}

	sessionID := exec.GetSpec().GetSessionId()
	if sessionID == "" {
		log.Warn().
			Str("execution_id", exec.GetMetadata().GetId()).
			Msg("backend returned execution without session_id — session display may be degraded")
	}

	sp.Stop()
	headerInfo := sessionHeaderInfo{
		AgentName:  input.Agent.GetMetadata().GetName(),
		SessionID:  sessionID,
		Model:      input.Model,
		Mode:       input.Mode,
		Version:    embedded.GetBuildVersion(),
		Workspaces: workspaceNames(input.WorkspaceEntries),
	}

	if input.Detach {
		renderSessionHeader(os.Stderr, headerInfo)
		return nil
	}

	var prompter approval.Prompter
	if input.OutputMode == OutputInline {
		prompter = approval.NewInlinePrompter(os.Stdin, os.Stderr)
	} else {
		prompter = approval.NewInteractivePrompter()
	}
	exec, err = streamAgentExecution(sessionID, headerInfo, exec.Metadata.Id, input.OrgID, prompter, input.DefaultAction, input.Verbose, input.OutputMode, input.Client, localWorkspaceRoots(input.WorkspaceEntries), os.Stdout, os.Stderr)
	if err != nil {
		return errors.Wrap(err, "error streaming execution")
	}

	if input.DownloadDir != "" && len(exec.Status.Artifacts) > 0 {
		if err := downloadArtifacts(exec, input.DownloadDir, input.Client); err != nil {
			return errors.Wrap(err, "failed to download artifacts")
		}
	}

	return nil
}
