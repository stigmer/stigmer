# HITL Shared Fixture Corpus

Test data for human-in-the-loop (HITL) approvals and file review, shared by
the runner and the server so each contract below computes the same answer
in both. Which calls wait for an answer, the answers and the file-review
decisions are the session's event log; these vectors pin only the
derivations both sides must agree on.

## Layout

```
canonicalization/      the tool-action canonicalization contract
fingerprint/           the approval fingerprint built on it
lease-scope/           the class of actions one "approve all" covers
policy-source/         which rule asked for a call, as the runner's enum and the log's word
file-digest/           the canonical digest of a captured file change
```

Each directory's README says what it pins and who reads it.
