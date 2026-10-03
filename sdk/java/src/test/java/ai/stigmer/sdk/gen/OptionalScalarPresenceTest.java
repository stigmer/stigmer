package ai.stigmer.sdk.gen;

import ai.stigmer.agentic.session.v1.GitRepoSource;
import ai.stigmer.billing.plan.v1.PlanTerms;
import ai.stigmer.platform.v1.EntitlementLimits;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Inputs keep a proto3 {@code optional} scalar's presence.
 *
 * <p>An {@code optional} scalar has explicit presence: unset and zero differ
 * on the wire. An absent entitlement limit is no limit and zero is refused;
 * an absent clone depth is a shallow clone and 0 is the full history. The
 * generated inputs used to store these fields as primitives and always call
 * their setters, so a limit the caller never set arrived as zero and was
 * refused. Each such field is now stored boxed and set only when the caller
 * set it, zero included.
 *
 * <p>Every test calls only builder and {@code toProto()} entry points whose
 * signatures are the same before and after the fix, so this file also runs
 * against the earlier generated code as the red-first control.
 */
class OptionalScalarPresenceTest {

    @Test
    void limits_aLimitTheCallerNeverSet_staysAbsent() {
        EntitlementLimits limits = PlanInput.EntitlementLimitsInput.builder()
            .maxOrgs(5)
            .maxActiveSessionSandboxes(3)
            .build()
            .toProto();

        assertTrue(limits.hasMaxOrgs());
        assertEquals(5, limits.getMaxOrgs());
        assertTrue(limits.hasMaxActiveSessionSandboxes());
        assertEquals(3, limits.getMaxActiveSessionSandboxes());
        assertFalse(limits.hasMaxUsers());
        assertFalse(limits.hasIncludedManagedOrganizations());
        assertFalse(limits.hasMaxActiveWorkflowSandboxes());
        assertFalse(limits.hasArchivedWorkspaceRetentionDays());
    }

    @Test
    void licenseLimits_noLimitsSet_sendsAnEmptyMessage() {
        EntitlementLimits limits = LicenseInput.EntitlementLimitsInput.builder().build().toProto();

        assertEquals(EntitlementLimits.getDefaultInstance(), limits);
    }

    @Test
    void terms_aPriceTheCallerNeverSet_staysAbsent() {
        PlanTerms terms = PlanInput.PlanTermsInput.builder()
            .annualPriceMicros(1_200_000_000L)
            .build()
            .toProto();

        assertTrue(terms.hasAnnualPriceMicros());
        assertFalse(terms.hasMonthlyMinimumMicros());
        assertFalse(terms.hasUsageShareBasisPoints());
        assertFalse(terms.hasPerExtraOrgMicros());
    }

    @Test
    void gitSource_anUnsetDepth_staysAbsentForTheShallowDefault() {
        GitRepoSource source = SessionInput.GitRepoSourceInput.builder()
            .url("https://example.com/repo.git")
            .build()
            .toProto();

        assertFalse(source.hasDepth());
    }

    @Test
    void gitSource_aDepthOfZero_isSentForTheFullHistory() {
        GitRepoSource source = SessionInput.GitRepoSourceInput.builder()
            .url("https://example.com/repo.git")
            .depth(0)
            .build()
            .toProto();

        assertTrue(source.hasDepth());
        assertEquals(0, source.getDepth());
    }
}
