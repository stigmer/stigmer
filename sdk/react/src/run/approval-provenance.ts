// Authorization provenance for the React surface: the framework-agnostic
// labels from @stigmer/sdk (shared with @stigmer/ink and the Go CLI), and
// the reading of a session event's provenance word. A tool use's ask
// (`stigmer.permission.asked`) names the rule that asked as one word, the
// run's ApprovalPolicySource without its prefix (`builtin_category`,
// `hook`, ...); `approvalPolicySourceOf` turns that word back into the enum
// the labels take.
import { ApprovalPolicySource } from "@stigmer/sdk";

export {
  describeApprovalPolicySource,
  hookApproveAllLabel,
  isInformativePolicySource,
} from "@stigmer/sdk";

/** Each provenance word the event contract allows, and the enum it names. */
const POLICY_SOURCE_OF_WORD: ReadonlyMap<string, ApprovalPolicySource> = new Map([
  ["builtin_category", ApprovalPolicySource.BUILTIN_CATEGORY],
  ["annotation_destructive_tighten", ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN],
  ["hook", ApprovalPolicySource.HOOK],
  ["approval_lease", ApprovalPolicySource.APPROVAL_LEASE],
  ["auto_approve_all", ApprovalPolicySource.AUTO_APPROVE_ALL],
  ["unattended_skip", ApprovalPolicySource.UNATTENDED_SKIP],
]);

/**
 * The {@link ApprovalPolicySource} a provenance word names (an ask's
 * `policySource`); `UNSPECIFIED` for "" (no rule recorded) or a word this
 * client does not know.
 */
export function approvalPolicySourceOf(word: string): ApprovalPolicySource {
  return POLICY_SOURCE_OF_WORD.get(word) ?? ApprovalPolicySource.UNSPECIFIED;
}
