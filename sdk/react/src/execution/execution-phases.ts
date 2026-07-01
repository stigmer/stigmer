// Re-export the framework-agnostic execution-phase predicates from @stigmer/sdk
// so the React surface shares one source of truth with @stigmer/ink and the pure
// SDK logic (e.g. the file-review fold). See the sdk module for the definitions.
export { isTerminalPhase } from "@stigmer/sdk";
