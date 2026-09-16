# Simplification cases

Four changes from the runner's history, each of which removed a class of
human-in-the-loop bugs by deleting state rather than by adding coordination.
They are the evidence behind the runner's laws. The details describe the runner
as it was at the time (an earlier implementation with a Python runtime and a
separate control-plane language); the shape of each lesson is what carries.

## Six sources of truth became two

Tool calls had copies in a root-level flat list on the execution record, in the
messages that carried them, in a pending-approvals projection, in the runtime's
own shadow state, in the framework's checkpoints and in Temporal signal
payloads. Every bug in the approval flow was a sync drift between two of those
copies. The fix: tool calls live in messages only, and pending approvals are a
server-side projection over that single copy. No sync step remained because
there was nothing left to sync.

Law: one home per fact.

## An eight-field interrupt payload became two fields

The interrupt raised for an approval carried the run id, the tool name, the tool
arguments, the MCP server, the source, a sub-agent flag, the sub-agent name and
a message. Six of those already existed on the tool call the messages held;
duplicating them into the interrupt created a second copy that could disagree
with the first. The fix: the interrupt carries the tool-call id (identity) and
the message (the one field stored nowhere else). Everything else is read from
the record.

Law: payloads carry only what the consumer cannot already read.

## Four tiers of fuzzy matching became a lookup

Without the tool-call id in the interrupt, matching a decision back to its call
took a four-tier chain: run-id aliases, content fingerprints, a name-based
fallback and a late enrichment pass. Reading the framework showed that LangChain
already threaded the tool-call id into a tool's invocation context through an
injected argument. One annotation replaced all four tiers.

Law: direct identity, and research the framework before building on top of it.

## A signal-counting loop became one signal and a query

The Temporal workflow counted approval signals to decide when a turn could
resume. Orphaned tool calls inflated the count and the workflow waited for
approvals that would never come. The fix: the approval handler checks the
database after each decision and sends one signal when none remain; the runtime
reads the decisions from the database when it resumes. No counter, no
coordination, nothing to drift.

Law: derived state is computed on read, and "all approved?" is a query, never a
counter.

## What was deleted rather than refactored

A five-value approval lifecycle enum with its documentation, a pending-approval
merger, an interrupt capture layer, an approval state manager and a checkpoint
fallback path were not simplified; they were removed, along with the generated
code that served them. Each existed to compensate for the duplication above.
Once the duplication was gone, so was the need.

Law: delete over refactor. When a design element exists only to compensate for
complexity elsewhere, eliminate the complexity rather than making the
compensation more elegant.
