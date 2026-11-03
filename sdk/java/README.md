# Stigmer Java SDK (`ai.stigmer:stigmer-sdk`)

Java client for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. Provides typed API clients for every Stigmer resource with authentication, error handling, and cross-resource search.

## Installation

### Maven

```xml
<dependency>
    <groupId>ai.stigmer</groupId>
    <artifactId>stigmer-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle (Groovy)

```groovy
implementation "ai.stigmer:stigmer-sdk:0.1.0"
```

### Gradle (Kotlin DSL)

```kotlin
implementation("ai.stigmer:stigmer-sdk:0.1.0")
```

`stigmer-apis` (generated protobuf types) is pulled in automatically as a transitive dependency.

## Quick Start

Before you start, run Stigmer on your machine with `stigmer up` and give it a model key ([Start Stigmer and add your model key](https://stigmer.ai/docs/getting-started/quickstart#start-stigmer-and-add-your-model-key)). Without a key the server refuses the message, and the program prints why.

This program connects to that Stigmer, sets up a small agent, asks it one thing and prints its answer:

```java
// The Stigmer quick start: connect to the Stigmer running on this machine,
// set up a small agent, ask it one thing and print its answer.
//
// Start Stigmer first with `stigmer up` (given a model key), then run this
// file with the SDK on the classpath: java -cp <classpath> Quickstart.java

import ai.stigmer.agentic.agent.v1.Agent;
import ai.stigmer.sdk.SendAndWaitInput;
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.TurnOutcome;
import ai.stigmer.sdk.gen.AgentInput;
import ai.stigmer.sdk.gen.ResourceRef;
import ai.stigmer.sdk.gen.RunInput;
import ai.stigmer.sdk.gen.StigmerException;

public class Quickstart {
    public static void main(String[] args) {
        // `stigmer up` serves on localhost:7234 and needs no key on your machine.
        try (StigmerClient client = StigmerClient.builder().baseUrl("localhost:7234").insecure().build()) {
            // apply creates the agent, or updates it when you run this again.
            Agent agent = client.agent.apply(AgentInput.builder()
                    .name("greeter")
                    .org("stigmer")
                    .instructions("You greet people in one short, friendly sentence.")
                    .build());

            TurnOutcome turn = client.sendAndWait(SendAndWaitInput.builder()
                    .org("stigmer")
                    .sessionSpec(RunInput.SessionSpecInput.builder()
                            .agentRef(ResourceRef.of("stigmer", agent.getMetadata().getSlug()))
                            .build())
                    .message("Say hello to a developer trying Stigmer for the first time.")
                    .build());
            if (!turn.phase().equals("completed")) {
                System.err.println("the turn did not complete (" + turn.phase() + "): " + turn.error());
                System.exit(1);
            }
            System.out.println(turn.answer());
        } catch (StigmerException e) {
            System.err.println("stigmer: " + e.getMessage());
            System.exit(1);
        }
    }
}
```

It is `examples/Quickstart.java`. Run it with the SDK on the classpath (`java -cp <classpath> Quickstart.java`); it prints the agent's answer, for example "Hello, and welcome to Stigmer!".

`sendAndWait` sends the message and waits for the agent's answer, reconnecting if the stream drops. A turn that waits for a person's approval returns with phase `TurnOutcome.WAITING` and its `asks`; answer them with `client.session.confirmToolUse` and call `client.waitForTurn` with the outcome's `lastSeq`. For a run field `SendAndWaitInput` does not carry, create the run with `client.run.create` and call `client.waitForTurn`.

### On Stigmer Cloud

Make two changes: connect with an API key, `StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()` (keys read `stk_…`), and use your own organization, `System.getenv("STIGMER_ORG")`, where the program says `"stigmer"`.

For a CI job or a script, use a [service account's](https://stigmer.ai/docs/guides/authentication/service-accounts) API key, not a person's: it keeps working when that person leaves and works only in its own organization.

## Resource Clients

Every resource type has a typed client exposed as a public final field on
`StigmerClient` (declared by the generated `GeneratedClient` it extends), so
`client.agent.get(id)` reads an agent. Search, billing and tokens are methods:

| Accessor                 | Resource           |
|--------------------------|--------------------|
| `agent`                  | Agent              |
| `run`                    | Run                |
| `apiKey`                 | ApiKey             |
| `grant`                  | Grant              |
| `identityAccount`        | IdentityAccount    |
| `federationIssuer`       | FederationIssuer   |
| `organization`           | Organization       |
| `plugin`                 | Plugin             |
| `session`                | Session            |
| `skill`                  | Skill              |
| `vault`                  | Vault              |
| `search()`               | Cross-resource search |
| `billing()`              | Billing account, Stripe, model catalog |
| `tokens()`               | User token minting |

A vault's entries are written through its entry calls, not through `create`
or `update`: `client.vault.setSecrets`, `setConnection`, `removeSecrets` and
`removeConnections`. `create` starts the vault empty, and `update` changes its
name, description and external id while keeping the entries as stored.

## Common Operations

```java
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.gen.*;
import ai.stigmer.agentic.agent.v1.Agent;
import ai.stigmer.agentic.agent.v1.AgentList;
import ai.stigmer.agentic.agent.v1.ListAgentsRequest;
import ai.stigmer.commons.apiresource.RenameInput;

