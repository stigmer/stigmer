---
name: review-change-security
description:
  The security questions every change to Stigmer answers, each with the code or
  issue that makes it checkable. Use when writing or reviewing a change that
  touches authorization, which organization a read or write belongs to,
  credentials, untrusted input, redirects, CORS or cookies, a dependency, an
  action or a workflow.
---

# The security questions every change answers

A change is written against these questions and reviewed against them. The
author asks them while writing. The reviewer
(`.agents/skills/review-pull-request/SKILL.md`) answers each one the change
touches and states the answer in the verdict's `Security:` line. Each question
names what makes it checkable. A question the code cannot answer is a finding.

## The questions

1. **Authorization is decided on the server.** Who may call this is decided at
   the server's edge, never trusted from the client, a header or a field the
   caller fills. A new RPC declares its posture through the commons annotations
   (`apis/AGENTS.md`), and
   `backend/services/stigmer-server/docs/authorization-coverage.md` changes with
   it. A change to the authorization model follows
   `.agents/skills/model-fga-authorization/SKILL.md`.
2. **A resource belongs to the organization of what holds it.** Its organization
   comes from its parent resource or the caller's identity, never from the
   request, and every read and write is scoped by it. A request that names
   another organization is refused, not obeyed (#1595: a turn takes its
   session's organization, and a turn naming another one is refused).
3. **No secret is written where it can be read.** No credential, token or key
   appears in a log line, an error message, an event, a fixture or a test. A
   fixture uses a value no provider issues, so push protection and the scanners
   never meet a real-looking one.
4. **A credential goes only to the host it belongs to.** The decision is made on
   a parsed URL's host, compared exactly, never by a substring or prefix test of
   the URL text (#1577).
5. **Untrusted input is handled at the boundary.** URLs, file paths, shell
   arguments, templates and markdown from a caller, a model or a repository are
   parsed, validated or escaped where they enter. A process argument is passed
   as an argument, never through a shell string. A server-side fetch goes
   through the egress guard (`backend/libs/ts/outbound/README.md`), which checks
   every address and every redirect hop.
6. **The web surface says who can now reach what.** A change to a redirect, a
   CORS header or a cookie names, in its pull request, who gains access. A
   redirect target taken from input stays on its own origin (#1586). Credentials
   are never allowed for any origin; the server still allows them, and #1582
   tracks that until it closes, so a change neither copies nor widens it.
7. **A new dependency or action is pinned and justified.** The pull request says
   why it is needed. An action is pinned by its full commit SHA, and a workflow
   change keeps `make lint-workflows` at zero findings.
8. **No pattern can be turned against the process.** A regular expression run on
   untrusted text cannot backtrack: no unanchored repetition before `$`, no
   nested or overlapping quantifiers (#1586). An object write keyed by input
   refuses `__proto__`, `constructor` and `prototype`; #1583 tracks the one
   utility that does not yet.

## How a reviewer reports

A concrete risk is a finding. It is `blocking` when it is exploitable or widens
who can reach what, and `minor` otherwise. The verdict's `security` answer is
never empty:

- `none found`, followed in parentheses by the questions the change was read
  against, so a reader can tell a clean reading from one that never looked;
- `none found (no question applies)`, exactly, when the change touches none of
  them, a change to prose alone for one;
- otherwise, the concern in one sentence. The finding carries the detail.
