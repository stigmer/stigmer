package workflow

import (
	"fmt"
	"regexp"
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
			return NewValidationErrorWithCause(
				fmt.Sprintf("tasks[%d].name", i),
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
	if name == "" {
		return NewValidationErrorWithCause(
			"name",
			name,
			"required",
			"task name is required",
			ErrInvalidTaskName,
		)
	}

	if len(name) < taskNameMinLength || len(name) > taskNameMaxLength {
		return NewValidationErrorWithCause(
			"name",
			name,
			"length",
			fmt.Sprintf("task name must be between %d and %d characters", taskNameMinLength, taskNameMaxLength),
			ErrInvalidTaskName,
		)
	}

	if !taskNameRegex.MatchString(name) {
		return NewValidationErrorWithCause(
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
		TaskKindRun:
		return nil
	default:
		return NewValidationErrorWithCause(
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
	default:
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for SET task",
			ErrInvalidTaskConfig,
		)
	}
	if len(cfg.Variables) == 0 {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for HTTP_CALL task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Method == "" {
		return NewValidationErrorWithCause(
			"config.method",
			"",
			"required",
			"HTTP_CALL task must have a method",
			ErrInvalidTaskConfig,
		)
	}
	// Validate method is one of: GET, POST, PUT, DELETE, PATCH
	validMethods := map[string]bool{"GET": true, "POST": true, "PUT": true, "DELETE": true, "PATCH": true}
	if !validMethods[cfg.Method] {
		return NewValidationErrorWithCause(
			"config.method",
			cfg.Method,
			"enum",
			"HTTP method must be one of: GET, POST, PUT, DELETE, PATCH",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.URI == "" {
		return NewValidationErrorWithCause(
			"config.uri",
			"",
			"required",
			"HTTP_CALL task must have a URI",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.TimeoutSeconds < 0 || cfg.TimeoutSeconds > 300 {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for GRPC_CALL task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Service == "" {
		return NewValidationErrorWithCause(
			"config.service",
			"",
			"required",
			"GRPC_CALL task must have a service",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Method == "" {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for SWITCH task",
			ErrInvalidTaskConfig,
		)
	}
	if len(cfg.Cases) == 0 {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for FOR task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.In == "" {
		return NewValidationErrorWithCause(
			"config.in",
			"",
			"required",
			"FOR task must have an 'in' expression",
			ErrInvalidTaskConfig,
		)
	}
	if len(cfg.Do) == 0 {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for FORK task",
			ErrInvalidTaskConfig,
		)
	}
	if len(cfg.Branches) == 0 {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for TRY task",
			ErrInvalidTaskConfig,
		)
	}
	if len(cfg.Tasks) == 0 {
		return NewValidationErrorWithCause(
			"config.tasks",
			"",
			"required",
			"TRY task must have at least one task",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateListenTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*ListenTaskConfig)
	if !ok {
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for LISTEN task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Event == "" {
		return NewValidationErrorWithCause(
			"config.event",
			"",
			"required",
			"LISTEN task must have an event",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateWaitTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*WaitTaskConfig)
	if !ok {
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for WAIT task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Duration == "" {
		return NewValidationErrorWithCause(
			"config.duration",
			"",
			"required",
			"WAIT task must have a duration",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}

func validateCallActivityTaskConfig(task *Task) error {
	cfg, ok := task.Config.(*CallActivityTaskConfig)
	if !ok {
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for CALL_ACTIVITY task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Activity == "" {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for RAISE task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.Error == "" {
		return NewValidationErrorWithCause(
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
		return NewValidationErrorWithCause(
			"config",
			"",
			"type",
			"invalid config type for RUN task",
			ErrInvalidTaskConfig,
		)
	}
	if cfg.WorkflowName == "" {
		return NewValidationErrorWithCause(
			"config.workflow",
			"",
			"required",
			"RUN task must have a workflow name",
			ErrInvalidTaskConfig,
		)
	}
	return nil
}
