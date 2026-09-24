/**
 * The whole list-indexed surface, one explicit list (the search
 * registry's composition-root idiom, query/search/registry.ts; house rule:
 * no import side effects). The store is opened with it
 * (`StoreOpenOptions.listIndexes`), keeps a declared kind's facts on every
 * write, and refuses a read through a declaration it was not opened with,
 * so a lane that reads an index and this list cannot disagree silently.
 *
 * A kind joins when a lane needs to read one organization's or one
 * parent's rows without decoding the whole kind; the kinds here were
 * chosen on the hosted edition's row counts and sizes (2026-09-23: every
 * other org-scoped kind held under a hundred rows and a hundred kilobytes).
 * A kind also joins when a port read on every authorization check would
 * otherwise decode the whole kind: `iam_policy`, whose adapter reads a
 * person's rows by principal (measured 2026-09-24: about 4.6 microseconds
 * per row per read, 47 ms a check at ten thousand rows on sqlite).
 */
import { agentExecutionListIndex } from "../domain/agentexecution/list-index.js";
import { artifactListIndex } from "../domain/artifact/list-index.js";
import { iamPolicyListIndex } from "../domain/iampolicy/list-index.js";
import { sessionListIndex } from "../domain/session/list-index.js";
import { workflowExecutionListIndex } from "../domain/workflowexecution/list-index.js";
import type { ListIndexDeclaration } from "../store/list-index.js";

export const LIST_INDEXES: ReadonlyArray<ListIndexDeclaration> = [
  agentExecutionListIndex,
  artifactListIndex,
  iamPolicyListIndex,
  sessionListIndex,
  workflowExecutionListIndex,
];