try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
    // Create
    Agent agent = client.agent.create(AgentInput.builder()
        .name("my-agent")
        .org("my-org")
        .description("Turns a customer's ledger into a variance report")
        .instructions("Be helpful and concise.")
        .build());

    // Get by ID
    Agent fetched = client.agent.get(agent.getMetadata().getId());

    // Get by reference (org + slug)
    Agent byRef = client.agent.getByReference(
        ResourceRef.builder().org("my-org").slug("my-agent").build());

    // Update: read, change, then name the fields you changed. Every other
    // field keeps its stored value. The read's etag makes the save fail with
    // "aborted" if someone changed the agent since.
    Agent current = client.agent.get(agent.getMetadata().getId());
    Agent updated = client.agent.update(
        current.toBuilder()
            .setSpec(current.getSpec().toBuilder().setDescription("Updated description"))
            .build(),
        java.util.List.of("spec.description"));

    // Rename: change the slug people type. The id stays, so everything that
    // points at the agent keeps working; the old slug reads for 30 days.
    Agent renamed = client.agent.rename(RenameInput.newBuilder()
        .setResourceId(agent.getMetadata().getId())
        .setSlug("variance-reporter")
        .build());

    // Delete
    client.agent.delete(agent.getMetadata().getId());

    // List: one page of the org's agents, newest first. A page carries a
    // next page token while more follow; page size 0 asks for the default 50.
    AgentList page = client.agent.list(ListAgentsRequest.newBuilder()
        .setOrg("my-org")
        .setPageSize(20)
        .build());

    // Every agent, page after page: listAll follows the tokens.
    for (Agent a : client.agent.listAll(ListAgentsRequest.newBuilder().setOrg("my-org").build())) {
        System.out.println(a.getMetadata().getSlug());
    }

    // Only the agents carrying every label given.
    AgentList finance = client.agent.list(ListAgentsRequest.newBuilder()
        .setOrg("my-org")
        .putLabels("team", "finance")
        .build());
}
```

## Cross-Resource Search

```java
import ai.stigmer.sdk.SearchClient;
import ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind;
import java.util.List;

try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
    SearchClient.SearchResponse results = client.search().query(
        SearchClient.SearchParams.builder()
            .org("my-org")
            .kinds(List.of(ApiResourceKind.agent, ApiResourceKind.skill))
            .query("variance report")
            .build());
}
```

## Billing

An organization's billing account (its Stripe customer), the Stripe portal
and card setup sessions. Token usage is read from the run client's usage
reports (`getRunUsageReport`, `getSessionUsageReport`, `getAgentUsageReport`,
`getOrgUsageReport`), counted in tokens and never priced. Queries require
`can_view_billing` on the org and the org's own billing commands require
`can_manage_billing`. The model catalog methods
(`listModelPricingBaselines`, `upsertModelPricingBaseline`,
`retireModelPricingBaseline`) require `can_manage_model_pricing` on the
platform:

```java
import ai.stigmer.sdk.BillingClient;
import ai.stigmer.billing.v1.BillingAccount;
import ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse;

try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
    BillingAccount account = client.billing().getBillingAccount(org);

    CreatePaymentMethodSetupSessionResponse setup = client.billing().createPaymentMethodSetupSession(
        BillingClient.CreatePaymentMethodSetupSessionParams.builder()
            .org(org)
            .successUrl("https://example.com/billing?setup=success")
            .cancelUrl("https://example.com/billing")
            .build());
}
```

## User Tokens

A product that signs its own users in mints each person a short-lived token
for the browser, and passes it to the React SDK's `StigmerProvider` through
`getAccessToken`. The backend calls the token client with its ordinary API
key, which must belong to a service account that administers the
organization the token is for (or its parent organization). An empty org or
user id is refused with `INVALID_ARGUMENT` before any request:

```java
import ai.stigmer.sdk.MintUserTokenInput;
import ai.stigmer.sdk.MintUserTokenResult;

try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
    MintUserTokenResult token = client.tokens().mintUserToken(MintUserTokenInput.builder()
        .org("acme")
        .userId("user-123")
        .userEmail("jane@acme.com")
        .userName("Jane Doe")
        .build());
    // token.accessToken(), token.expiresAt()
}
```

## Error Handling

All SDK operations throw `StigmerException` (unchecked) with structured error codes:

```java
import ai.stigmer.sdk.gen.StigmerException;

try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
    try {
        client.agent.get("nonexistent");
    } catch (StigmerException e) {
        if (e.isNotFound()) {
            System.out.println("Agent not found");
        } else if (e.isRetryable()) {
            System.out.println("Transient error, retry later");
        } else {
            System.out.println("Error [" + e.getCode() + "]: " + e.getMessage());
        }
    }
}
```

Error codes: `NOT_FOUND`, `PERMISSION_DENIED`, `UNAUTHENTICATED`, `INVALID_ARGUMENT`, `ALREADY_EXISTS`, `RESOURCE_EXHAUSTED`, `FAILED_PRECONDITION`, `INTERNAL`, `UNAVAILABLE`, `UNKNOWN`.

## Configuration

```java
// Default endpoint (api.stigmer.ai:443); keys read "stk_…"
StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build();

// Custom endpoint
StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY"))
    .baseUrl("stigmer.example.com:443")
    .build();

// On your machine: `stigmer up` serves on localhost:7234 and needs no key
StigmerClient client = StigmerClient.builder()
    .baseUrl("localhost:7234")
    .insecure()
    .build();
```

`builder()` with no key sends no `authorization` header, and `build()` refuses it unless `.insecure()` was called: only a plaintext connection to a local server may go without a key. `builder(apiKey)` refuses a null or empty key.

## Code Generation

The resource clients in `src/main/java/ai/stigmer/sdk/gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/java
make codegen
```

Handwritten code lives outside `gen/`: `StigmerClient.java`, `BillingClient.java`, `SearchClient.java`, `GitHubClient.java`, and `internal/transport/`.
