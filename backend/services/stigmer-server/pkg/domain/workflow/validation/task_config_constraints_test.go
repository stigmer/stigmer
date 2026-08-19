package validation

// Probes for the declared proto rules ValidateTaskConfigConstraints arms
// (stigmer#805). Each test named after a retired hand-written check from
// ValidateTaskConfigRequiredFields (now ValidateTaskConfigSurfaceRules) proves
// the proto rule reports the same condition — the retirement audit, executable.
// Assertions pin the exact rendered string: the rendering is byte-lockstep
// with the cloud Java validator, so a drift in either the rule or the
// formatter is caught here before the conformance lane sees it.

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
)

// constraintViolations is the test shorthand: single-task spec in, rendered
// violations out. Machinery faults fail the test — they are never expected.
func constraintViolations(t *testing.T, name string, kind workflowv1.WorkflowTaskKind, cfg map[string]interface{}) []string {
	t.Helper()
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{makeTask(name, kind, cfg)},
	}
	violations, err := ValidateTaskConfigConstraints(spec)
	if err != nil {
		t.Fatalf("constraint validation machinery fault: %v", err)
	}
	return violations
}

func assertViolations(t *testing.T, got []string, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("expected %d violation(s) %q, got %q", len(want), want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("violation[%d]:\nwant %q\ngot  %q", i, want[i], got[i])
		}
	}
}

// The issue's anchor case: wait's Duration carries the duration.non_zero
// message-level CEL rule — present-but-all-zero is INVALID, absent stays VALID
// (the wait_type oneof is deliberately not required; parity-pinned in Java by
// waitNullDurationMatchesGo).
func TestValidateTaskConfigConstraints_WaitDuration(t *testing.T) {
	t.Run("empty duration violates duration.non_zero", func(t *testing.T) {
		got := constraintViolations(t, "conditional_wait", workflowv1.WorkflowTaskKind_wait,
			map[string]interface{}{"duration": map[string]interface{}{}})
		assertViolations(t, got,
			"task 'conditional_wait' (wait): duration \u2013 at least one duration field must be non-zero")
	})

	t.Run("non-zero duration passes", func(t *testing.T) {
		got := constraintViolations(t, "conditional_wait", workflowv1.WorkflowTaskKind_wait,
			map[string]interface{}{"duration": map[string]interface{}{"seconds": float64(5)}})
		assertViolations(t, got)
	})

	t.Run("absent duration passes (oneof not required)", func(t *testing.T) {
		got := constraintViolations(t, "conditional_wait", workflowv1.WorkflowTaskKind_wait,
			map[string]interface{}{})
		assertViolations(t, got)
	})
}

// Retired: the llm_call model/prompt hand-check — subsumed by the fields'
// (buf.validate.field).required rules.
func TestValidateTaskConfigConstraints_LlmCallRequired(t *testing.T) {
	t.Run("missing model is rejected", func(t *testing.T) {
		got := constraintViolations(t, "classify", workflowv1.WorkflowTaskKind_llm_call,
			map[string]interface{}{"prompt": "Classify this ticket"})
		assertViolations(t, got, "task 'classify' (llm_call): model \u2013 value is required")
	})

	t.Run("empty strings are rejected like absence", func(t *testing.T) {
		got := constraintViolations(t, "classify", workflowv1.WorkflowTaskKind_llm_call,
			map[string]interface{}{"model": "", "prompt": ""})
		assertViolations(t, got,
			"task 'classify' (llm_call): model \u2013 value is required",
			"task 'classify' (llm_call): prompt \u2013 value is required")
	})

	t.Run("model and prompt present pass", func(t *testing.T) {
		got := constraintViolations(t, "classify", workflowv1.WorkflowTaskKind_llm_call,
			map[string]interface{}{"model": "gpt-4o", "prompt": "Classify: ${ $context.ticket }"})
		assertViolations(t, got)
	})
}

