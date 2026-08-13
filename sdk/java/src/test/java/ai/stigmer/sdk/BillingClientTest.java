package ai.stigmer.sdk;

import ai.stigmer.billing.v1.AdjustCreditsInput;
import ai.stigmer.billing.v1.CreateBillingPortalSessionInput;
import ai.stigmer.billing.v1.CreateCreditCheckoutSessionInput;
import ai.stigmer.billing.v1.DecideModelPricingOverrideInput;
import ai.stigmer.billing.v1.GetBillingUsageReportInput;
import ai.stigmer.billing.v1.GetCreditLedgerInput;
import ai.stigmer.billing.v1.LedgerEntryType;
import ai.stigmer.billing.v1.LedgerView;
import ai.stigmer.billing.v1.ModelPricingBaseline;
import ai.stigmer.billing.v1.RetireModelPricingBaselineInput;
import ai.stigmer.billing.v1.SetAutoRechargeConfigInput;
import ai.stigmer.billing.v1.UpsertModelPricingBaselineInput;
import ai.stigmer.sdk.gen.Page;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Wire-shape pins for {@link BillingClient} param-to-proto conversion.
 *
 * <p>Each params class owns its proto request construction via a
 * package-private {@code toProto()}; these tests pin that mapping (field
 * routing, optional-field presence, timestamp conversion) and the builders'
 * required-field enforcement, without needing a gRPC server.
 */
class BillingClientTest {

    // -- AdjustCreditsParams ----------------------------------------------------

    @Test
    void adjustCredits_toProto_mapsAllFields() {
        AdjustCreditsInput proto = BillingClient.AdjustCreditsParams.builder()
                .orgId("org_123")
                .amountMicros(-5_000_000L)
                .reason("correct double grant")
                .idempotencyKey("adj-2026-08-13-01")
                .build()
                .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertEquals(-5_000_000L, proto.getAmountMicros());
        assertEquals("correct double grant", proto.getReason());
        assertEquals("adj-2026-08-13-01", proto.getIdempotencyKey());
    }

    @Test
    void adjustCredits_missingRequiredFields_throw() {
        assertThrows(NullPointerException.class, () -> BillingClient.AdjustCreditsParams.builder()
                .amountMicros(1L).reason("r").idempotencyKey("k").build());
        assertThrows(NullPointerException.class, () -> BillingClient.AdjustCreditsParams.builder()
                .orgId("org_123").amountMicros(1L).idempotencyKey("k").build());
        assertThrows(NullPointerException.class, () -> BillingClient.AdjustCreditsParams.builder()
                .orgId("org_123").amountMicros(1L).reason("r").build());
    }

    // -- GetCreditLedgerParams --------------------------------------------------

    @Test
    void getCreditLedger_toProto_mapsAllFilters() {
        Instant start = Instant.parse("2026-08-01T00:00:00Z");
        Instant end = Instant.parse("2026-08-13T00:00:00.000000500Z");

        GetCreditLedgerInput proto = BillingClient.GetCreditLedgerParams.builder()
                .orgId("org_123")
                .page(new Page(2, 50))
                .typeFilter(List.of(LedgerEntryType.purchase_credit, LedgerEntryType.usage_debit))
                .view(LedgerView.ledger_view_statement)
                .startTime(start)
                .endTime(end)
                .build()
                .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertEquals(2, proto.getPage().getNum());
        assertEquals(50, proto.getPage().getSize());
        assertEquals(
                List.of(LedgerEntryType.purchase_credit, LedgerEntryType.usage_debit),
                proto.getTypeFilterList());
        assertEquals(LedgerView.ledger_view_statement, proto.getView());
        assertEquals(start.getEpochSecond(), proto.getStartTime().getSeconds());
        assertEquals(end.getEpochSecond(), proto.getEndTime().getSeconds());
        assertEquals(500, proto.getEndTime().getNanos());
    }

    @Test
    void getCreditLedger_toProto_omitsUnsetOptionals() {
        GetCreditLedgerInput proto = BillingClient.GetCreditLedgerParams.builder()
                .orgId("org_123")
                .build()
                .toProto();

        assertFalse(proto.hasPage());
        assertTrue(proto.getTypeFilterList().isEmpty());
        assertEquals(LedgerView.ledger_view_unspecified, proto.getView());
        assertFalse(proto.hasStartTime());
        assertFalse(proto.hasEndTime());
    }

