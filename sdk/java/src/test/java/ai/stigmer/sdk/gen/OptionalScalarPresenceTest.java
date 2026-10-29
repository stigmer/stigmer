package ai.stigmer.sdk.gen;

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
 * on the wire. An absent entitlement limit is no limit and zero is refused. A
 * field stored as a primitive with its setter always called would send a
 * limit the caller never set as zero, to be refused, so each such field is
 * stored boxed and set only when the caller set it, zero included.
 *
 * <p>Every test calls only builder and {@code toProto()} entry points, so a
 * generator that stores primitives fails this file without failing to compile.
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
        assertFalse(limits.hasIncludedChildOrgs());
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
        assertFalse(terms.hasPerExtraOrgMicros());
    }
}