// Retired: the raise_error 'error' hand-check. message stays optional by the
// #685 ruling — the proto is the contract, and it has no rule on message.
func TestValidateTaskConfigConstraints_RaiseErrorRequired(t *testing.T) {
	t.Run("missing error is rejected", func(t *testing.T) {
		got := constraintViolations(t, "fail_fast", workflowv1.WorkflowTaskKind_raise_error,
			map[string]interface{}{"message": "something broke"})
		assertViolations(t, got, "task 'fail_fast' (raise_error): error \u2013 value is required")
	})

	t.Run("error without message passes", func(t *testing.T) {
		got := constraintViolations(t, "fail_fast", workflowv1.WorkflowTaskKind_raise_error,
			map[string]interface{}{"error": "ValidationError"})
		assertViolations(t, got)
	})
}

// Retired: the human_input prompt hand-check.
func TestValidateTaskConfigConstraints_HumanInputPromptRequired(t *testing.T) {
	got := constraintViolations(t, "review", workflowv1.WorkflowTaskKind_human_input,
		map[string]interface{}{"outcomes": []interface{}{map[string]interface{}{"name": "approve"}}})
	assertViolations(t, got, "task 'review' (human_input): prompt \u2013 value is required")
}

// Retired: the eval model/subject/rubric hand-check.
func TestValidateTaskConfigConstraints_EvalRequired(t *testing.T) {
	got := constraintViolations(t, "judge", workflowv1.WorkflowTaskKind_eval, map[string]interface{}{})
	assertViolations(t, got,
		"task 'judge' (eval): model \u2013 value is required",
		"task 'judge' (eval): subject \u2013 value is required",
		"task 'judge' (eval): rubric \u2013 value is required")
}

// Retired: the http_call method/endpoint/endpoint.uri hand-checks —
// protovalidate descends into the endpoint message, so the nested uri rule
// fires with its dotted path.
func TestValidateTaskConfigConstraints_HttpCallRequired(t *testing.T) {
	t.Run("empty config reports method and endpoint", func(t *testing.T) {
		got := constraintViolations(t, "fetch", workflowv1.WorkflowTaskKind_http_call, map[string]interface{}{})
		assertViolations(t, got,
			"task 'fetch' (http_call): method \u2013 value is required",
			"task 'fetch' (http_call): endpoint \u2013 value is required")
	})

	t.Run("endpoint without uri is rejected", func(t *testing.T) {
		got := constraintViolations(t, "fetch", workflowv1.WorkflowTaskKind_http_call,
			map[string]interface{}{"method": "GET", "endpoint": map[string]interface{}{}})
		assertViolations(t, got, "task 'fetch' (http_call): endpoint.uri \u2013 value is required")
	})
}

// Retired: the grpc_call service/method hand-check.
func TestValidateTaskConfigConstraints_GrpcCallRequired(t *testing.T) {
	got := constraintViolations(t, "call", workflowv1.WorkflowTaskKind_grpc_call, map[string]interface{}{})
	assertViolations(t, got,
		"task 'call' (grpc_call): service \u2013 value is required",
		"task 'call' (grpc_call): method \u2013 value is required")
}

// Retired: the activity_call activity hand-check.
func TestValidateTaskConfigConstraints_ActivityCallRequired(t *testing.T) {
	got := constraintViolations(t, "invoke", workflowv1.WorkflowTaskKind_activity_call, map[string]interface{}{})
	assertViolations(t, got, "task 'invoke' (activity_call): activity \u2013 value is required")
}

// Retired: the agent_call run_config bounds hand-check — subsumed by
// RunConfig's gte-0 rules (invocation.proto).
func TestValidateTaskConfigConstraints_AgentCallRunConfigBounds(t *testing.T) {
	base := func(runConfig map[string]interface{}) map[string]interface{} {
		return map[string]interface{}{"agent": "test-agent", "message": "test message", "run_config": runConfig}
	}

	t.Run("negative bounds are rejected", func(t *testing.T) {
		got := constraintViolations(t, "triage", workflowv1.WorkflowTaskKind_agent_call,
			base(map[string]interface{}{"max_cost_usd": -0.5, "max_tool_rounds": float64(-1)}))
		assertViolations(t, got,
			"task 'triage' (agent_call): run_config.max_cost_usd \u2013 must be greater than or equal to 0",
			"task 'triage' (agent_call): run_config.max_tool_rounds \u2013 must be greater than or equal to 0")
	})

	t.Run("valid bounds pass", func(t *testing.T) {
		got := constraintViolations(t, "triage", workflowv1.WorkflowTaskKind_agent_call,
			base(map[string]interface{}{"model_name": "claude-sonnet-4-6", "max_cost_usd": 0.5, "max_tool_rounds": float64(15)}))
		assertViolations(t, got)
	})

	t.Run("absent run_config passes", func(t *testing.T) {
		got := constraintViolations(t, "triage", workflowv1.WorkflowTaskKind_agent_call,
			map[string]interface{}{"agent": "test-agent", "message": "test message"})
		assertViolations(t, got)
	})
}

