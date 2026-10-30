// @stigmer/react-sdk/test — test utilities for Stigmer SDK components.
//
// Provides domain-specific data builders for unit tests, Storybook and
// Playwright, and the scenario catalogue: the named conversation states
// every surface that draws a conversation is pinned against.

export { samples, SAMPLE_INSTANT, sampleInstant, sampleDate } from "@stigmer/react-core/test";
export {
  scenarios,
  SCENARIO_NAMES,
  SCENARIO_CLOCK,
  conversationOf,
  usageOf,
  type Scenario,
  type ScenarioName,
  type ScenarioUsage,
} from "./scenarios.js";
