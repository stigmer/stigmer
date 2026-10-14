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
| `runs`                 | Run                |
| `api_keys`             | ApiKey             |
| `iam_policies`         | IamPolicy          |
| `identity_accounts`    | IdentityAccount    |
| `federation_issuers`   | FederationIssuer   |
| `organizations`        | Organization       |
| `plugins`              | Plugin             |
| `sessions`             | Session            |
| `skills`               | Skill              |
| `vaults`               | Vault              |
| `search`               | Cross-resource search |

## Common Operations

```python
from ai.stigmer.agentic.agent.v1 import io_pb2 as agent_io_pb2
from stigmer import StigmerClient, AgentInput, ResourceRef

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

    # Update: read, change, then name the fields you changed. Every other
    # field keeps its stored value. The read's etag makes the save fail with
    # "aborted" if someone changed the agent since.
    current = client.agents.get("agent-id")
    current.spec.description = "Updated description"
    updated = client.agents.update(current, ["spec.description"])

    # Delete
    deleted = client.agents.delete("agent-id")

    # List: one page of the org's agents, newest first. A page carries
    # next_page_token while more follow; page_size 0 asks for the default 50.
    page = client.agents.list(agent_io_pb2.ListAgentsRequest(org="my-org", page_size=20))

    # Every agent, page after page: list_all follows the tokens.
    for a in client.agents.list_all(agent_io_pb2.ListAgentsRequest(org="my-org")):
        print(a.metadata.slug)
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

An organization's billing account (its Stripe customer), the Stripe portal
and card setup sessions. Token usage is read from the run client's usage
reports (`get_run_usage_report`, `get_session_usage_report`,
`get_agent_usage_report`, `get_org_usage_report`), counted in tokens and never
priced. Queries require `can_view_billing` on the org and the org's own
billing commands require `can_manage_billing`. The operator pricing methods
(`list_model_pricing_baselines`, `upsert_model_pricing_baseline`,
`retire_model_pricing_baseline`) require `can_manage_model_pricing` on the
platform:

```python
from stigmer import CreatePaymentMethodSetupSessionParams, StigmerClient

with StigmerClient("sk_live_abc123") as client:
    account = client.billing.get_billing_account(org)

    setup = client.billing.create_payment_method_setup_session(
        CreatePaymentMethodSetupSessionParams(
            org=org,
            success_url="https://example.com/billing?setup=success",
            cancel_url="https://example.com/billing",
        )
    )
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

For a CI job or a script, use a [service account's](https://stigmer.ai/docs/guides/authentication/service-accounts) API key, not a person's: it keeps working when that person leaves and works only in its own organization.

## Code Generation

The resource clients in `src/stigmer/_gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/python
make codegen
```

Handwritten code lives in `src/stigmer/` (outside `_gen/`): `_client.py`, `_transport.py`, `_interceptors.py`, `_search.py`, and `__init__.py`.
