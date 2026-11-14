// The journey from a first agent to its users: the hook every surface reads
// (`useJourney`), the lines that name its next step, the agent page's
// "Make it yours" tab, the last step's page and the links a host routes them by.

export {
  useJourney,
  type UseJourneyReturn,
  type JourneyStep,
  type JourneyStepId,
  type JourneyStepState,
  type JourneyAgent,
} from "./useJourney.js";
export { isJourneyAgentSlug } from "@stigmer/examples/journey";
export { JourneyNextLine, JourneyLauncherLine, type JourneyNextLineProps, type JourneyLauncherLineProps } from "./JourneyNextLine.js";
export { MakeItYoursTab, type MakeItYoursTabProps, type MakeItYoursLinks } from "./MakeItYoursTab.js";
export {
  BringOthersIn,
  BRING_OTHERS_IN_LINK_DAYS,
  BRING_OTHERS_IN_LINK_LABEL,
  type BringOthersInProps,
} from "./BringOthersIn.js";
export type { JourneyLinks, RenderJourneyLink } from "./links.js";
