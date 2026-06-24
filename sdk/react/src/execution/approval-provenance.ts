// Re-export the framework-agnostic provenance label from @stigmer/sdk so the
// React surface (ApprovalCard "why-gated" line, ToolCallDetail) shares one
// source of truth with @stigmer/ink and the Go CLI. See the sdk module for the
// mapping rationale.
export { describeApprovalPolicySource } from "@stigmer/sdk";
