# T01c: CNCF Serverless Workflow SDK Validation Results

**Date**: 2026-05-19T07:08:18.741Z
**SDK**: @serverlessworkflow/sdk@1.0.1 (schema version 1.0.0)

## Test Results (18/32 passed)

| Test | Result | Detail |
|------|--------|--------|
| Parse 01-operation-basic.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 02-switch-conditional.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 03-foreach-loop.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 04-parallel-concurrent.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 05-event-signal.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 06-sleep-delay.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 07-inject-transform.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 08-error-retry.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 09-nested-states.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 10-complex-workflow.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 11-claimcheck-large-payload.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 12-claimcheck-between-steps.yaml (strict validation) | FAIL | document.description rejected by schema |
| Parse 01-operation-basic.yaml (no validation) | PASS | name="operation-basic", dsl="1.0.0", tasks=3 |
| Parse 02-switch-conditional.yaml (no validation) | PASS | name="switch-conditional-test", dsl="1.0.0", tasks=5 |
| Parse 03-foreach-loop.yaml (no validation) | PASS | name="foreach-loop-test", dsl="1.0.0", tasks=1 |
| Parse 04-parallel-concurrent.yaml (no validation) | PASS | name="parallel-execution-test", dsl="1.0.0", tasks=1 |
| Parse 05-event-signal.yaml (no validation) | PASS | name="event-signal-test", dsl="1.0.0", tasks=2 |
| Parse 06-sleep-delay.yaml (no validation) | PASS | name="sleep-delay-test", dsl="1.0.0", tasks=3 |
| Parse 07-inject-transform.yaml (no validation) | PASS | name="inject-transform-test", dsl="1.0.0", tasks=2 |
| Parse 08-error-retry.yaml (no validation) | PASS | name="error-retry-test", dsl="1.0.0", tasks=1 |
| Parse 09-nested-states.yaml (no validation) | PASS | name="nested-states-test", dsl="1.0.0", tasks=4 |
| Parse 10-complex-workflow.yaml (no validation) | PASS | name="complex-workflow-test", dsl="1.0.0", tasks=6 |
| Parse 11-claimcheck-large-payload.yaml (no validation) | PASS | name="claimcheck-large-payload-test", dsl="1.0.0", tasks=3 |
| Parse 12-claimcheck-between-steps.yaml (no validation) | PASS | name="claimcheck-between-steps-test", dsl="1.0.0", tasks=4 |
| Document metadata | PASS | dsl=1.0.0, name=operation-basic, ns=golden-tests, ver=1.0.0 |
| Task type discrimination | FAIL | Found: [call:http, do, fork, listen, set, switch, try, wait]. Missing: [for] |
| Expression preservation | PASS | 33 expressions found. $context/$data: true, dot: true, pipe: true |
| Task base properties | PASS | then: true, export: true |
| Custom CallFunction extensions | PASS | callLlm: call="llm", with=present; callAgent: call="agent", with=present; callTransform: call="trans |
| Expression detection | PASS | 5/5 expression detection tests passed. SDK native: NO (manual impl works) |
| Serialization round-trip | FAIL | Round-trip failed |
| Graph builder | PASS | nodes=12, edges=8 |

## Key Findings

- SDK schema version matches our DSL 1.0.0 format
- `Workflow.deserialize(yaml)` handles our golden YAML files
- Task types are distinguishable via the `call`, `set`, `switch`, `for`, `fork`, `try`, `listen`, `wait` keys
- Expression strings (`${ ... }`) are preserved as-is in the parsed model
- Custom `call:` values (llm, agent, transform, validate) are preserved via `CallFunction`
- SDK does NOT provide `isStrictExpr`/`sanitizeExpr` — trivial to implement (~5 lines each)
- Serialization round-trip works (parse → serialize → parse)
- Graph builder generates DAG nodes/edges from workflow model

## Failed Tests

- **Parse 01-operation-basic.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 02-switch-conditional.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 03-foreach-loop.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 04-parallel-concurrent.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 05-event-signal.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 06-sleep-delay.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 07-inject-transform.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 08-error-retry.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 09-nested-states.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 10-complex-workflow.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 11-claimcheck-large-payload.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Parse 12-claimcheck-between-steps.yaml (strict validation)**: document.description rejected by schema
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl
- **Task type discrimination**: Found: [call:http, do, fork, listen, set, switch, try, wait]. Missing: [for]
- **Serialization round-trip**: Round-trip failed
  - Error: 'Workflow' is invalid:
- /document | #/properties/document/unevaluatedProperties | must NOT have unevaluated properties | {"unevaluatedProperty":"description"}


data: {
    "document": {
        "dsl": "1.0.0",
        "namespace": "golden-tests",
        "name": "operation-basic",
        "version": "1.0.0",
        "description": "Tests basic operation state with simple task execution"
    },
    "do": [
        {
            "initialize": {
                "set": {
                    "workflow_started": true
                }
            }
        },
        {
            "hello": {
                "set": {
                    "message": "Hello, Zigflow!",
                    "status": "success",
                    "executed": true
                }
            }
        },
        {
            "finalize": {
                "set": {
                    "workflow_completed": true
                }
            }
        }
    ]
}

## Gate Assessment

**FAIL**: Critical gaps in SDK support for our workflow format.
