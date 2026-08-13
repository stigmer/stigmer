package ai.stigmer.sdk;

import ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest;
import ai.stigmer.agentic.skill.v1.PushSkillRequest;
import ai.stigmer.agentic.skill.v1.Skill;
import ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.SkillClient;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.ByteString;
import io.grpc.Channel;
import io.grpc.Status;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * Skill client with transport-aware push routing (stigmer#675 / #701).
 *
 * <p>The gRPC transport caps messages at 10MB while skills may be up to
 * 100MB, so {@link #push} routes by size: small artifacts travel inline in
 * the request (one round trip, unchanged behavior), larger ones are staged
 * over HTTP via {@code createArtifactUploadUrl} — a capability URL, so no
 * auth header — and pushed by reference. Callers never see the mechanics:
 * {@code push(req)} simply works for any valid skill size.
 *
 * <p>Every other method is the generated client's, inherited unchanged.
 * Wired in via {@code GeneratedClient.newSkillClient}, which
 * {@link StigmerClient} overrides.
 */
public final class RoutedSkillClient extends SkillClient {

    /**
     * Largest artifact pushed inline in the gRPC request (#675). The
     * server's transport cap is 10MB for the WHOLE message, so the artifact
     * leaves 64KB of headroom for the request envelope (org, tag,
     * provenance, framing). Mirrors the Go SDK's maxInlineArtifactBytes.
     */
    public static final int MAX_INLINE_ARTIFACT_BYTES = 10 * 1024 * 1024 - 64 * 1024;

    private final HttpClient httpClient;

    /**
     * Built from the channel alone — the GeneratedClient factory hook calls
     * this during its own constructor.
     */
    public RoutedSkillClient(Channel channel) {
        super(channel);
        this.httpClient = HttpClient.newHttpClient();
    }

    /**
     * Push a skill, routing the artifact by size (see the class comment).
     *
     * <p>A request that already carries an {@code artifactUploadRef} is
     * passed through untouched — the caller has done its own staging.
     */
    @Override
    public Skill push(PushSkillRequest input) {
        if (!input.getArtifactUploadRef().isEmpty()
                || input.getArtifact().size() <= MAX_INLINE_ARTIFACT_BYTES) {
            return super.push(input);
        }
        return pushViaUploadUrl(input);
    }

    /**
     * Stage the artifact over HTTP and push by reference:
     * createArtifactUploadUrl → PUT bytes → push(artifactUploadRef).
     */
    private Skill pushViaUploadUrl(PushSkillRequest input) {
        SkillArtifactUploadUrl minted;
        try {
            minted = super.createArtifactUploadUrl(CreateSkillArtifactUploadUrlRequest.newBuilder()
                    .setOrg(input.getOrg())
                    .setSizeBytes(input.getArtifact().size())
                    .build());
        } catch (StigmerException e) {
            if (e.isUnimplemented()) {
                // Pre-transfer-lane server: without staging, an artifact
                // this size physically cannot travel. Say so instead of
                // surfacing the raw transport error (the #675 failure mode).
                throw new StigmerException(
                        ErrorCode.UNKNOWN,
                        "skill artifact is " + input.getArtifact().size()
                                + " bytes, above the ~10MB gRPC message cap, and this server does"
                                + " not support the HTTP artifact transfer lane — upgrade"
                                + " stigmer-server to push skills of this size",
                        Status.Code.UNIMPLEMENTED);
            }
            throw e;
        }

        putArtifact(minted.getUrl(), input.getArtifact());

        // Same request, artifact traveling by reference instead of by value.
        PushSkillRequest byRef = input.toBuilder()
                .setArtifact(ByteString.EMPTY)
                .setArtifactUploadRef(minted.getArtifactUploadRef())
                .build();
        return super.push(byRef);
    }

    /**
     * PUT the artifact ZIP to the staging URL. The URL is the credential
     * (capability semantics — a pre-signed R2 URL on cloud, the server's own
     * transfer lane on OSS), so no auth header is attached.
     */
    private void putArtifact(String url, ByteString artifact) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(artifact.toByteArray()))
                .header("Content-Type", "application/zip")
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new StigmerException(
                    ErrorCode.UNKNOWN,
                    "skill artifact upload failed: " + e.getMessage(),
                    Status.Code.UNKNOWN);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new StigmerException(
                    ErrorCode.UNKNOWN,
                    "skill artifact upload interrupted",
                    Status.Code.CANCELLED);
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            String detail = response.body() == null
                    ? ""
                    : response.body().substring(0, Math.min(512, response.body().length())).trim();
            throw new StigmerException(
                    ErrorCode.UNKNOWN,
                    "skill artifact upload rejected with HTTP " + response.statusCode()
                            + (detail.isEmpty() ? "" : ": " + detail),
                    Status.Code.UNKNOWN);
        }
    }
}
