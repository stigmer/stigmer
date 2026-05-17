/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package tasks

import (
	"github.com/serverlessworkflow/sdk-go/v3/model"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// ResolveTaskKind maps a CNCF Serverless Workflow task model to the
// corresponding WorkflowTaskKind proto enum value. Returns unspecified
// for unrecognized types.
func ResolveTaskKind(task model.Task) workflowv1.WorkflowTaskKind {
	switch t := task.(type) {
	case *model.CallHTTP:
		return workflowv1.WorkflowTaskKind_http_call
	case *model.CallGRPC:
		return workflowv1.WorkflowTaskKind_grpc_call
	case *model.SetTask:
		return workflowv1.WorkflowTaskKind_set_vars
	case *model.SwitchTask:
		return workflowv1.WorkflowTaskKind_switch_case
	case *model.ForTask:
		return workflowv1.WorkflowTaskKind_for_each
	case *model.ForkTask:
		return workflowv1.WorkflowTaskKind_fork
	case *model.TryTask:
		return workflowv1.WorkflowTaskKind_try_catch
	case *model.ListenTask:
		return workflowv1.WorkflowTaskKind_listen
	case *model.WaitTask:
		return workflowv1.WorkflowTaskKind_wait
	case *model.RaiseTask:
		return workflowv1.WorkflowTaskKind_raise_error
	case *model.RunTask:
		return workflowv1.WorkflowTaskKind_run_workflow
	case *model.DoTask:
		return workflowv1.WorkflowTaskKind_workflow_task_kind_unspecified
	case *model.CallFunction:
		return resolveCallFunctionKind(t.Call)
	default:
		return workflowv1.WorkflowTaskKind_workflow_task_kind_unspecified
	}
}

func resolveCallFunctionKind(call string) workflowv1.WorkflowTaskKind {
	switch call {
	case customCallFunctionAgent:
		return workflowv1.WorkflowTaskKind_agent_call
	case customCallFunctionActivity:
		return workflowv1.WorkflowTaskKind_activity_call
	case customCallFunctionLlm:
		return workflowv1.WorkflowTaskKind_llm_call
	case customCallFunctionTransform:
		return workflowv1.WorkflowTaskKind_transform
	case customCallFunctionHumanInput:
		return workflowv1.WorkflowTaskKind_human_input
	case customCallFunctionValidate:
		return workflowv1.WorkflowTaskKind_validate
	case customCallFunctionEmitEvent:
		return workflowv1.WorkflowTaskKind_emit_event
	case customCallFunctionNotification:
		return workflowv1.WorkflowTaskKind_notification
	case customCallFunctionEval:
		return workflowv1.WorkflowTaskKind_eval
	default:
		return workflowv1.WorkflowTaskKind_workflow_task_kind_unspecified
	}
}
