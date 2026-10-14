package ai.stigmer.sdk;

import ai.stigmer.iam.token.v1.MintUserTokenRequest;
import ai.stigmer.iam.token.v1.MintUserTokenResponse;
import ai.stigmer.iam.token.v1.TokenServiceGrpc;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.Channel;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;

import java.time.Instant;
import java.util.Objects;

/**
 * Client for the token service: mints the short-lived user tokens a browser
 * uses to talk to Stigmer on behalf of a person signed in to an
 * organization's own product.
 *
 * <p>The token service manages no resource, so it is served here rather than
 * by a generated resource client. A product's backend calls it with the
 * ordinary {@link StigmerClient}, authenticated by the API key of a service
 * account that administers the organization the token is for (or its parent
 * organization); a person's key is refused {@link ErrorCode#PERMISSION_DENIED}.
 * Pass the minted token to the React SDK's {@code StigmerProvider} through
 * {@code getAccessToken}.
 *
 * <pre>{@code
 * try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
 *     MintUserTokenResult token = client.tokens().mintUserToken(MintUserTokenInput.builder()
 *         .org("acme")
 *         .userId("user-123")
 *         .userEmail("jane@acme.com")
 *         .userName("Jane Doe")
 *         .build());
 * }
 * }</pre>
 */
public final class TokenClient {

    private final TokenServiceGrpc.TokenServiceBlockingStub stub;

    TokenClient(Channel channel) {
        this.stub = TokenServiceGrpc.newBlockingStub(Objects.requireNonNull(channel, "channel must not be null"));
    }

    /**
     * Mints a user token for a person signed in to an organization's own
     * product. The person's identity account in that organization is created
     * on first sign-in when the organization's embedding settings allow it.
     *
     * <p>An empty organization or user id is refused before any request is
     * sent.
     *
     * @param input the organization the token is for and the person's identity
     * @return the minted token, with its lifetime and absolute expiry
     * @throws StigmerException with {@link ErrorCode#INVALID_ARGUMENT} if the
     *         organization or the user id is empty
     * @throws StigmerException with {@link ErrorCode#PERMISSION_DENIED} if the
     *         caller is not a service account, or its account may not mint for
     *         the organization
     * @throws StigmerException with {@link ErrorCode#FAILED_PRECONDITION} if the
     *         person has no account and the organization does not create one,
     *         or the server does not authenticate its callers
     */
    public MintUserTokenResult mintUserToken(MintUserTokenInput input) {
        Objects.requireNonNull(input, "input must not be null");
        String org = input.org();
        if (org == null || org.isEmpty()) {
            throw new StigmerException(
                    ErrorCode.INVALID_ARGUMENT,
                    "mintUserToken: org is required — the organization the token is for, by id or slug",
                    Status.Code.INVALID_ARGUMENT);
        }
        String userId = input.userId();
        if (userId == null || userId.isEmpty()) {
            throw new StigmerException(
                    ErrorCode.INVALID_ARGUMENT,
                    "mintUserToken: userId is required — the product's stable identifier for the person",
                    Status.Code.INVALID_ARGUMENT);
        }

        MintUserTokenRequest request = MintUserTokenRequest.newBuilder()
                .setOrg(org)
                .setUserId(userId)
                .setUserEmail(input.userEmail())
                .setUserName(input.userName())
                .build();

        try {
            MintUserTokenResponse response = stub.mintUserToken(request);
            return new MintUserTokenResult(
                    response.getAccessToken(),
                    response.getTokenType(),
                    response.getExpiresIn(),
                    Instant.now().plusSeconds(response.getExpiresIn()));
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }
}
