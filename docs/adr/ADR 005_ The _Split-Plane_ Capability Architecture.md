Here is the consolidated Architectural Decision Record (ADR) capturing the complete architectural pivot we have defined.

# **ADR 005: The "Split-Plane" Capability Architecture**

* **Status:** Accepted  
* **Date:** 2026-02-02  
* **Author:** Stigmer Architecture Team  
* **Context:** Workflow Execution Engine & Platform Extensibility

## **1\. Context and Problem Statement**

Stigmer is evolving from a closed "Serverless Workflow Runner" into an open "Agentic Orchestration Platform." The current architecture—where the core Go Runner executes all logic directly—is hitting three critical scalability walls:

1. **The "God-Enum" Anti-Pattern:** Adding every new capability (e.g., Email, Slack, Salesforce) as a hardcoded handler in the Core Engine violates the Open-Closed Principle.  
2. **Security & Isolation:** We cannot run user-defined custom logic (e.g., "Legacy Bank Connector") inside the Stigmer control plane.  
3. **Agent UX Friction:** While we want extensibility, we cannot force users to run workers for *standard* platform features like AI Agents or Email.

**The Business Mandate:** We must support a "Batteries Included" experience for standard features (Platform-Hosted) while allowing "Infinite Extensibility" for custom logic (User-Hosted), unified under a single Domain Model.

## **2\. The Decision: Split-Plane Execution**

We are adopting a **Split-Plane Architecture** that decouples **Orchestration** (The Brain) from **Fulfillment** (The Hands).  
We formally recognize three distinct Execution Modes in our Domain Model:

| Mode | Owner | Where Code Runs | Queue Strategy | Example |
| :---- | :---- | :---- | :---- | :---- |
| **1\. Primitive** | Stigmer | **Core Runner (Zigflow)** | None (Local Go Logic) | Switch, Wait, Fork |
| **2\. System (Managed)** | Stigmer | **Stigmer Fleet** | STIGMER\_SYSTEM\_QUEUE | Email, Agent Call, S3 |
| **3\. Custom (BYO)** | User | **User Worker (SDK)** | tenant-{id}-custom-{map} | LegacyInvoiceGen, PrivateDB |

## **3\. Detailed Design**

### **3.1 The Universal Registry (The Contract)**

We reject ad-hoc string typing. All Capabilities must be defined in a strictly typed Registry (Database backed by Protobuf).

* **Entity:** CapabilityDefinition  
* **Key Fields:**  
  * id: Unique Identifier (e.g., stigmer.std.agent.invoke vs tenant.888.custom.invoice).  
  * execution\_mode: Enum (SYSTEM\_MANAGED vs USER\_HOSTED).  
  * input\_schema: JSON Schema for UI generation and validation.  
* **Impact:** The UI queries this registry to build the "App Store" of available steps.

### **3.2 The Routing Logic (Zigflow Refactor)**

We are leveraging the existing **Builder Pattern** in Zigflow (pkg/zigflow). We will introduce generic builders that route based on the Registry, rather than hardcoded logic.  
**Refactor:**

* **AgentTaskBuilder:** Resolves to STIGMER\_AGENT\_SERVICE\_QUEUE. It packages the AgentID and sends it to our internal Agent Service (which handles LLM loops, Context, and MCP).  
* **CustomTaskBuilder:** Resolves to tenant-{id}-custom-{mapping}. It acts as a blind router, dispatching payloads to the user's infrastructure.

### **3.3 The SDK Strategy (Two-Tier)**

We separate the "Definition" from the "Runtime" to maintain clean boundaries.

1. **Definition SDK (Workflow-as-Code):**  
   * *Purpose:* Architecture & Design.  
   * *Behavior:* Generates static JSON/YAML. No runtime connection.  
   * *Ubiquitous Language:* workflow.addStep("send-email", ...)  
2. **Runtime SDK (The Worker):**  
   * *Purpose:* Fulfillment of Custom Tasks.  
   * *Behavior:* Connects to Stigmer Temporal via mTLS/Auth.  
   * *Ubiquitous Language:* worker.register("GenerateInvoice", handlerFn)

## **4\. Specific Handling of "Agent Calling"**

We corrected a prior assumption: **Agents are System Entities.**

* **Configuration:** Users define Agents (Prompts, Tools) in the Stigmer UI.  
* **Execution:** Stigmer runs the Agent Loop.  
* **User Action:** The user does *not* need to run a worker to use an Agent.  
* **Exception:** If an Agent needs a *Private Tool* (e.g., "Query Local DB"), only *that specific tool* runs on the User's Worker (via MCP bridging).

## **5\. Consequences**

### **Positive**

* **Core Purity:** The workflow-runner (Zigflow) remains lightweight. It never imports aws-sdk or langchain. It just orchestrates.  
* **Security:** Arbitrary user code never executes on Stigmer servers.  
* **UX Alignment:** Users get a "Serverless" experience for standard tasks, but have the power of "Kubernetes Operators" for custom tasks.

### **Negative**

* **Operational Complexity:** Stigmer must now manage a "System Fleet" of workers (Email workers, Agent workers) in addition to the Core Runner.  
* **Latency:** Custom Tasks introduce a network hop (Stigmer \-\> Temporal \-\> User Laptop).

## **6\. Compliance Check (DDD)**

* **Ubiquitous Language:** We have renamed generic "Tasks" to **Capabilities** (SystemCapability, CustomCapability) to reflect business value.  
* **Anemic Models Rejected:** The CapabilityDefinition is not just a DTO; it drives the routing logic and validation rules.  
* **Separation of Concerns:** "Flow Control" (Zigflow) is strictly separated from "Business Logic" (System/User Workers).

### **Final Architect's Note**

This architecture successfully navigates the trade-off between **Ease of Use** (SaaS) and **Power** (PaaS). By treating your own Standard Library (Email, Agents) as just "Trusted Plugins," you dogfood your own extensibility model, ensuring it is robust enough for users.