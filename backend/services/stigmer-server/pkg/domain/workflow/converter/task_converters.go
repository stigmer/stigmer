package converter

import (
	"fmt"
	"strings"
	"time"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/proto"
)

// convertTaskByKind dispatches to the appropriate type-safe converter based on task kind.
func (c *Converter) convertTaskByKind(kind workflowv1.WorkflowTaskKind, typedProto proto.Message) (map[string]interface{}, error) {
	switch kind {
	case workflowv1.WorkflowTaskKind_set_vars:
		return convertSetTask(typedProto.(*tasksv1.SetTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_http_call:
		return convertHttpCallTask(typedProto.(*tasksv1.HttpCallTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_grpc_call:
		return convertGrpcCallTask(typedProto.(*tasksv1.GrpcCallTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_switch_case:
		return convertSwitchTask(typedProto.(*tasksv1.SwitchTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_for_each:
		return c.convertForTask(typedProto.(*tasksv1.ForTaskConfig))
	case workflowv1.WorkflowTaskKind_fork:
		return c.convertForkTask(typedProto.(*tasksv1.ForkTaskConfig))
	case workflowv1.WorkflowTaskKind_try_catch:
		return c.convertTryTask(typedProto.(*tasksv1.TryTaskConfig))
	case workflowv1.WorkflowTaskKind_listen:
		return convertListenTask(typedProto.(*tasksv1.ListenTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_wait:
		return convertWaitTask(typedProto.(*tasksv1.WaitTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_raise_error:
		return convertRaiseTask(typedProto.(*tasksv1.RaiseTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_run_workflow:
		return convertRunTask(typedProto.(*tasksv1.RunTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_agent_call:
		return convertAgentCallTask(typedProto.(*tasksv1.AgentCallTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_llm_call:
		return convertLlmCallTask(typedProto.(*tasksv1.LlmCallTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_transform:
		return convertTransformTask(typedProto.(*tasksv1.TransformTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_human_input:
		return convertHumanInputTask(typedProto.(*tasksv1.HumanInputTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_validate:
		return convertValidateTask(typedProto.(*tasksv1.ValidateTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_emit_event:
		return convertEmitEventTask(typedProto.(*tasksv1.EmitEventTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_notification:
		return convertNotificationTask(typedProto.(*tasksv1.NotificationTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_eval:
		return convertEvalTask(typedProto.(*tasksv1.EvalTaskConfig)), nil
	case workflowv1.WorkflowTaskKind_activity_call:
		return nil, fmt.Errorf("activity_call not yet implemented")
	default:
		return nil, fmt.Errorf("unsupported task kind: %v", kind)
	}
}

func convertSetTask(cfg *tasksv1.SetTaskConfig) map[string]interface{} {
	return map[string]interface{}{
		"set": cfg.Variables,
	}
}

func convertHttpCallTask(cfg *tasksv1.HttpCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"method": cfg.Method,
	}

	if cfg.Endpoint != nil {
		with["endpoint"] = map[string]interface{}{
			"uri": cfg.Endpoint.Uri,
		}
	}

	if len(cfg.Headers) > 0 {
		with["headers"] = cfg.Headers
	}

	if cfg.TimeoutSeconds > 0 {
		with["timeout_seconds"] = cfg.TimeoutSeconds
	}
	if cfg.Body != nil && len(cfg.Body.AsMap()) > 0 {
		with["body"] = cfg.Body.AsMap()
	}

	return map[string]interface{}{
		"call": "http",
		"with": with,
	}
}

func convertGrpcCallTask(cfg *tasksv1.GrpcCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"service": cfg.Service,
		"method":  cfg.Method,
	}

	if cfg.Request != nil && len(cfg.Request.AsMap()) > 0 {
		with["request"] = cfg.Request.AsMap()
	}

	return map[string]interface{}{
		"call": "grpc",
		"with": with,
	}
}

func convertSwitchTask(cfg *tasksv1.SwitchTaskConfig) map[string]interface{} {
	items := make([]map[string]interface{}, len(cfg.Cases))
	for i, switchCase := range cfg.Cases {
		caseBody := map[string]interface{}{}
		if switchCase.When != "" {
			caseBody["when"] = switchCase.When
		}
		if switchCase.Then != "" {
			caseBody["then"] = switchCase.Then
		}

		name := switchCase.Name
		if name == "" {
			name = "default"
		}
		items[i] = map[string]interface{}{name: caseBody}
	}

	return map[string]interface{}{
		"switch": items,
	}
}

func (c *Converter) convertForTask(cfg *tasksv1.ForTaskConfig) (map[string]interface{}, error) {
	forMap := map[string]interface{}{
		"in": cfg.In,
	}

	if cfg.Each != "" {
		forMap["each"] = cfg.Each
	}

	result := map[string]interface{}{
		"for": forMap,
	}

	if len(cfg.Do) > 0 {
		doTasks, err := c.convertTaskList(cfg.Do)
		if err != nil {
			return nil, fmt.Errorf("for_each do block: %w", err)
		}
		result["do"] = doTasks
	}

	return result, nil
}

func (c *Converter) convertForkTask(cfg *tasksv1.ForkTaskConfig) (map[string]interface{}, error) {
	branches := make([]map[string]interface{}, len(cfg.Branches))
	for i, branch := range cfg.Branches {
		branchBody := map[string]interface{}{}
		if len(branch.Do) > 0 {
			doTasks, err := c.convertTaskList(branch.Do)
			if err != nil {
				return nil, fmt.Errorf("fork branch %q do block: %w", branch.Name, err)
			}
			branchBody["do"] = doTasks
		}
		branches[i] = map[string]interface{}{branch.Name: branchBody}
	}

	forkMap := map[string]interface{}{
		"branches": branches,
	}

	if cfg.Compete {
		forkMap["compete"] = true
	}

	return map[string]interface{}{
		"fork": forkMap,
	}, nil
}

func (c *Converter) convertTryTask(cfg *tasksv1.TryTaskConfig) (map[string]interface{}, error) {
	result := map[string]interface{}{}

	if len(cfg.Try) > 0 {
		tryTasks, err := c.convertTaskList(cfg.Try)
		if err != nil {
			return nil, fmt.Errorf("try block: %w", err)
		}
		result["try"] = tryTasks
	}

	if cfg.Catch != nil {
		catchMap := map[string]interface{}{}
		if cfg.Catch.As != "" {
			catchMap["as"] = cfg.Catch.As
		}
		if len(cfg.Catch.Do) > 0 {
			catchTasks, err := c.convertTaskList(cfg.Catch.Do)
			if err != nil {
				return nil, fmt.Errorf("catch block: %w", err)
			}
			catchMap["do"] = catchTasks
		}
		if cfg.Catch.Compensate {
			catchMap["compensate"] = true
		}
		result["catch"] = catchMap
	}

	return result, nil
}

func convertListenTask(cfg *tasksv1.ListenTaskConfig) map[string]interface{} {
	to := make(map[string]interface{})

	eventFilters := make([]map[string]interface{}, len(cfg.To.Signals))
	for i, sig := range cfg.To.Signals {
		eventFilters[i] = map[string]interface{}{
			"with": map[string]interface{}{
				"id":   sig.Id,
				"type": sig.Type,
			},
		}
	}

	switch {
	case cfg.To.Mode == "one" && len(eventFilters) == 1:
		to["one"] = eventFilters[0]
	case cfg.To.Mode == "one":
		to["any"] = eventFilters
	default:
		to["all"] = eventFilters
	}

	return map[string]interface{}{
		"listen": map[string]interface{}{
			"to": to,
		},
	}
}

func convertWaitTask(cfg *tasksv1.WaitTaskConfig) map[string]interface{} {
	switch w := cfg.GetWaitType().(type) {
	case *tasksv1.WaitTaskConfig_Duration:
		duration := make(map[string]interface{})
		if w.Duration.GetDays() > 0 {
			duration["days"] = w.Duration.GetDays()
		}
		if w.Duration.GetHours() > 0 {
			duration["hours"] = w.Duration.GetHours()
		}
		if w.Duration.GetMinutes() > 0 {
			duration["minutes"] = w.Duration.GetMinutes()
		}
		if w.Duration.GetSeconds() > 0 {
			duration["seconds"] = w.Duration.GetSeconds()
		}
		if w.Duration.GetMilliseconds() > 0 {
			duration["milliseconds"] = w.Duration.GetMilliseconds()
		}
		return map[string]interface{}{
			"wait": duration,
		}

	case *tasksv1.WaitTaskConfig_Until:
		return map[string]interface{}{
			"wait": w.Until.AsTime().Format(time.RFC3339),
		}

	default:
		return map[string]interface{}{
			"wait": map[string]interface{}{"seconds": 0},
		}
	}
}

var raiseErrorTypeMapping = map[string]struct {
	typeURI string
	status  int
}{
	"validationerror":     {"https://serverlessworkflow.io/spec/1.0.0/errors/validation", 400},
	"authenticationerror": {"https://serverlessworkflow.io/spec/1.0.0/errors/authentication", 401},
	"authorizationerror":  {"https://serverlessworkflow.io/spec/1.0.0/errors/authorization", 403},
	"configurationerror":  {"https://serverlessworkflow.io/spec/1.0.0/errors/configuration", 400},
	"timeouterror":        {"https://serverlessworkflow.io/spec/1.0.0/errors/timeout", 408},
	"communicationerror":  {"https://serverlessworkflow.io/spec/1.0.0/errors/communication", 502},
	"expressionerror":     {"https://serverlessworkflow.io/spec/1.0.0/errors/expression", 400},
	"runtimeerror":        {"https://serverlessworkflow.io/spec/1.0.0/errors/runtime", 500},
}

func convertRaiseTask(cfg *tasksv1.RaiseTaskConfig) map[string]interface{} {
	typeURI := "https://serverlessworkflow.io/spec/1.0.0/errors/runtime"
	status := 500

	if mapped, ok := raiseErrorTypeMapping[strings.ToLower(cfg.Error)]; ok {
		typeURI = mapped.typeURI
		status = mapped.status
	} else if strings.HasPrefix(cfg.Error, "https://") {
		typeURI = cfg.Error
	}

	errorDef := map[string]interface{}{
		"type":   typeURI,
		"status": status,
		"title":  cfg.Error,
	}
	if cfg.Message != "" {
		errorDef["detail"] = cfg.Message
	}

	return map[string]interface{}{
		"raise": map[string]interface{}{
			"error": errorDef,
		},
	}
}

func convertRunTask(cfg *tasksv1.RunTaskConfig) map[string]interface{} {
	run := map[string]interface{}{
		"workflow": map[string]interface{}{
			"name": cfg.Workflow,
		},
	}

	if cfg.Input != nil && len(cfg.Input.AsMap()) > 0 {
		run["with"] = cfg.Input.AsMap()
	}

	return map[string]interface{}{
		"run": run,
	}
}

func convertLlmCallTask(cfg *tasksv1.LlmCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"model":  cfg.Model,
		"prompt": cfg.Prompt,
	}

	if cfg.SystemPrompt != "" {
		with["system_prompt"] = cfg.SystemPrompt
	}
	if cfg.ResponseSchema != nil && len(cfg.ResponseSchema.AsMap()) > 0 {
		with["response_schema"] = cfg.ResponseSchema.AsMap()
	}
	if cfg.Temperature != 0 {
		with["temperature"] = cfg.Temperature
	}
	if cfg.MaxTokens > 0 {
		with["max_tokens"] = cfg.MaxTokens
	}
	if cfg.Timeout > 0 {
		with["timeout"] = cfg.Timeout
	}
	if cfg.OnInvalid != tasksv1.OnInvalidOutputPolicy_ON_INVALID_POLICY_UNSPECIFIED {
		with["on_invalid"] = cfg.OnInvalid.String()
	}
	if cfg.MaxRetries > 0 {
		with["max_retries"] = cfg.MaxRetries
	}
	if cfg.FallbackTask != "" {
		with["fallback_task"] = cfg.FallbackTask
	}
	if cfg.MaxCostMicros > 0 {
		with["max_cost_micros"] = cfg.MaxCostMicros
	}
	if cfg.MaxTotalTokens > 0 {
		with["max_total_tokens"] = cfg.MaxTotalTokens
	}

	return map[string]interface{}{
		"call": "llm",
		"with": with,
	}
}

func convertTransformTask(cfg *tasksv1.TransformTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"engine":     cfg.Engine.String(),
		"expression": cfg.Expression,
	}

	if cfg.Input != "" {
		with["input"] = cfg.Input
	}

	return map[string]interface{}{
		"call": "transform",
		"with": with,
	}
}

func convertHumanInputTask(cfg *tasksv1.HumanInputTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"prompt": cfg.Prompt,
	}

	if cfg.FormSchema != nil && len(cfg.FormSchema.AsMap()) > 0 {
		with["form_schema"] = cfg.FormSchema.AsMap()
	}
	if len(cfg.Outcomes) > 0 {
		outcomes := make([]map[string]interface{}, 0, len(cfg.Outcomes))
		for _, o := range cfg.Outcomes {
			om := map[string]interface{}{"name": o.Name}
			if o.Label != "" {
				om["label"] = o.Label
			}
			if o.Then != "" {
				om["then"] = o.Then
			}
			outcomes = append(outcomes, om)
		}
		with["outcomes"] = outcomes
	}
	if len(cfg.Approvers) > 0 {
		with["approvers"] = cfg.Approvers
	}
	if cfg.Timeout > 0 {
		with["timeout"] = cfg.Timeout
	}
	if cfg.OnTimeout != tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED {
		with["on_timeout"] = cfg.OnTimeout.String()
	}
	if len(cfg.NotificationChannels) > 0 {
		with["notification_channels"] = cfg.NotificationChannels
	}

	return map[string]interface{}{
		"call": "human_input",
		"with": with,
	}
}

func convertValidateTask(cfg *tasksv1.ValidateTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"input": cfg.Input,
	}

	if cfg.Schema != nil && len(cfg.Schema.AsMap()) > 0 {
		with["schema"] = cfg.Schema.AsMap()
	}
	if len(cfg.Rules) > 0 {
		rules := make([]map[string]interface{}, 0, len(cfg.Rules))
		for _, r := range cfg.Rules {
			rm := map[string]interface{}{
				"name":       r.Name,
				"expression": r.Expression,
			}
			if r.Message != "" {
				rm["message"] = r.Message
			}
			rules = append(rules, rm)
		}
		with["rules"] = rules
	}
	if cfg.OnFail != tasksv1.ValidationFailPolicy_VALIDATION_FAIL_POLICY_UNSPECIFIED {
		with["on_fail"] = cfg.OnFail.String()
	}
	if cfg.FallbackTask != "" {
		with["fallback_task"] = cfg.FallbackTask
	}

	return map[string]interface{}{
		"call": "validate",
		"with": with,
	}
}

func convertEmitEventTask(cfg *tasksv1.EmitEventTaskConfig) map[string]interface{} {
	event := map[string]interface{}{
		"type": cfg.Event.Type,
	}

	if cfg.Event.Source != "" {
		event["source"] = cfg.Event.Source
	}
	if cfg.Event.Subject != "" {
		event["subject"] = cfg.Event.Subject
	}
	if cfg.Event.Data != nil && len(cfg.Event.Data.AsMap()) > 0 {
		event["data"] = cfg.Event.Data.AsMap()
	}

	return map[string]interface{}{
		"call": "emit_event",
		"with": map[string]interface{}{
			"event": event,
		},
	}
}

func convertNotificationTask(cfg *tasksv1.NotificationTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"channel":    cfg.Channel,
		"recipients": cfg.Recipients,
		"body":       cfg.Body,
	}

	if cfg.Subject != "" {
		with["subject"] = cfg.Subject
	}
	if cfg.Template != "" {
		with["template"] = cfg.Template
	}
	if len(cfg.Metadata) > 0 {
		with["metadata"] = cfg.Metadata
	}

	return map[string]interface{}{
		"call": "notification",
		"with": with,
	}
}

func convertEvalTask(cfg *tasksv1.EvalTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"model":   cfg.Model,
		"subject": cfg.Subject,
		"rubric":  cfg.Rubric,
	}

	if cfg.ScoringMode != tasksv1.EvalScoringMode_EVAL_SCORING_MODE_UNSPECIFIED {
		with["scoring_mode"] = cfg.ScoringMode.String()
	}
	if cfg.Threshold != 0 {
		with["threshold"] = cfg.Threshold
	}
	if cfg.OnFail != tasksv1.EvalFailPolicy_EVAL_FAIL_POLICY_UNSPECIFIED {
		with["on_fail"] = cfg.OnFail.String()
	}
	if cfg.FallbackTask != "" {
		with["fallback_task"] = cfg.FallbackTask
	}
	if cfg.SystemPrompt != "" {
		with["system_prompt"] = cfg.SystemPrompt
	}
	if len(cfg.Criteria) > 0 {
		criteria := make([]map[string]interface{}, 0, len(cfg.Criteria))
		for _, cr := range cfg.Criteria {
			cm := map[string]interface{}{
				"name":        cr.Name,
				"description": cr.Description,
			}
			if cr.Weight != 0 {
				cm["weight"] = cr.Weight
			}
			criteria = append(criteria, cm)
		}
		with["criteria"] = criteria
	}
	if cfg.MaxCostMicros > 0 {
		with["max_cost_micros"] = cfg.MaxCostMicros
	}

	return map[string]interface{}{
		"call": "eval",
		"with": with,
	}
}

func convertAgentCallTask(cfg *tasksv1.AgentCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"agent":   cfg.Agent,
		"message": cfg.Message,
	}

	if len(cfg.Env) > 0 {
		with["env"] = cfg.Env
	}

	if cfg.Config != nil {
		config := map[string]interface{}{}
		if cfg.Config.Model != "" {
			config["model"] = cfg.Config.Model
		}
		if cfg.Config.Timeout > 0 {
			config["timeout"] = cfg.Config.Timeout
		}
		if cfg.Config.Temperature != 0 {
			config["temperature"] = cfg.Config.Temperature
		}
		if cfg.Config.MaxCostMicros > 0 {
			config["max_cost_micros"] = cfg.Config.MaxCostMicros
		}
		if len(config) > 0 {
			with["config"] = config
		}
	}

	if cfg.Output != nil {
		output := map[string]interface{}{}
		if cfg.Output.Schema != nil {
			output["schema"] = cfg.Output.Schema.AsMap()
		}
		if cfg.Output.OnInvalid != tasksv1.OnInvalidOutputPolicy_ON_INVALID_POLICY_UNSPECIFIED {
			output["on_invalid"] = cfg.Output.OnInvalid.String()
		}
		if cfg.Output.MaxRetries > 0 {
			output["max_retries"] = cfg.Output.MaxRetries
		}
		if cfg.Output.FallbackTask != "" {
			output["fallback_task"] = cfg.Output.FallbackTask
		}
		if len(output) > 0 {
			with["output"] = output
		}
	}

	if cfg.Harness != sessionv1.Harness_HARNESS_UNSPECIFIED {
		switch cfg.Harness {
		case sessionv1.Harness_HARNESS_NATIVE:
			with["harness"] = "native"
		case sessionv1.Harness_HARNESS_CURSOR:
			with["harness"] = "cursor"
		}
	}

	return map[string]interface{}{
		"call": "agent",
		"with": with,
	}
}
