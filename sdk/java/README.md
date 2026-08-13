# stigmer-java

Java SDK for the [Stigmer](https://stigmer.ai) platform. Provides typed API clients for all Stigmer resources with authentication, error handling, and cross-resource search.

## Installation

### Maven

```xml
<dependency>
    <groupId>ai.stigmer</groupId>
    <artifactId>stigmer-java</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle (Groovy)

```groovy
implementation "ai.stigmer:stigmer-java:0.1.0"
```

### Gradle (Kotlin DSL)

```kotlin
implementation("ai.stigmer:stigmer-java:0.1.0")
```

`stigmer-java-protos` (generated protobuf types) is pulled in automatically as a transitive dependency.

## Quick Start

```java
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.gen.AgentInput;
import ai.stigmer.agentic.agent.v1.Agent;

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
    Agent agent = client.agents().create(AgentInput.builder()
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
Agent agent = client.agents().get("agent-id");
client.close();
```

## Resource Clients

Every resource type has a typed client accessible as a method on `StigmerClient`:

| Method                   | Resource           |
|--------------------------|--------------------|
| `agents()`               | Agent              |
| `agentExecutions()`      | AgentExecution     |
| `agentInstances()`       | AgentInstance      |
| `apiKeys()`              | ApiKey             |
| `environments()`         | Environment        |
| `executionContexts()`    | ExecutionContext    |
| `iamPolicies()`          | IamPolicy          |
| `identityAccounts()`     | IdentityAccount    |
| `identityProviders()`    | IdentityProvider   |
| `mcpServers()`           | McpServer          |
| `organizations()`        | Organization       |
| `projects()`             | Project            |
| `sessions()`             | Session            |
| `skills()`               | Skill              |
| `workflows()`            | Workflow           |
| `workflowExecutions()`   | WorkflowExecution  |
| `workflowInstances()`    | WorkflowInstance   |
| `search()`               | Cross-resource search |
| `billing()`              | Credit balance, ledger, and Stripe billing |

## Common Operations

```java
import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.gen.*;
import ai.stigmer.agentic.agent.v1.Agent;

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
    // Create
    Agent agent = client.agents().create(AgentInput.builder()
        .name("my-agent")
        .org("my-org")
        .description("Handles customer inquiries")
        .instructions("Be helpful and concise.")
        .build());

    // Get by ID
    Agent fetched = client.agents().get(agent.getMetadata().getId());

    // Get by reference (org + slug)
    Agent byRef = client.agents().getByReference(
        ResourceRef.builder().org("my-org").slug("my-agent").build());

    // Update
    Agent updated = client.agents().update(AgentInput.builder()
        .name("my-agent")
        .org("my-org")
        .description("Updated description")
        .build());

    // Delete
    client.agents().delete(agent.getMetadata().getId());

    // List (search-backed)
    ListResult results = client.agents().list(ListParams.builder()
        .org("my-org")
        .query("customer")
        .page(Page.of(1, 20))
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
            .query("customer support")
            .build());
}
```

## Billing

Credit balance queries, ledger history, and manual credit adjustments for an
organization. Commands require the `can_manage_billing` permission on the org:

```java
import ai.stigmer.sdk.BillingClient;
import ai.stigmer.billing.v1.CreditBalance;
import ai.stigmer.billing.v1.CreditLedgerEntry;

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
    CreditBalance balance = client.billing().getCreditBalance(orgId);

    CreditLedgerEntry entry = client.billing().adjustCredits(
        BillingClient.AdjustCreditsParams.builder()
            .orgId(orgId)
            .amountMicros(25_000_000L) // +$25.00
            .reason("initial tenant funding")
            .idempotencyKey("fund-" + orgId)
            .build());
}
```

## Error Handling

All SDK operations throw `StigmerException` (unchecked) with structured error codes:

```java
import ai.stigmer.sdk.gen.StigmerException;

try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
    try {
        client.agents().get("nonexistent");
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
