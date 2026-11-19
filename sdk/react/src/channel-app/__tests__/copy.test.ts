// A channel app's line under its title says what the app is for, by its
// kind and the organization's name: a Slack app for the organization's
// Slack channels, a Meta app for its WhatsApp channels. A kind this build
// does not know gets no line rather than a wrong one.

import { describe, expect, it } from "vitest";
import { channelAppLead } from "../copy";

describe("channelAppLead", () => {
  it("names a Slack app's and a Meta app's channels with the organization's name", () => {
    expect(channelAppLead("slack", "acme")).toBe("A Slack app for acme's Slack channels.");
    expect(channelAppLead("whatsapp", "acme")).toBe("A Meta app for acme's WhatsApp channels.");
  });

  it("says nothing for a kind it does not know, or none", () => {
    expect(channelAppLead("teams", "acme")).toBeNull();
    expect(channelAppLead(undefined, "acme")).toBeNull();
  });
});
