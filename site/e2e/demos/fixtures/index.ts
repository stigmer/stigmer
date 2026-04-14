import type { DemoFixture } from "../types";
import { marketplaceConnectTour } from "./marketplace-connect-tour";
import { byoaSetup } from "./byoa-setup";
import { oauthConnectFlow } from "./oauth-connect-flow";
import { connectToolsTour } from "./connect-tools-tour";
import { registerIdpPlayback } from "./register-idp-playback";

/**
 * All demo fixtures with visibility contracts.
 *
 * Add a new fixture here when a scenario has mid-step interactions
 * (scroll-to, set-cursor) that should be validated. Scenarios
 * without a fixture are not tested — no false positives.
 */
export const DEMO_FIXTURES: DemoFixture[] = [
  marketplaceConnectTour,
  byoaSetup,
  oauthConnectFlow,
  connectToolsTour,
  registerIdpPlayback,
];
