---
name: review-enterprise-change
description:
  The exposure review every change to Stigmer Enterprise (ee/) meets before its
  first push, covering who it defends against, the four sheets a change is read
  with, the finding classes and verdicts, and where each finding goes, an
  exploitable one through a draft private security advisory. Use when writing or
  reviewing anything under ee/.
paths:
  - ee/**
---

# Reviewing a Stigmer Enterprise change for exposure

Stigmer Enterprise (`ee/`, published as `@stigmer/enterprise`) is public source,
under the Stigmer Enterprise License, and hosts run it in production: the hosted
service at stigmer.ai installs the same package a self-hosting customer
installs. A branch is readable the moment it is pushed, so a flaw a change
introduces, or a flaw a change's text describes, is disclosed against every
running host before its fix is released. So every change under `ee/` is read and
judged before its first push, with the sheets below, and a reviewer of its pull
request reads it again with them. Most changes are "none" in minutes. What
matters is that the question is asked.

This review sits beside the questions every change answers
(`.agents/skills/review-change-security/SKILL.md`); it adds the adversaries and
the sheets that Enterprise's surface needs.

## When

- **A change under `ee/`:** its diff with the four sheets, and a new file whole,
  before the branch is first pushed.
- **A piece moves into the package**, or the package's barrel
  (`ee/server/src/index.ts`) exports something new: read the piece whole.
  Widening the barrel is a decision about what every host may call.
- **A release of the package or its image:** the tarball's file list
  (`node scripts/publish-standalone.mjs --package ee/server --version <version> --dry-run`)
  and the image's layers, judged as a piece by the same sheets.

## Who it defends against

- **Anyone on the internet**, with no account: the public lanes (SSO discovery,
  the invitation preview) and the sign-in verifier every token passes through.
- **A signed-in person in one organization** acting against another organization
  on the same server. Hostile organizations on one server are in scope.
- **A person acting beyond their role** inside their own organization: a viewer
  acting as an admin, an admin acting as an owner, anyone reaching the
  platform's own authority.
- **An organization admin who controls an identity provider's configuration**:
  the URLs the server dials, the keys it trusts, the claims it reads, and the
  roles it grants.
- **A reader of the source**: what the code, its tests and its documents teach
  about how a running host is weakened.
- **Anyone holding a license ticket**: a forged, altered, expired or foreign
  ticket, and a server started with none.

Trusted: the operator who installs Enterprise (their own cluster, their own
secrets), and the platform's own signing keys.

## The pieces

Judge each piece separately, so one piece's verdict cannot hide another's. A
piece is one domain folder of `ee/server/src/iam/` (provider, federation,
invitation, team), the edition-neutral plumbing the barrel exports as host
building blocks (rpc, postgres, verifiers, the grant path and the repairs: the
barrel's "Host building blocks" group), the identity unit's wiring
(`ee/server/src/extension/`), the license verifier and its growth freeze
(`ee/server/src/license/`), the self-hosted server (`ee/server/src/editions/`),
the tests, the documents (`ee/server/docs/`), or a release artefact. Read at a
stated SHA, and re-state the SHA when the code moves under the read.

## The four sheets

Fill them while reading, line by line. They are the evidence a verdict cites.

1. **Authorization.** One row per RPC, in the shape of the server's coverage
   document (`backend/services/stigmer-server/docs/authorization-coverage.md`)
   and the package's own (`ee/server/docs/enterprise-authorization-coverage.md`,
   held to the bound methods by the unit's suite):
   - **Annotation:** the `rpc.config` summary, `is_public`,
     `is_skip_authorization`, or none.
   - **Handler:** the chain with the Authorize step, or direct with its posture.
   - **Guard:** every skip row names its guard with the document's three markers
     (`guard:`, `driver:`, `by design:`).
   - **Model:** the relation that answers the check.
   - **Held by:** who holds that relation.

   Two kinds of row are findings in themselves: a relation no suite asserts, and
   a relation whose tuples no code writes. The row where Annotation, Handler and
   Model disagree is the one to look for.

2. **Outside values.** Every value that arrives from outside the server: a token
   and its claims, an admin-written URL, a claim name, an invitation token, a
   slug, an external id, a license ticket. For each place it flows, record:
   - what bounds it (length, size, time, destination);
   - what trusts it;
   - what it is echoed into;
   - where it rests, and in what form.

   Name which caller classes each skip lane admits, because the verifier chain
   mints more classes than `user`. Every URL an admin writes is dialed through
   the one guarded fetch the host hands the unit; a new dial that takes another
   fetch is a finding.

3. **Error text.** Every refusal and fault message the piece can return, marked
   safe or leaks-internal, against the request rule in
   `.agents/skills/ts-server-dev-guidelines/SKILL.md`: a static, sanitized
   message on the wire, with the real error logged. Refusal copy is a wire
   contract hosts and clients match on; a change to it is a contract change.
4. **Leak scan.** `node --test scripts/planning-references.test.mjs` holds the
   repository's planning-record patterns over every tracked file, `ee/`
   included. Then read every module header and test name by eye, because a
   pattern only finds what someone already thought of: nothing a public reader
   cannot open is cited (no private repository, no internal tracker, no
   dashboard), and nothing names a deployment's secrets, hosts or vendors beyond
   what the code itself configures. Outside the tree (a tarball, an image), run
   the same patterns by hand.

**Host invariants.** A verdict names each invariant it rests on that a host
holds, not the package, with the guard that pins it and whether a break fails
open or closed. What the unit itself states is in its header,
`ee/server/src/extension/enterprise-identity.ts`, and its shape is pinned by
`ee/server/src/extension/__tests__/enterprise-identity.wiring.test.ts`. The
self-hosted server's own wiring (one guarded fetch, one pool) is pinned by
`ee/server/src/editions/__tests__/enterprise.wiring.test.ts`, its host duties by
`ee/server/src/editions/__tests__/enterprise-host-wiring.postgres.test.ts`. Any
other host holds its duties in its own header and wiring guard.

## The judgement

Each finding gets one class:

- **material:** exploitable by any adversary above, or it teaches a reader of
  the source how to attack a running host;
- **hygiene:** it reveals structure, not a weakness;
- **defect:** wrong behaviour that exposes nothing.

Each change gets one verdict:

- **none;**
- **fixed first:** every material finding is closed by a released fix, named;
- **held:** a material finding the change cannot fix before its push. The change
  is not pushed; the finding goes to an advisory (below).

The bar:

- A material finding blocks its change until fixed.
- Hygiene is fixed in the change, or by its own issue before the next release.
- A defect gets an issue and blocks nothing; the review still closes it.

A material finding also stops the read. It goes to a maintainer with its drafted
advisory before anything else happens, because its route can change the design.

**Who judges, and what proves it.** The reviewer judges; a maintainer rules only
a material finding and a product or design choice. Every claim a verdict rests
on names the test that pins it, in the package's own suites wherever it can.
Each such test is first shown failing against a deliberately broken copy of the
line it guards, a copy never committed. A claim no test pins is a gap, closed by
adding the test. A test never pins a finding's current behaviour, because a test
that asserts a flaw guards it.

## Where findings go

- **Exploitable in a released version:** a draft private security advisory on
  this repository (Security, Advisories), describing the flaw and its reach. The
  fix is written in the advisory's temporary private fork, never on a public
  branch, and released from it; hosts re-pin; then the advisory is published
  with the release that fixes it. Nothing public describes the flaw before that
  release.
- **The fix needs the contract to change:** the advisory first, then the
  contract change, whose text states the design ("an invitation's token is
  visible only to those who may grant access"), never the exploit.
- **The fix's home is `@stigmer/server`:** the same advisory; the server's
  change is framed as the hardening it is, and both packages release together,
  as they always do.
- **Hygiene or a defect:** a public issue in this repository, written so it
  teaches nothing an attacker could use against an unpatched host.

**A finding is closed by the review that found it.** Filing it is not closing
it. Every finding, whatever its class, gets a fix of its own, tracked by the
review until it merges, and the review is not complete while one is open. The
review writes no fix inside the read: each ships through its own change, and a
later read confirms each finding's row now reads fixed, naming the pull request
or the advisory.
