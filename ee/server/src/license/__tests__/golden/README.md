# License ticket golden vector (verifier's copy)

`license-ticket.json` is a byte copy of the issuer's golden vector: one license key the issuer wrote, the raw Ed25519 public key that verifies it (base64), the `kid` its header names and the proto JSON of its claims. The private key was generated for the vector and discarded.

The verifier's suites (`../verify.test.ts` and the others beside it) read this copy, so they run wherever this folder goes. The license issuer's own tests hold the two copies byte-identical and verify a freshly issued key with this verifier, so the issuer and the verifier cannot drift apart. Never edit this copy by hand; copy the issuer's file again when its format changes on purpose.

This is a test license, never a real one. Its kid, `license-signing-golden:v1`, names a key no vault holds, and the key is not, and never will be, in the ring this build trusts: `../trusted-keys.test.ts` fails if the compiled ring ever holds the sample's kid or its public key under any kid. A server given this key refuses it as `unknown-key`.
