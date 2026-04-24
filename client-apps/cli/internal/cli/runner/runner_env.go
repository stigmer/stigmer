package runner

import (
	"fmt"
	"os"
	"path/filepath"
)

// EnvParams holds every value needed to construct the agent-runner's
// environment. All fields are passed in explicitly — no os.Getenv reads
// happen inside BuildRunnerEnv, making it fully testable and deterministic.
type EnvParams struct {
	BackendInfo *BackendInfo
	RunnerID    string
	TaskQueue   string
	DataDir     string
	AppDir      string

	LLMProvider string
	LLMModel    string
	LLMBaseURL  string
	LLMAPIKey   string

	ExecMode        string
	SandboxImage    string
	SandboxAutoPull bool
	SandboxCleanup  bool
	SandboxTTL      int
}

// BuildRunnerEnv constructs the environment variable slice for the Python
// agent-runner process. The returned slice starts with the current process
// environment (so PATH, HOME, etc. are inherited) and appends all
// runner-specific variables.
func BuildRunnerEnv(params EnvParams) []string {
	workspaceDir := filepath.Join(params.DataDir, "workspace")
	artifactsDir := filepath.Join(params.DataDir, "artifacts")

	_ = os.MkdirAll(workspaceDir, 0755)
	_ = os.MkdirAll(artifactsDir, 0755)

	env := os.Environ()

	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", params.BackendInfo.Endpoint),
		fmt.Sprintf("STIGMER_RUNNER_ID=%s", params.RunnerID),
		fmt.Sprintf("SANDBOX_TYPE=filesystem"),
		fmt.Sprintf("SANDBOX_ROOT_DIR=%s", workspaceDir),
		fmt.Sprintf("LOCAL_ARTIFACT_PATH=%s", artifactsDir),
		"LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000",
		"LOG_LEVEL=DEBUG",
	)

	if params.TaskQueue != "" {
		env = append(env, fmt.Sprintf("STIGMER_TASK_QUEUE=%s", params.TaskQueue))
	} else {
		env = append(env, "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner")
	}

	if params.BackendInfo.IsLocal {
		env = append(env, "MODE=local")
		env = appendLocalEnv(env, params)
	} else {
		env = append(env, "MODE=cloud")
		env = appendCloudEnv(env, params)
	}

	return env
}

func appendLocalEnv(env []string, params EnvParams) []string {
	env = append(env,
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", params.BackendInfo.TemporalAddress),
		fmt.Sprintf("TEMPORAL_NAMESPACE=%s", params.BackendInfo.TemporalNamespace),
		fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", params.LLMProvider),
		fmt.Sprintf("STIGMER_LLM_MODEL=%s", params.LLMModel),
		fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", params.LLMBaseURL),
		fmt.Sprintf("OLLAMA_BASE_URL=%s", params.LLMBaseURL),
		fmt.Sprintf("STIGMER_EXECUTION_MODE=%s", params.ExecMode),
		fmt.Sprintf("STIGMER_SANDBOX_IMAGE=%s", params.SandboxImage),
		fmt.Sprintf("STIGMER_SANDBOX_AUTO_PULL=%t", params.SandboxAutoPull),
		fmt.Sprintf("STIGMER_SANDBOX_CLEANUP=%t", params.SandboxCleanup),
		fmt.Sprintf("STIGMER_SANDBOX_TTL=%d", params.SandboxTTL),
	)

	if params.LLMAPIKey != "" {
		env = append(env, fmt.Sprintf("STIGMER_LLM_API_KEY=%s", params.LLMAPIKey))
	}

	grpcPort := 7234
	env = append(env, fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=http://localhost:%d", grpcPort+1))

	return env
}

func appendCloudEnv(env []string, params EnvParams) []string {
	if params.BackendInfo.Token != "" {
		env = append(env, fmt.Sprintf("STIGMER_TOKEN=%s", params.BackendInfo.Token))
	}
	env = append(env, fmt.Sprintf("STIGMER_PROXY_ENDPOINT=%s", params.BackendInfo.Endpoint))
	return env
}
