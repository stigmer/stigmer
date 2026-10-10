/**
 * Pins the runner's copies of two plugin-library facts to the library's own
 * source, so the runner never depends on the library at run time and the
 * two can never drift:
 *   - a plugin server's name in a turn, `plugin_<plugin>_<server>`, is the
 *     segment the installer checked (`toolServerSegment`), for names that
 *     hold characters Claude Code rewrites;
 *   - the variables the installer declares as the platform's to fill are
 *     exactly the keys this runner fills: the caller identity, the session
 *     and the Stigmer server's address.
 */
import { describe, expect, it } from "vitest";

import { PLATFORM_VARIABLES } from "../../../../../libs/ts/plugin-package/src/placeholders.js";
import { toolServerSegment as libraryToolServerSegment } from "../../../../../libs/ts/plugin-package/src/tool-names.js";
import {
  CALLER_IDENTITY_KIND_ENV_KEY,
  CALLER_IDENTITY_VALUE_ENV_KEY,
  SESSION_ID_ENV_KEY,
} from "../caller-identity.js";
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
