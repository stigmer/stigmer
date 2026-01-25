package workflow

import (
	"fmt"
	"regexp"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Validation constants.
const (
	taskNameMinLength = 1
	taskNameMaxLength = 100
)

// taskNameRegex matches valid task names (alphanumeric with hyphens and underscores).
var taskNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// validate validates a Workflow.
func validate(w *Workflow) error {
	// Validate document
	if err := validateDocument(&w.Document); err != nil {
		return err
	}

	// Note: We no longer require tasks during workflow creation to support
	// the Pulumi-style pattern where workflows are created first, then tasks
	// are added via wf.HttpGet(), wf.SetVars(), etc.
	//
	// Task validation will happen during synthesis instead.
	if len(w.Tasks) == 0 {
		// Allow empty workflows during creation
		return nil
	}

	// Validate task names are unique
	taskNames := make(map[string]bool)
	for i, task := range w.Tasks {
		if err := validateTaskName(task.Name); err != nil {
			return fmt.Errorf("task[%d]: %w", i, err)
		}

		if taskNames[task.Name] {
			return validation.NewValidationErrorWithCause(
				validation.FieldPath("tasks", i, "name"),
				task.Name,
				"unique",
				fmt.Sprintf("duplicate task name: %q", task.Name),
				ErrDuplicateTaskName,
			)
		}
		taskNames[task.Name] = true

		// Validate task kind
		if err := validateTaskKind(task.Kind); err != nil {
			return fmt.Errorf("task[%d]: %w", i, err)
		}

		// Validate task-specific config
		if err := validateTaskConfig(task); err != nil {
			return fmt.Errorf("task[%d]: %w", i, err)
		}
	}

	return nil
}

// validateTaskName validates a task name.
func validateTaskName(name string) error {
	if err := validation.Required("name", name); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"required",
			"task name is required",
			ErrInvalidTaskName,
		)
	}

	if err := validation.LengthRange("name", name, taskNameMinLength, taskNameMaxLength); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"length",
			fmt.Sprintf("task name must be between %d and %d characters", taskNameMinLength, taskNameMaxLength),
			ErrInvalidTaskName,
		)
	}

	if err := validation.MatchesPattern("name", name, taskNameRegex, "alphanumeric with hyphens and underscores"); err != nil {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"format",
			"task name must be alphanumeric with hyphens and underscores",
			ErrInvalidTaskName,
		)
	}

	return nil
}

// validateTaskKind validates a task kind.
func validateTaskKind(kind TaskKind) error {
	switch kind {
	case TaskKindSet,
		TaskKindHttpCall,
		TaskKindGrpcCall,
		TaskKindSwitch,
		TaskKindFor,
		TaskKindFork,
		TaskKindTry,
		TaskKindListen,
		TaskKindWait,
		TaskKindCallActivity,
		TaskKindRaise,
		TaskKindRun,
		TaskKindAgentCall:
		return nil
	default:
		return validation.NewValidationErrorWithCause(
			"kind",
			string(kind),
			"enum",
			fmt.Sprintf("invalid task kind: %q", kind),
			ErrInvalidTaskKind,
		)
	}
}

// validateTaskConfig validates task-specific configuration.
func validateTaskConfig(task *Task) error {
	// Each task type has its own validation rules
	switch task.Kind {
	case TaskKindSet:
		return validateSetTaskConfig(task)
	case TaskKindHttpCall:
		return validateHttpCallTaskConfig(task)
	case TaskKindGrpcCall:
		return validateGrpcCallTaskConfig(task)
	case TaskKindSwitch:
		return validateSwitchTaskConfig(task)
	case TaskKindFor:
		return validateForTaskConfig(task)
	case TaskKindFork:
		return validateForkTaskConfig(task)
	case TaskKindTry:
		return validateTryTaskConfig(task)
	case TaskKindListen:
		return validateListenTaskConfig(task)
	case TaskKindWait:
		return validateWaitTaskConfig(task)
	case TaskKindCallActivity:
		return validateCallActivityTaskConfig(task)
	case TaskKindRaise:
		return validateRaiseTaskConfig(task)
	case TaskKindRun:
		return validateRunTaskConfig(task)
	case TaskKindAgentCall:
		return validateAgentCallTaskConfig(task)
	default:
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"unknown_kind",
			fmt.Sprintf("unknown task kind: %q", task.Kind),
			ErrInvalidTaskConfig,
		)
	}
}

