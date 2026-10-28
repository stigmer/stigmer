// The no-provider stack shape: a laptop whose runner reaches no model
// provider. Domain: e2e harness.
//
// STIGMER_E2E_NO_PROVIDERS=1 boots the shipped server entry (one
// organization, made by the server, nothing seeded: the console as a laptop
// runs it) with STIGMER_RUNNER_PROVIDERS declared empty, so the server
// reports every provider missing from its runners and refuses a run that
// needs one at create. The setting is read at boot, so the shape is a stack
// of its own; the `no-providers` project's specs run only in it.
export const NO_PROVIDERS_STACK =
  process.env.STIGMER_E2E_NO_PROVIDERS === "1" ||
  process.env.STIGMER_E2E_NO_PROVIDERS === "true";