    @Test
    void getCreditLedger_missingOrgId_throws() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.GetCreditLedgerParams.builder().build());
    }

    // -- GetBillingUsageReportParams ----------------------------------------------

    @Test
    void getBillingUsageReport_toProto_convertsInstants() {
        Instant start = Instant.parse("2026-07-01T00:00:00Z");
        Instant end = Instant.parse("2026-08-01T00:00:00Z");

        GetBillingUsageReportInput proto = BillingClient.GetBillingUsageReportParams.builder()
                .orgId("org_123")
                .startTime(start)
                .endTime(end)
                .build()
                .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertEquals(start.getEpochSecond(), proto.getStartTime().getSeconds());
        assertEquals(end.getEpochSecond(), proto.getEndTime().getSeconds());
    }

    @Test
    void getBillingUsageReport_missingTimeRange_throws() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.GetBillingUsageReportParams.builder()
                        .orgId("org_123").endTime(Instant.now()).build());
        assertThrows(NullPointerException.class,
                () -> BillingClient.GetBillingUsageReportParams.builder()
                        .orgId("org_123").startTime(Instant.now()).build());
    }

    // -- Stripe params ------------------------------------------------------------

    @Test
    void createCreditCheckoutSession_toProto_mapsAllFields() {
        CreateCreditCheckoutSessionInput proto =
                BillingClient.CreateCreditCheckoutSessionParams.builder()
                        .orgId("org_123")
                        .packId("starter")
                        .successUrl("https://app.example.com/billing/success")
                        .cancelUrl("https://app.example.com/billing/cancel")
                        .build()
                        .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertEquals("starter", proto.getPackId());
        assertEquals("https://app.example.com/billing/success", proto.getSuccessUrl());
        assertEquals("https://app.example.com/billing/cancel", proto.getCancelUrl());
    }

    @Test
    void createCreditCheckoutSession_missingRequiredFields_throw() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.CreateCreditCheckoutSessionParams.builder()
                        .orgId("org_123").packId("starter")
                        .successUrl("https://a").build());
    }

    @Test
    void createBillingPortalSession_toProto_mapsAllFields() {
        CreateBillingPortalSessionInput proto =
                BillingClient.CreateBillingPortalSessionParams.builder()
                        .orgId("org_123")
                        .returnUrl("https://app.example.com/billing")
                        .build()
                        .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertEquals("https://app.example.com/billing", proto.getReturnUrl());
    }

    @Test
    void setAutoRechargeConfig_toProto_mapsAllFields() {
        SetAutoRechargeConfigInput proto = BillingClient.SetAutoRechargeConfigParams.builder()
                .orgId("org_123")
                .enabled(true)
                .thresholdMicros(5_000_000L)
                .rechargeAmountMicros(25_000_000L)
                .monthlyCapMicros(100_000_000L)
                .build()
                .toProto();

        assertEquals("org_123", proto.getOrgId());
        assertTrue(proto.getEnabled());
        assertEquals(5_000_000L, proto.getThresholdMicros());
        assertEquals(25_000_000L, proto.getRechargeAmountMicros());
        assertEquals(100_000_000L, proto.getMonthlyCapMicros());
    }

    // -- Pricing governance params --------------------------------------------------

    @Test
    void decideModelPricingOverride_toProto_defaultsNoteToEmpty() {
        DecideModelPricingOverrideInput proto =
                BillingClient.DecideModelPricingOverrideParams.builder()
                        .overrideId("ovr_123")
                        .approve(true)
                        .build()
                        .toProto();

        assertEquals("ovr_123", proto.getOverrideId());
        assertTrue(proto.getApprove());
        assertEquals("", proto.getDecisionNote());
    }

    @Test
    void upsertModelPricingBaseline_toProto_mapsBaselineAndNote() {
        ModelPricingBaseline baseline = ModelPricingBaseline.newBuilder()
                .setModelId("claude-fable-5")
                .setProvider("anthropic")
                .setHarness("native")
                .build();

        UpsertModelPricingBaselineInput proto =
                BillingClient.UpsertModelPricingBaselineParams.builder()
                        .baseline(baseline)
                        .revisionNote("provider price change 2026-08")
                        .build()
                        .toProto();

        assertEquals(baseline, proto.getBaseline());
        assertEquals("provider price change 2026-08", proto.getRevisionNote());
    }

    @Test
    void upsertModelPricingBaseline_missingBaseline_throws() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.UpsertModelPricingBaselineParams.builder().build());
    }

    @Test
    void retireModelPricingBaseline_toProto_mapsKey() {
        RetireModelPricingBaselineInput proto =
                BillingClient.RetireModelPricingBaselineParams.builder()
                        .modelId("legacy-model")
                        .provider("openai")
                        .harness("native")
                        .build()
                        .toProto();

        assertEquals("legacy-model", proto.getModelId());
        assertEquals("openai", proto.getProvider());
        assertEquals("native", proto.getHarness());
        assertEquals("", proto.getRevisionNote());
    }

    @Test
    void retireModelPricingBaseline_missingKeyFields_throw() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.RetireModelPricingBaselineParams.builder()
                        .modelId("m").provider("p").build());
    }
}
