/**
 * The open-source edition as a composition: the one unit the shipped entry
 * (main.ts) composes onto the library.
 *
 * It declares one fact, that this server holds one organization
 * (`orgLimit: 1`). From it the composition makes that organization at its
 * first start, fills it into every request that names none, reports it to
 * clients (`single_org`), refuses a second one and refuses to delete it
 * (boot/single-organization.ts, pipeline/interceptors/single-organization.ts,
 * domain/organization/limit.ts). The edition needs no declaration: a
 * composition that declares none serves open source.
 *
 * A property of the open-source composition, not of the library: the
 * library with no unit holds any number of organizations, which is what the
 * Cloud composes onto and what the test suites that prove isolation between
 * organizations run on. On the package barrel for an edition published as
 * its own package, whose entry composes exactly this unit when its license
 * is absent, so a keyless server of that edition is the shipped one.
 */
import type { ServerExtension } from "../extensions/registry.js";

export const openSourceEdition: ServerExtension = {
  name: "open-source",
  orgLimit: 1,
};
