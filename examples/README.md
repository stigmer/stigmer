# Examples

Each example is a job an agent does inside a developer's product: whose product
it is, what its users hand over, and what the agent hands back. Each folder holds
the Agent and its sample files.

| Job | What goes in | What comes back | Folder |
| --- | --- | --- | --- |
| Variance report, for an accounting product | A quarter's ledger | `variance-report.md`, flagged accounts first | [`variance-report/`](variance-report/) |
| Ticket replies, for a help desk | An export of open tickets | `replies.md`, a drafted reply for each | [`ticket-replies/`](ticket-replies/) |
| Contract check, for a legal or HR tool | A services agreement | `contract-review.md`, each risky clause with a safer wording | [`contract-check/`](contract-check/) |
| Invoice match, for a procurement tool | An invoice and its purchase order | `mismatches.md`, every line that doesn't match, with the amount at stake | [`invoice-match/`](invoice-match/) |

The console asks a newcomer the same question with the same four jobs, and
`catalogue.json` is the list both read: `scripts/generate.mjs` turns it, the
manifests and the samples into the `@stigmer/examples` package.

## Variance report (`variance-report/`)

An accounting product's user uploads a quarter's ledger. The agent works out
each account's variance against its budget, flags the accounts that ran more
than 10% over or under, and hands back `variance-report.md`, a file the user can
open.

- [`variance-reporter.yaml`](variance-report/variance-reporter.yaml) is the
  Agent: what the job is and how to do it. It has no shell, because the job
  needs none.
- [`ledger.csv`](variance-report/ledger.csv) is the user's ledger.

With Stigmer running (`stigmer up`, and your Anthropic key in
`ANTHROPIC_API_KEY`), from this folder:

```bash
stigmer apply -f variance-reporter.yaml
stigmer run variance-reporter --attach ledger.csv --download ./out --until turn -m "Review this quarter's ledger."
cat out/variance-report.md
```

[Your first agent job](https://stigmer.ai/docs/getting-started/quickstart) walks
through the same job step by step. To start it from your own code instead, read
[Do the same job from your app](https://stigmer.ai/docs/getting-started/call-from-your-app);
to give your users the chat, read
[Put the agent in your app](https://stigmer.ai/docs/getting-started/embed-agent).
[Agents](https://stigmer.ai/docs/concepts/agents),
[Sessions](https://stigmer.ai/docs/concepts/sessions) and
[Files](https://stigmer.ai/docs/concepts/files) explain what each step did.

The variance report's two files are the quickstart's own, byte for byte, and a
test keeps them so. Every other example runs the same way from its own folder,
with its manifest and its samples.
