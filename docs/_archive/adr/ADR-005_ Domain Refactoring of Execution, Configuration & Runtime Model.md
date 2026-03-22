Here is the final, rectified **Architecture Decision Record (ADR)** for **STIGMER**.

I have updated the product name and included the critical decision to keep Presets separate, ensuring the document represents the complete architectural state.

# ---

**ADR-005: Domain Refactoring of Execution, Configuration & Runtime Model**

**Project:** STIGMER

**Status:** Accepted

**Date:** 2026-02-02

**Author:** Principal Software Architect

**Context:**

STIGMER currently suffers from ambiguous naming conventions (Environment, Instance, Execution) that conflate infrastructure with configuration. The platform supports two distinct compute entities: **Agents** (stateful, conversational) and **Workflows** (stateless, transactional).

Currently, the "Sandboxing" capability (Daytona integration) is implicit in infrastructure code, preventing users from defining system-level dependencies (e.g., ffmpeg) required for their Agents. Additionally, the concept of an "Instance" is creating confusion between "a saved configuration" and "a running process."

## **Decisions**

### **1\. Refactor "Environment" to Config**

* **Decision:** Rename the Environment resource to **Config**.  
* **Rationale:** "Environment" is an overloaded term often implying OS/Containers. This resource is strictly a collection of key-value pairs (secrets/variables).  
* **Domain Impact:** Users now "Attach a Config," which is semantically accurate.

### **2\. Rename "Instance" to Preset (Split Strategy)**

* **Decision:** Rename AgentInstance to **AgentPreset** and WorkflowInstance to **WorkflowPreset**.  
* **Constraint:** These resources **MUST** remain separate messages/tables. We explicitly reject the "Unified Preset" pattern.  
* **Rationale:**  
  * **Semantic Divergence:** While they look structurally similar today (both hold config refs), their business invariants differ. Agents are conversational and stateful; Workflows are transactional and stateless. Merging them would create a "God Object" requiring conditional logic for future features (e.g., cron\_schedule for workflows vs. voice\_settings for agents).  
  * **Type Safety:** Separate resources prevent invalid states, such as trying to "chat" with a Workflow.

### **3\. Rename "Execution" to Run (Active Verb)**

* **Decision:** Rename AgentExecution to **AgentRun** and WorkflowExecution to **WorkflowRun**.  
* **Rationale:** "Execution" is a passive record-keeping term. "Run" is an active noun that aligns with the user action ("Run this Agent") and standard industry terminology.  
* **RunContext:** The ephemeral security container created during a run is named **RunContext**.

### **4\. Expose Sandboxing as Runtime**

* **Decision:** Introduce a Runtime message inside AgentSpec.  
* **Rationale:** The Agent (Domain Entity) must define its own physical body (OS, System Packages). This logic moves from Infrastructure code into the Domain Definition.

## ---

**The Revised Domain Model**

1. **Template Layer (Agent / Workflow):** Defines **Logic** and **Body** (Runtime).  
2. **Data Layer (Config):** Defines **Variables** (Secrets, API Keys).  
3. **Setup Layer (AgentPreset / WorkflowPreset):** Binds **Template** \+ **Data**. (What users "Save").  
4. **Action Layer (AgentRun / WorkflowRun):** The distinct unit of work triggered within a Session.

## ---

**Technical Specification (Protobuf Definitions)**

### **1\. The Shared Configuration (config.proto)**

Protocol Buffers

syntax \= "proto3";  
package ai.stigmer.agentic.config.v1;

// Config represents a reusable set of variables/secrets.  
message Config {  
  string id \= 1;  
  string name \= 2; // e.g. "AWS Production"  
  map\<string, string\> values \= 3;  
  bool is\_secret \= 4;  
}

### **2\. The Agent Template & Runtime (agent.proto)**

Protocol Buffers

syntax \= "proto3";  
package ai.stigmer.agentic.agent.v1;

import "ai/stigmer/agentic/config/v1/config.proto";

message AgentSpec {  
  // \--- Identity & Brain \---  
  string description \= 1;  
  string instructions \= 3;

  // \--- Capabilities \---  
  repeated McpServerUsage mcp\_server\_usages \= 4;  
  repeated SubAgent sub\_agents \= 6;

  // \--- Configuration Requirements \---  
  // Defines WHAT is needed (e.g. "Requires AWS\_REGION"), but not the values.  
  ai.stigmer.agentic.config.v1.ConfigSchema config\_schema \= 7;

  // \--- The Body (New DDD Concept) \---  
  // Defines the physical computer this agent needs.  
  Runtime runtime \= 8;  
}

// Runtime: The Physical Environment  
message Runtime {  
  BaseImage base\_image \= 1;

  // System dependencies (apt-get/apk).  
  // Changing this triggers a background build (snapshotting).  
  repeated string system\_packages \= 2;

  // Language dependencies (pip/npm).  
  repeated string language\_packages \= 3;

  NetworkPolicy network\_policy \= 4;  
}

### **3\. The Separated Presets (execution.proto)**

*Note: These are kept distinct to enforce strict typing and future-proofing.*

Protocol Buffers

syntax \= "proto3";  
package ai.stigmer.agentic.execution.v1;

// AgentPreset: The Setup for a Conversational Agent  
message AgentPreset {  
  string id \= 1;  
  string name \= 2;

  // Strict Reference to an Agent  
  string agent\_ref \= 3;

  // Binds variables to the Agent's requirements  
  repeated string config\_refs \= 4;  
    
  // Future fields specific to Agents will go here:  
  // e.g. initial\_message, memory\_persistence\_policy  
}

// WorkflowPreset: The Setup for a Transactional Workflow  
message WorkflowPreset {  
  string id \= 1;  
  string name \= 2;

  // Strict Reference to a Workflow  
  string workflow\_ref \= 3;

  repeated string config\_refs \= 4;

  // Future fields specific to Workflows will go here:  
  // e.g. cron\_schedule, retry\_policy, concurrency\_limit  
}

### **4\. The Action (Run)**

Protocol Buffers

syntax \= "proto3";  
package ai.stigmer.agentic.execution.v1;

message AgentRun {  
  string id \= 1;  
  string session\_id \= 2;  
  string agent\_preset\_id \= 3; // The setup used for this run  
  RunStatus status \= 4;  
  string input \= 5;  
  string output \= 6;  
}

message WorkflowRun {  
  string id \= 1;  
  string workflow\_preset\_id \= 2;  
  RunStatus status \= 3;  
  // Workflows might not have "input/output" text, but structured payloads  
  bytes payload \= 4;   
}

## **Consequences**

1. **Database Migration:** Tables agent\_instances and workflow\_instances must be renamed to agent\_presets and workflow\_presets.  
2. **Naming Consistency:** The term "Environment" is banned from the codebase when referring to secrets. It is replaced by "Config".  
3. **Build System:** A listener must be implemented to detect changes in Agent.runtime. If system\_packages change, a new Daytona snapshot must be built asynchronously.