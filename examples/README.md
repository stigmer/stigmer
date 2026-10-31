# Examples

Each example is a job an agent does inside a developer's product: whose product
it is, what their customer hands over, and what the agent hands back.

## Variance report (`variance-report/`)

An accounting product's customer uploads a quarter's ledger. The agent works out
each account's variance against its budget, flags the accounts that ran more
than 10% over or under, and hands back `variance-report.md`, a file the customer
can open.

- [`variance-reporter.yaml`](variance-report/variance-reporter.yaml) is the
  Agent: what the job is and how to do it. It has no shell, because the job
  needs none.
- [`ledger.csv`](variance-report/ledger.csv) is the customer's ledger.

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

These files are the quickstart's own, byte for byte, and a test keeps them so.
