// The single-organization stack shape: the open-source edition as a laptop
// runs it. Domain: e2e harness.
//
// STIGMER_E2E_SINGLE_ORG=1 boots the shipped server entry in the
// trusted-local posture and seeds nothing: the server makes its one
// organization at its first start, and the console never shows, asks for or
// prints one. The `single-org` project's specs run only in this shape; every
// other project runs against the library entry, which holds any number of
// organizations (fixtures/server-manager.ts says why).
export const SINGLE_ORG_STACK =
  process.env.STIGMER_E2E_SINGLE_ORG === "1" ||
  process.env.STIGMER_E2E_SINGLE_ORG === "true";
