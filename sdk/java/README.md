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

```java
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.gen.AgentInput;
import ai.stigmer.agentic.agent.v1.Agent;

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
    Agent agent = client.agent.create(AgentInput.builder()
        .name("my-agent")
        .org("my-org")
        .instructions("You are a helpful assistant")
        .build());
    System.out.println(agent.getMetadata().getId());
}
```

Or without try-with-resources:

```java
StigmerClient client = StigmerClient.builder("sk_live_abc123").build();
Agent agent = client.agent.get("agent-id");
client.close();
```

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

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
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

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
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

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
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

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
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
// Default endpoint (api.stigmer.ai:443)
StigmerClient client = StigmerClient.builder("sk_live_...").build();

// Custom endpoint
StigmerClient client = StigmerClient.builder("sk_live_...")
    .baseUrl("localhost:9090")
    .build();

// Local development (no TLS)
StigmerClient client = StigmerClient.builder("sk_live_...")
    .baseUrl("localhost:9090")
    .insecure()
    .build();
```

## Code Generation

The resource clients in `src/main/java/ai/stigmer/sdk/gen/` are generated from protobuf service schemas. To regenerate after proto changes:

```bash
cd sdk/java
make codegen
```

Handwritten code lives outside `gen/`: `StigmerClient.java`, `BillingClient.java`, `SearchClient.java`, `GitHubClient.java`, and `internal/transport/`.
