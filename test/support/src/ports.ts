// The run's one address nothing can listen on, and the law for every port a
// harness needs.
// Domain: test support (stack spawns).
//
// The law: a listener binds port 0 and reports the port it got, and no
// harness hands a listener a port it probed and released. Between the
// release and the child's bind, any other listener in the run can take that
// port; the child then fails to boot, or the harness talks to the thief
// (stigmer#1469; the same shape failed the server's composed tests in #1353
// and #1362). In-process fakes read `address()` after `listen(0)`
// (mock-llm.ts, fake-llm-upstream.ts); a spawned server prints the ports it
// bound on its ready line (server-process.ts). The Temporal dev server is the
// one exception, because its CLI cannot be told 0; temporal.ts survives the
// loss instead.
//
// UNREACHABLE_HOST_PORT is for the opposite need: an address that must stay
// dead for the whole run. Temporal's client counts any gRPC listener as a
// live frontend (its connect probe tolerates UNIMPLEMENTED), so a sibling
// server landing on an engineless server's Temporal address would flip its
// engine to connected (stigmer#1221), and a client meant to fail would reach
// a real server. Port 1 lies below every operating system's ephemeral range
// and is privileged on Linux, so no listen(0) and no sibling this run spawns
// can ever take it; a connect there is refused at once. The server's composed
// tests use the same address.

export const UNREACHABLE_HOST_PORT = "127.0.0.1:1";