// Task-specific validation functions

func validateSetTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*SetTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for SET task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.NonEmptySliceWithMessage("config.variables", len(cfg.Variables), "SET task must have at least one variable"); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.variables",
			"",
			"required",
			"SET task must have at least one variable",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateHttpCallTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*HttpCallTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for HTTP_CALL task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.method", cfg.Method); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.method",
			"",
			"required",
			"HTTP_CALL task must have a method",
			ErrInvalidTaskConfig,
		)
	}
	// Validate method is one of: GET, POST, PUT, DELETE, PATCH
	if err := validation.OneOfWithMessage("config.method", cfg.Method, []string{"GET", "POST", "PUT", "DELETE", "PATCH"},
		"HTTP method must be one of: GET, POST, PUT, DELETE, PATCH"); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.method",
			cfg.Method,
			"enum",
			"HTTP method must be one of: GET, POST, PUT, DELETE, PATCH",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Endpoint == nil || cfg.Endpoint.Uri == "" {
		return validation.NewValidationErrorWithCause(
			"config.endpoint.uri",
			"",
			"required",
			"HTTP_CALL task must have an endpoint URI",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.RangeInt32("config.timeout_seconds", cfg.TimeoutSeconds, 0, 300); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.timeout_seconds",
			fmt.Sprintf("%d", cfg.TimeoutSeconds),
			"range",
			"timeout must be between 0 and 300 seconds",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateGrpcCallTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*GrpcCallTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for GRPC_CALL task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.service", cfg.Service); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.service",
			"",
			"required",
			"GRPC_CALL task must have a service",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.method", cfg.Method); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.method",
			"",
			"required",
			"GRPC_CALL task must have a method",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateSwitchTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*SwitchTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for SWITCH task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.NonEmptySlice("config.cases", len(cfg.Cases)); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.cases",
			"",
			"required",
			"SWITCH task must have at least one case",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateForTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*ForTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for FOR task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.RequiredInterfaceWithMessage("config.in", cfg.In, "FOR task must have an 'in' expression"); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.in",
			"",
			"required",
			"FOR task must have an 'in' expression",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.NonEmptySlice("config.do", len(cfg.Do)); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.do",
			"",
			"required",
			"FOR task must have at least one task in 'do' block",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateForkTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*ForkTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for FORK task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.NonEmptySlice("config.branches", len(cfg.Branches)); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.branches",
			"",
			"required",
			"FORK task must have at least one branch",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateTryTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*TryTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for TRY task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.NonEmptySlice("config.try", len(cfg.Try)); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.try",
			"",
			"required",
			"TRY task must have at least one task in try block",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateListenTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*ListenTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for LISTEN task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.To == nil {
		return validation.NewValidationErrorWithCause(
			"config.to",
			"",
			"required",
			"LISTEN task must have a listen target",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateWaitTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*WaitTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for WAIT task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.MinInt32("config.seconds", cfg.Seconds, 1); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.seconds",
			"",
			"required",
			"WAIT task must have seconds >= 1",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateCallActivityTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*CallActivityTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for CALL_ACTIVITY task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.activity", cfg.Activity); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.activity",
			"",
			"required",
			"CALL_ACTIVITY task must have an activity",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateRaiseTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*RaiseTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for RAISE task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.RequiredInterfaceWithMessage("config.error", cfg.Error, "RAISE task must have an error"); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.error",
			"",
			"required",
			"RAISE task must have an error",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateRunTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*RunTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for RUN task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.workflow", cfg.Workflow); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.workflow",
			"",
			"required",
			"RUN task must have a workflow name",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateAgentCallTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*AgentCallTaskConfig)
	if !ok {
		return validation.NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for AGENT_CALL task",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.Required("config.agent", cfg.Agent); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.agent",
			"",
			"required",
			"AGENT_CALL task must have an agent",
			ErrInvalidTaskConfig,
		)
	}
	if err := validation.RequiredInterfaceWithMessage("config.message", cfg.Message, "AGENT_CALL task must have a message"); err != nil {
		return validation.NewValidationErrorWithCause(
			"config.message",
			"",
			"required",
			"AGENT_CALL task must have a message",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}
