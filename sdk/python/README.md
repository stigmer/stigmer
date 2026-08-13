# stigmer

Python SDK for the Stigmer platform. Provides typed API clients for all Stigmer resources with authentication, error handling, and cross-resource search.

## Installation

```bash
pip install stigmer
```

`stigmer-protos` (generated protobuf stubs) is installed automatically as a dependency.

## Quick Start

```python
from stigmer import StigmerClient, AgentInput

with StigmerClient("sk_live_abc123") as client:
    agent = client.agents.create(AgentInput(name="my-agent", org="my-org"))
    print(agent.metadata.name)
```

Or without a context manager:

```python
client = StigmerClient("sk_live_abc123")
agent = client.agents.get("agent-id")
client.close()
```

## Resource Clients

Every resource type has a typed client accessible as a property on `StigmerClient`:

| Property               | Resource           |
|------------------------|--------------------|
| `agents`               | Agent              |
| `agent_executions`     | AgentExecution     |
| `agent_instances`      | AgentInstance      |
| `api_keys`             | ApiKey             |
| `environments`         | Environment        |
| `execution_contexts`   | ExecutionContext    |
| `iam_policies`         | IamPolicy          |
| `identity_accounts`    | IdentityAccount    |
| `identity_providers`   | IdentityProvider   |
| `mcp_servers`          | McpServer          |
| `organizations`        | Organization       |
| `projects`             | Project            |
| `sessions`             | Session            |
| `skills`               | Skill              |
| `workflows`            | Workflow           |
| `workflow_executions`   | WorkflowExecution  |
| `workflow_instances`    | WorkflowInstance   |
| `search`               | Cross-resource search |

## Common Operations

```python
from stigmer import StigmerClient, AgentInput, ListParams, ResourceRef, Page

with StigmerClient("sk_live_abc123") as client:
    # Create
    agent = client.agents.create(AgentInput(
        name="my-agent",
        org="my-org",
        description="Handles customer inquiries",
        instructions="Be helpful and concise.",
    ))

    # Get by ID
    agent = client.agents.get("agent-id")

    # Get by reference (org + slug)
    agent = client.agents.get_by_reference(ResourceRef(org="my-org", slug="my-agent"))

    # Update
    updated = client.agents.update(AgentInput(
        name="my-agent",
        org="my-org",
        description="Updated description",
    ))

    # Delete
    deleted = client.agents.delete("agent-id")

    # List (search-backed)
    results = client.agents.list(ListParams(
        org="my-org",
        query="customer",
        page=Page(num=1, size=20),
    ))
```

## Cross-Resource Search

```python
from stigmer import StigmerClient, ApiResourceKind, SearchParams

with StigmerClient("sk_live_abc123") as client:
    results = client.search.query(SearchParams(
        kinds=[ApiResourceKind.agent, ApiResourceKind.skill],
        org="my-org",
        query="customer support",
    ))
```

## Billing

Credit balance queries, ledger history, and manual credit adjustments for an
organization. Commands require the `can_manage_billing` permission on the org:

```python
from stigmer import StigmerClient, AdjustCreditsParams

with StigmerClient("sk_live_abc123") as client:
    balance = client.billing.get_credit_balance(org_id)

    entry = client.billing.adjust_credits(AdjustCreditsParams(
        org_id=org_id,
        amount_micros=25_000_000,  # +$25.00
        reason="initial tenant funding",
        idempotency_key=f"fund-{org_id}",
    ))
```

## Error Handling

All SDK operations raise `StigmerError` with structured error codes:

```python
from stigmer import StigmerClient, StigmerError, is_not_found, is_retryable

with StigmerClient("sk_live_abc123") as client:
    try:
        agent = client.agents.get("nonexistent")
    except StigmerError as err:
        if is_not_found(err):
            print("Agent not found")
        elif is_retryable(err):
            print("Transient error, retry later")
        else:
            print(f"Error [{err.code.value}]: {err}")
```

Error codes: `not-found`, `permission-denied`, `unauthenticated`, `invalid-argument`, `already-exists`, `resource-exhausted`, `failed-precondition`, `internal`, `unavailable`, `cancelled`, `unknown`.

## Configuration

```python
StigmerClient(
    api_key: str,               # Stigmer API key (required)
    *,
    base_url: str = "api.stigmer.ai:443",  # gRPC target address
    insecure: bool = False,     # Skip TLS (local development only)
)
```

## Code Generation

The resource clients in `src/stigmer/_gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/python
make codegen
```

Handwritten code lives in `src/stigmer/` (outside `_gen/`): `_client.py`, `_transport.py`, `_interceptors.py`, `_search.py`, and `__init__.py`.
