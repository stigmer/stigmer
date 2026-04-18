# Scenar demo reliability and PlatformClient documentation demos

**Date**: April 18, 2026

## Summary

Bumped the documentation site to `@scenar/*` **0.1.6**, which fixes interactive demo failures: MSW Connect handlers now emit protobuf-canonical JSON (including `google.protobuf.Timestamp` as RFC 3339), and `ScenarioPlayer` advances steps in sync with narration when audio is unmuted. Shipped two embedded PlatformClient demos on the authentication guide (`platform-client-setup-tour`, `platform-client-token-flow`) with `ManagementShell` nav and registry wiring.

## Problem Statement

Doc demos that use `PreviewProvider` + `connectFixture` returned raw protobuf message objects. `JSON.stringify` could not handle `bigint` fields; a follow-up `BigInt`-safe stringify avoided crashes but still produced invalid JSON for well-known types, so the Connect client failed with errors such as **cannot decode message google.protobuf.Timestamp from JSON**. Separately, narration audio and on-screen steps were out of sync because step progression ignored manifest durations.

### Pain Points

- BigInt serialization errors in API key and other demo fixtures
- Timestamp decoding errors after naive JSON stringification
- Slides advancing before TTS narration finished
- PlatformClient guide needed interactive walkthroughs aligned with session 11 implementation work

## Solution

- **Consume upstream Scenar releases**: `npm` packages at **v0.1.5** (BigInt-safe path + audio sync) and **v0.1.6** (`toJson()`-based response encoding when the handler returns a protobuf message and the method descriptor provides `output`).
- **Site**: Pin `@scenar/core`, `@scenar/preview`, `@scenar/react`, and `@scenar/cli` to `^0.1.6` and refresh `yarn.lock`.
- **Docs**: Embed two PlatformClient scenarios (`DemoPlatformClientSetupTour`, `DemoPlatformClientTokenFlow`) and align copy with lint guidance (e.g. provisioning wording in the error table).

## Implementation Details

- **Upstream** (scenar-ai/scenar, already published): `packages/preview/src/connect/serialize.ts`, `connect-fixture.ts`, `connect-handler.ts`; `packages/react` ScenarioPlayer / `useStepProgression` wiring.
- **Stigmer repo**: `site/package.json` + `site/yarn.lock`; demo components under `site/src/components/docs/demos/scenarios/platform-client-*`; `registry.ts`, `ManagementShell.tsx`, `site/src/components/docs/index.ts`; `docs/guides/authentication/platform-client/overview.mdx`.

## Benefits

- Quickstart and API-key style demos no longer throw at serialization or Timestamp parsing.
- Narration and demo steps stay aligned for readers who unmute.
- PlatformClient guide gains interactive setup and token-flow visuals consistent with real `@stigmer/react` components.

## Impact

- **Readers**: Reliable embedded demos on the docs site; clearer PlatformClient onboarding.
- **Maintainers**: Single dependency line to track Scenar fixes; no forked MSW glue in the site.

## Related Work

- Scenar tags `v0.1.5`. and `v0.1.6` on the scenar-ai/scenar repository.
- Project session notes: `_projects/2026-04/20260417.01.platform-client/checkpoints/2026-04-18-session-11.md` (demo implementation), session 12 checkpoint (this release).

---

**Status**: ✅ Production-ready (pending merge of `feat/platform-client` branch)
**Timeline**: Same-day iteration on Scenar + site integration after session 11 demo land
