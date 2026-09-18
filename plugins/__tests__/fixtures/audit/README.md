# Audit fixtures

The documents the probe suite serves from its fake `fetch`: OAuth protected
resource metadata (RFC 9728) and authorization server metadata (RFC 8414),
in the shapes the ladder in `scripts/audit/probe.ts` reads. Hand-written to
the RFCs first; a shape a live run met that the hand-written ones did not
cover is added here as recorded, so the suite grows with what the vendors
actually send. JSON only: every YAML document under `plugins/` is scanned as
an authoring surface by `check-docs-yaml`.

- `protected-resource.json`: names one authorization server on another
  origin than the MCP URL.
- `authorization-server-dcr.json`: a login server that registers clients
  dynamically and supports S256.
- `authorization-server-pre-registered.json`: the same without a
  `registration_endpoint`.
