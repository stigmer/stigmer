package ai.stigmer.sdk;

import ai.stigmer.billing.v1.CreateBillingPortalSessionInput;
import ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput;
import ai.stigmer.billing.v1.ModelPricingBaseline;
import ai.stigmer.billing.v1.RetireModelPricingBaselineInput;
import ai.stigmer.billing.v1.UpsertModelPricingBaselineInput;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Wire-shape pins for {@link BillingClient} param-to-proto conversion.
 *
 * <p>Each params class owns its proto request construction via a
 * package-private {@code toProto()}; these tests pin that mapping (field
 * routing, optional-field presence) and the builders' required-field
 * enforcement, without needing a gRPC server.
 */
class BillingClientTest {

    // -- Stripe params ------------------------------------------------------------

    @Test
    void createBillingPortalSession_toProto_mapsAllFields() {
        CreateBillingPortalSessionInput proto =
                BillingClient.CreateBillingPortalSessionParams.builder()
                        .org("org_123")
                        .returnUrl("https://app.example.com/billing")
                        .build()
                        .toProto();

        assertEquals("org_123", proto.getOrg());
        assertEquals("https://app.example.com/billing", proto.getReturnUrl());
    }

    @Test
    void createPaymentMethodSetupSession_toProto_mapsAllFields() {
        CreatePaymentMethodSetupSessionInput proto =
                BillingClient.CreatePaymentMethodSetupSessionParams.builder()
                        .org("org_123")
                        .successUrl("https://app.example.com/billing/saved")
                        .cancelUrl("https://app.example.com/billing")
                        .build()
                        .toProto();

        assertEquals("org_123", proto.getOrg());
        assertEquals("https://app.example.com/billing/saved", proto.getSuccessUrl());
        assertEquals("https://app.example.com/billing", proto.getCancelUrl());
    }

    @Test
    void createPaymentMethodSetupSession_missingRequiredFields_throw() {
        assertThrows(NullPointerException.class,
                () -> BillingClient.CreatePaymentMethodSetupSessionParams.builder()
                        .org("org_123").successUrl("https://a").build());
    }

    // -- Model catalog params --------------------------------------------------------

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
