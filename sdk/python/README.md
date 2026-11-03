# stigmer

Python client for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. Provides typed API clients for every Stigmer resource with authentication, error handling, and cross-resource search.

## Installation

```bash
pip install stigmer-sdk
```

`stigmer-apis` (generated protobuf stubs) is installed automatically as a dependency.

## Quick Start

Before you start, run Stigmer on your machine with `stigmer up` and give it a model key ([Start Stigmer and add your model key](https://stigmer.ai/docs/getting-started/quickstart#start-stigmer-and-add-your-model-key)). Without a key the server refuses the message, and the program prints why.

This program connects to that Stigmer, sets up a small agent, asks it one thing and prints its answer:

```python
"""The Stigmer quick start: connect to the Stigmer running on this machine,
set up a small agent, ask it one thing and print its answer.

Start Stigmer first with `stigmer up` (given a model key), then:
python quickstart.py
"""

import sys

from stigmer import AgentInput, ResourceRef, SessionSpecInput, StigmerClient, StigmerError

try:
    # `stigmer up` serves on localhost:7234 and needs no key on your machine.
    with StigmerClient(base_url="localhost:7234", insecure=True) as client:
        # apply creates the agent, or updates it when you run this again.
        agent = client.agents.apply(
            AgentInput(
                name="greeter",
                org="stigmer",
                instructions="You greet people in one short, friendly sentence.",
            )
        )

        turn = client.send_and_wait(
            org="stigmer",
            session_spec=SessionSpecInput(agent_ref=ResourceRef(org="stigmer", slug=agent.metadata.slug)),
            message="Say hello to a developer trying Stigmer for the first time.",
        )
except StigmerError as err:
    sys.exit(f"stigmer: {err}")

if turn.phase != "completed":
    sys.exit(f"the turn did not complete ({turn.phase}): {turn.error}")
print(turn.answer)
```

It is `examples/quickstart.py`. Run `python quickstart.py`; it prints the agent's answer, for example "Hello, and welcome to Stigmer!".

`send_and_wait` sends the message and waits for the agent's answer, reconnecting if the stream drops. A turn that waits for a person's approval returns with `phase` `"waiting"` and its `asks`; answer them with `client.sessions.confirm_tool_use` and call `client.wait_for_turn` with the outcome's `last_seq`.

### On Stigmer Cloud

Make two changes: connect with an API key, `StigmerClient(os.environ["STIGMER_API_KEY"])` (keys read `stk_…`), and use your own organization, `os.environ["STIGMER_ORG"]`, where the program says `"stigmer"`.

## Resource Clients

Every resource type has a typed client accessible as a property on `StigmerClient`:

| Property               | Resource           |
|------------------------|--------------------|
| `agents`               | Agent              |
| `runs`                 | Run                |
| `api_keys`             | ApiKey             |
| `grants`               | Grant              |
| `identity_accounts`    | IdentityAccount    |
| `federation_issuers`   | FederationIssuer   |
| `organizations`        | Organization       |
| `plugins`              | Plugin             |
| `sessions`             | Session            |
| `skills`               | Skill              |
| `vaults`               | Vault              |
| `search`               | Cross-resource search |
| `tokens`               | User-token minting (service-account keys) |

## Common Operations

```python
import os

from ai.stigmer.agentic.agent.v1 import io_pb2 as agent_io_pb2
from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2
from stigmer import StigmerClient, AgentInput, ResourceRef

with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
    # Create
    agent = client.agents.create(AgentInput(
        name="my-agent",
        org="my-org",
        description="Turns a customer's ledger into a variance report",
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

    # Rename: change the slug people type. The id stays, so everything that
    # points at the agent keeps working; the old slug reads for 30 days.
    renamed = client.agents.rename(
        apiresource_io_pb2.RenameInput(resource_id="agent-id", slug="variance-reporter")
    )

    # Delete
    deleted = client.agents.delete("agent-id")

    # List: one page of the org's agents, newest first. A page carries
    # next_page_token while more follow; page_size 0 asks for the default 50.
    page = client.agents.list(agent_io_pb2.ListAgentsRequest(org="my-org", page_size=20))

    # Every agent, page after page: list_all follows the tokens.
    for a in client.agents.list_all(agent_io_pb2.ListAgentsRequest(org="my-org")):
        print(a.metadata.slug)

    # Only the agents carrying every label given.
    finance = client.agents.list(
        agent_io_pb2.ListAgentsRequest(org="my-org", labels={"team": "finance"})
    )
```

## Cross-Resource Search

```python
import os

from stigmer import StigmerClient, ApiResourceKind, SearchParams

with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
    results = client.search.query(SearchParams(
        kinds=[ApiResourceKind.agent, ApiResourceKind.skill],
        org="my-org",
        query="variance report",
    ))
```

## User Tokens

A product that embeds Stigmer mints a short-lived token for each person
signed in to it, from its own backend, with an ordinary client built on a
service account's API key. The account must be an admin of the organization
the token is for, or of its parent organization; a person's key is refused.
Pass `access_token` to the React SDK's `StigmerProvider` through
`getAccessToken`:

```python
import os

from stigmer import StigmerClient

with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
    result = client.tokens.mint_user_token(
        org="acme",
        user_id=user.id,
        user_email=user.email,
        user_name=user.name,
    )
    print(result.access_token, result.expires_at)
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
import os

from stigmer import CreatePaymentMethodSetupSessionParams, StigmerClient

with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
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
import os

from stigmer import StigmerClient, StigmerError, is_not_found, is_retryable

with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
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
    api_key: str | None = None, # Stigmer API key, "stk_…" (required unless insecure)
    *,
    base_url: str = "api.stigmer.ai:443",  # gRPC target address
    insecure: bool = False,     # Skip TLS (local development only)
)
```

On your machine, `stigmer up` serves on `localhost:7234` and needs no key; leave the key out on that plain-text connection, and the client sends no `authorization` header:

```python
client = StigmerClient(base_url="localhost:7234", insecure=True)
```

A client with no key on a TLS connection is refused at construction, as is an empty key.

For a CI job or a script, use a [service account's](https://stigmer.ai/docs/guides/authentication/service-accounts) API key, not a person's: it keeps working when that person leaves and works only in its own organization.

## Code Generation

The resource clients in `src/stigmer/_gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/python
make codegen
```

Handwritten code lives in `src/stigmer/` (outside `_gen/`): `_client.py`, `_transport.py`, `_interceptors.py`, `_search.py`, `_tokens.py`, `_turns.py`, and `__init__.py`.

## Tests

```bash
cd sdk/python
make test
```

It makes a virtual environment in `.venv`, installs the SDK and the proto stubs from this repository into it (not PyPI's `stigmer-apis`, which can lag the tree), and runs `pytest`. `make clean` removes the environment.
