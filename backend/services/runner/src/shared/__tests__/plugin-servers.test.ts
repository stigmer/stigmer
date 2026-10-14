/**
 * Pins the runner's copies of three plugin-library facts to the library's
 * own source, so the runner never depends on the library at run time and
 * the two can never drift:
 *   - a plugin server's name in a turn, `plugin_<plugin>_<server>`, is the
 *     segment the installer checked (`toolServerSegment`), for names that
 *     hold characters Claude Code rewrites;
 *   - the variables the installer declares as the platform's to fill are
 *     exactly the keys this runner fills: the caller identity, the session
 *     and the Stigmer server's address;
 *   - what counts as a `${NAME}` reference: the scanner the server checks a
 *     header value with when an agent is saved is the one this runner fills
 *     it with, so a value the save accepted always resolves or is refused
 *     here, never sent literally.
 */
import { describe, expect, it } from "vitest";

import { PLACEHOLDER_PATTERN, PLATFORM_VARIABLES } from "../../../../../libs/ts/plugin-package/src/placeholders.js";
import { toolServerSegment as libraryToolServerSegment } from "../../../../../libs/ts/plugin-package/src/tool-names.js";
import {
  CALLER_IDENTITY_KIND_ENV_KEY,
  CALLER_IDENTITY_VALUE_ENV_KEY,
  SESSION_ID_ENV_KEY,
} from "../caller-identity.js";
import { PLACEHOLDER_RE } from "../placeholder-resolver.js";
import { SERVER_ADDRESS_ENV_KEY } from "../platform-server-address.js";
import { toolServerSegment } from "../plugin-servers.js";

describe("a plugin server's name in a turn", () => {
  it.each([
    ["linear", "linear", "plugin_linear_linear"],
    ["my.plugin", "srv one", "plugin_my_plugin_srv_one"],
    ["code-review", "gh_api", "plugin_code-review_gh_api"],
  ])("names %s's server %s as %s, as the installer does", (plugin, server, segment) => {
    expect(toolServerSegment(plugin, server)).toBe(segment);
    expect(libraryToolServerSegment(plugin, server)).toBe(segment);
  });
});

describe("the variables the platform fills", () => {
  it("are exactly the keys this runner fills", () => {
    expect(new Set(PLATFORM_VARIABLES)).toEqual(
      new Set([CALLER_IDENTITY_KIND_ENV_KEY, CALLER_IDENTITY_VALUE_ENV_KEY, SESSION_ID_ENV_KEY, SERVER_ADDRESS_ENV_KEY]),
    );
  });
});

describe("a ${NAME} reference", () => {
  it("is read by the same scanner here and in the plugin library", () => {
    expect(PLACEHOLDER_RE.source).toBe(PLACEHOLDER_PATTERN.source);
    expect(PLACEHOLDER_RE.flags).toBe(PLACEHOLDER_PATTERN.flags);
  });
});