// Retired: the workspace_entries source-presence and HTTPS hand-checks —
// subsumed by WorkspaceEntry.source's required rule and GitRepoSource's
// git_repo_source.url.https CEL (whose proto message carries the same
// SSH-hint text the hand-check used to emit). The git_repo-vs-local_path
// surface rule remains hand-written — see ValidateTaskConfigSurfaceRules.
func TestValidateTaskConfigConstraints_AgentCallWorkspaceEntries(t *testing.T) {
	base := func(entries []interface{}) map[string]interface{} {
		return map[string]interface{}{"agent": "test-agent", "message": "test message", "workspace_entries": entries}
	}

	t.Run("missing source is rejected", func(t *testing.T) {
		got := constraintViolations(t, "review", workflowv1.WorkflowTaskKind_agent_call,
			base([]interface{}{map[string]interface{}{"name": "app"}}))
		assertViolations(t, got,
			"task 'review' (agent_call): workspace_entries[0].source \u2013 value is required")
	})

	t.Run("ssh url is rejected", func(t *testing.T) {
		got := constraintViolations(t, "review", workflowv1.WorkflowTaskKind_agent_call,
			base([]interface{}{map[string]interface{}{
				"name":   "app",
				"source": map[string]interface{}{"git_repo": map[string]interface{}{"url": "git@github.com:acme/app.git"}},
			}}))
		assertViolations(t, got,
			"task 'review' (agent_call): workspace_entries[0].source.git_repo.url \u2013 url must use HTTPS (e.g. https://github.com/org/repo). SSH URLs are not supported.")
	})

	t.Run("git https entry passes", func(t *testing.T) {
		got := constraintViolations(t, "review", workflowv1.WorkflowTaskKind_agent_call,
			base([]interface{}{map[string]interface{}{
				"name":   "app",
				"source": map[string]interface{}{"git_repo": map[string]interface{}{"url": "https://github.com/acme/app"}},
			}}))
		assertViolations(t, got)
	})
}

// Retired: the emit_event delivery hand-checks — the oneof-required and member
// required rules on EmitDeliveryTarget. The old "both arms set" case is now a
// STRUCTURAL refusal: protojson rejects a double-set oneof at unmarshal, so
// the conversion step reports it before this validator runs.
func TestValidateTaskConfigConstraints_EmitEventDelivery(t *testing.T) {
	base := func(delivery []interface{}) map[string]interface{} {
		return map[string]interface{}{
			"event":    map[string]interface{}{"type": "acme.order.fulfilled"},
			"delivery": delivery,
		}
	}

	t.Run("target with neither arm violates the oneof", func(t *testing.T) {
		got := constraintViolations(t, "notify", workflowv1.WorkflowTaskKind_emit_event,
			base([]interface{}{map[string]interface{}{}}))
		assertViolations(t, got,
			"task 'notify' (emit_event): delivery[0].target \u2013 exactly one field is required in oneof")
	})

	t.Run("webhook without url is rejected", func(t *testing.T) {
		got := constraintViolations(t, "notify", workflowv1.WorkflowTaskKind_emit_event,
			base([]interface{}{map[string]interface{}{
				"webhook": map[string]interface{}{"headers": map[string]interface{}{"X": "y"}},
			}}))
		assertViolations(t, got,
			"task 'notify' (emit_event): delivery[0].webhook.url \u2013 value is required")
	})

	t.Run("signal missing both fields reports each", func(t *testing.T) {
		got := constraintViolations(t, "notify", workflowv1.WorkflowTaskKind_emit_event,
			base([]interface{}{map[string]interface{}{"signal": map[string]interface{}{}}}))
		assertViolations(t, got,
			"task 'notify' (emit_event): delivery[0].signal.execution_id \u2013 value is required",
			"task 'notify' (emit_event): delivery[0].signal.signal_name \u2013 value is required")
	})

	t.Run("both arms set is a structural unmarshal refusal", func(t *testing.T) {
		_, err := converter.UnmarshalTaskConfigPublic(workflowv1.WorkflowTaskKind_emit_event,
			mustStruct(base([]interface{}{map[string]interface{}{
				"webhook": map[string]interface{}{"url": "https://hooks.acme.com"},
				"signal":  map[string]interface{}{"execution_id": "wfx_1", "signal_name": "go"},
			}})))
		if err == nil {
			t.Fatal("expected protojson to refuse a double-set oneof")
		}
	})

	t.Run("valid webhook and signal targets pass", func(t *testing.T) {
		got := constraintViolations(t, "notify", workflowv1.WorkflowTaskKind_emit_event,
			base([]interface{}{
				map[string]interface{}{"webhook": map[string]interface{}{"url": "https://hooks.acme.com/orders"}},
				map[string]interface{}{"signal": map[string]interface{}{
					"execution_id": "${ .start_shipping.execution_id }",
					"signal_name":  "order-fulfilled",
				}},
			}))
		assertViolations(t, got)
	})
}

