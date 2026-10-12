/**
 * Doubles that refuse every touch, for a builder that must take a
 * dependency and never use it while it is assembled: a unit's builder may
 * construct, but it may never dial a URL, authorize or call a port at build
 * time, so each double refuses with a message naming what was touched (a
 * suite that drives a registered arm on purpose asserts on the refusal it
 * maps). The logger is silent rather than refusing, because building may
 * log.
 *
 * Edition-neutral by what it imports (the library's barrel and the egress
 * types only), so the Enterprise identity unit's own suites, which publish
 * with it, and a host's own unit builders share one set.
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";
import type { Authorizer, Logger } from "@stigmer/server";
import { createLogger } from "@stigmer/server";

export const SILENT_LOGGER: Logger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

export const REFUSING_FETCH: OutboundFetch = () =>
  Promise.reject(new Error("a unit dialed a URL through the refusing fetch"));

export const REFUSING_AUTHORIZER: Authorizer = {
  authorize: () =>
    Promise.reject(new Error("a unit consulted the refusing authorizer")),
};

/**
 * A port whose every method refuses, for a builder that must take it and
 * never call it at build time. Reading a member is allowed (a builder may
 * pass a method on); calling one throws, naming the port and the member.
 */
export function refusingPort<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, member) => () => {
      throw new Error(`${name}.${String(member)} was called at build time`);
    },
  });
}
