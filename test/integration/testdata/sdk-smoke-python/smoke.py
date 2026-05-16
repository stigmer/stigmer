"""
SDK acceptance smoke test for the stigmer Python SDK.

Exercises Agent CRUD + error handling (Tier 1) and optionally
workflow execution lifecycle (Tier 2) against a local Stigmer
service running in test mode.

Outputs a JSON result to stdout for the Go test orchestrator.
Diagnostic logs go to stderr.
"""

from __future__ import annotations

import json
import os
import sys
import time


def log(msg: str) -> None:
    print(f"[py-smoke] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    result: dict[str, object] = {"tier1": "skip", "tier2": "skip", "errors": []}

    addr = os.environ.get("STIGMER_GRPC_ADDRESS", "")
    if not addr:
        result["errors"] = ["STIGMER_GRPC_ADDRESS not set"]  # type: ignore[assignment]
        print(json.dumps(result))
        sys.exit(1)

    workflow_runner_available = (
        os.environ.get("STIGMER_WORKFLOW_RUNNER_AVAILABLE", "false") == "true"
    )

    from stigmer import StigmerClient, is_not_found
    from stigmer import (
        AgentInput,
        WorkflowInput,
        WorkflowDocumentInput,
        WorkflowTaskInput,
        ExportInput,
        WorkflowExecutionInput,
    )
    from ai.stigmer.agentic.workflow.v1 import enum_pb2 as wf_enum
    from ai.stigmer.agentic.workflowexecution.v1 import enum_pb2 as wfe_enum

    client = StigmerClient(api_key="test-api-key", base_url=addr, insecure=True)

    # -------------------------------------------------------------------
    # Tier 1: Agent CRUD + error handling
    # -------------------------------------------------------------------
    try:
        agent_name = f"sdk-smoke-py-{int(time.time() * 1000)}"

        # Create
        log("creating agent...")
        created = client.agents.apply(
            AgentInput(
                name=agent_name,
                org="test-org",
                description="SDK acceptance smoke test agent (Python)",
                instructions="You are a test agent. Respond with exactly: hello from sdk smoke test",
            )
        )
        agent_id = created.metadata.id
        if not agent_id:
            raise ValueError("created agent has no ID")
        log(f"created agent: id={agent_id}")

        # Get
        log("fetching agent...")
        fetched = client.agents.get(agent_id)
        assert_equal("agent name", fetched.metadata.name, agent_name)
        assert_equal("agent org", fetched.metadata.org, "test-org")
        assert_equal(
            "agent description",
            fetched.spec.description,
            "SDK acceptance smoke test agent (Python)",
        )

        # List
        log("listing agents...")
        from stigmer import ListParams

        list_result = client.agents.list(ListParams(org="test-org"))
        if list_result.total_count < 1:
            raise ValueError(
                f"agent list must contain at least one entry, got {list_result.total_count}"
            )

        # Delete
        log("deleting agent...")
        client.agents.delete(agent_id)

        # Get deleted -> NOT_FOUND
        log("verifying NOT_FOUND after delete...")
        try:
            client.agents.get(agent_id)
            raise ValueError("expected NOT_FOUND error but get succeeded")
        except Exception as err:
            if not is_not_found(err):
                raise ValueError(f"expected NOT_FOUND error, got: {err}") from err

        log("Tier 1 passed")
        result["tier1"] = "pass"

    except Exception as err:
        log(f"Tier 1 FAILED: {err}")
        result["tier1"] = "fail"
        result["errors"].append(f"tier1: {err}")  # type: ignore[union-attr]
        print(json.dumps(result))
        sys.exit(1)

    # -------------------------------------------------------------------
    # Tier 2: Workflow execution lifecycle
    # -------------------------------------------------------------------
    if not workflow_runner_available:
        log("workflow-runner not available — skipping Tier 2")
        result["tier2"] = "skip"
        print(json.dumps(result))
        sys.exit(0)

    try:
        workflow_name = f"sdk-smoke-wf-py-{int(time.time() * 1000)}"

        # Apply workflow
        log("applying workflow...")
        applied = client.workflows.apply(
            WorkflowInput(
                name=workflow_name,
                org="test-org",
                document=WorkflowDocumentInput(
                    dsl="1.0.0",
                    namespace="test-org",
                    name=workflow_name,
                    version="1.0.0",
                ),
                tasks=[
                    WorkflowTaskInput(
                        name="setGreeting",
                        kind=wf_enum.WorkflowTaskKind.set_vars,
                        task_config={
                            "variables": {"greeting": "hello-from-py-sdk-smoke-test"}
                        },
                        export=ExportInput(as_="${.}"),
                    ),
                ],
            )
        )
        workflow_id = applied.metadata.id
        if not workflow_id:
            raise ValueError("applied workflow has no ID")
        log(f"applied workflow: id={workflow_id}")

        # Create execution
        log("creating workflow execution...")
        execution = client.workflow_executions.create(
            WorkflowExecutionInput(
                name=f"sdk-smoke-exec-py-{int(time.time() * 1000)}",
                org="test-org",
                workflow_id=workflow_id,
                trigger_message="SDK acceptance smoke test",
            )
        )
        execution_id = execution.metadata.id
        if not execution_id:
            raise ValueError("created execution has no ID")
        log(f"created execution: id={execution_id}")

        # Poll until COMPLETED (90s timeout, 2s interval)
        deadline = time.time() + 90
        last_phase = ""
        completed = False

        while time.time() < deadline:
            time.sleep(2)
            fetched_exec = client.workflow_executions.get(execution_id)
            phase = fetched_exec.status.phase
            last_phase = wfe_enum.ExecutionPhase.Name(phase)

            if phase == wfe_enum.ExecutionPhase.EXECUTION_COMPLETED:
                log(f"execution completed: id={execution_id}")

                for task in fetched_exec.status.tasks:
                    if task.task_name == "setGreeting":
                        assert_equal(
                            "task status",
                            task.status,
                            wfe_enum.WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
                        )
                completed = True
                break

            if phase in (
                wfe_enum.ExecutionPhase.EXECUTION_FAILED,
                wfe_enum.ExecutionPhase.EXECUTION_CANCELLED,
            ):
                raise ValueError(
                    f"execution reached terminal failure phase: {last_phase}"
                )

        if not completed:
            raise TimeoutError(
                f"timed out waiting for execution to complete; last phase: {last_phase}"
            )

        # Cleanup
        client.workflows.delete(workflow_id)

        log("Tier 2 passed")
        result["tier2"] = "pass"

    except Exception as err:
        log(f"Tier 2 FAILED: {err}")
        result["tier2"] = "fail"
        result["errors"].append(f"tier2: {err}")  # type: ignore[union-attr]
        print(json.dumps(result))
        sys.exit(1)

    print(json.dumps(result))
    sys.exit(0)


def assert_equal(label: str, actual: object, expected: object) -> None:
    if actual != expected:
        raise ValueError(f"{label} mismatch: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    main()