// Net-new coverage the arming brings: kinds that never had hand-written checks
// now refuse configs their proto rules forbid (an empty set_vars or switch was
// silently VALID before stigmer#805 and failed at run time).
func TestValidateTaskConfigConstraints_NetNewCoverage(t *testing.T) {
	t.Run("set_vars requires variables", func(t *testing.T) {
		got := constraintViolations(t, "init", workflowv1.WorkflowTaskKind_set_vars, map[string]interface{}{})
		assertViolations(t, got, "task 'init' (set_vars): variables \u2013 value is required")
	})

	t.Run("switch_case requires at least one case", func(t *testing.T) {
		got := constraintViolations(t, "route", workflowv1.WorkflowTaskKind_switch_case, map[string]interface{}{})
		assertViolations(t, got, "task 'route' (switch_case): cases \u2013 must contain at least 1 item(s)")
	})
}

// The walker reaches every nesting arm the converter recurses into: for_each
// do (covered E2E in validate_spec_test.go), fork branch do, try/catch blocks,
// and compensate lists. Violation order is the cross-edition contract: own
// config first, nested tasks in declaration order, then compensate.
func TestValidateTaskConfigConstraints_NestedWalk(t *testing.T) {
	badWait := map[string]interface{}{
		"name":        "nestedWait",
		"kind":        "wait",
		"task_config": map[string]interface{}{"duration": map[string]interface{}{}},
	}
	wantNested := "task 'nestedWait' (wait): duration \u2013 at least one duration field must be non-zero"

	t.Run("fork branch do", func(t *testing.T) {
		got := constraintViolations(t, "parallel", workflowv1.WorkflowTaskKind_fork,
			map[string]interface{}{"branches": []interface{}{
				map[string]interface{}{"name": "a", "do": []interface{}{badWait}},
				map[string]interface{}{"name": "b", "do": []interface{}{
					map[string]interface{}{"name": "ok", "kind": "set_vars", "task_config": map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}},
				}},
			}})
		assertViolations(t, got, wantNested)
	})

	t.Run("try and catch blocks", func(t *testing.T) {
		got := constraintViolations(t, "guarded", workflowv1.WorkflowTaskKind_try_catch,
			map[string]interface{}{
				"try":   []interface{}{badWait},
				"catch": map[string]interface{}{"do": []interface{}{badWait}},
			})
		assertViolations(t, got, wantNested, wantNested)
	})

	t.Run("compensate list", func(t *testing.T) {
		spec := &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name: "step",
					Kind: workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: mustStruct(map[string]interface{}{
						"variables": map[string]interface{}{"x": "1"},
					}),
					Compensate: []*workflowv1.WorkflowTask{
						makeTask("undoWait", workflowv1.WorkflowTaskKind_wait,
							map[string]interface{}{"duration": map[string]interface{}{}}),
					},
				},
			},
		}
		got, err := ValidateTaskConfigConstraints(spec)
		if err != nil {
			t.Fatalf("constraint validation machinery fault: %v", err)
		}
		assertViolations(t, got,
			"task 'undoWait' (wait): duration \u2013 at least one duration field must be non-zero")
	})
}
