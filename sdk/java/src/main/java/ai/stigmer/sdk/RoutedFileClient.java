package ai.stigmer.sdk;

import ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput;
import ai.stigmer.agentic.file.v1.File;
import ai.stigmer.agentic.file.v1.FileUploadUrl;
import ai.stigmer.agentic.file.v1.UploadFileInput;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.FileClient;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.ByteString;
import io.grpc.Channel;
import io.grpc.Status;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * File client with size-routed uploads: the File kind's binding of the
 * transfer lane skills already push over ({@link RoutedSkillClient}). The
 * transport caps a whole request at 10 MiB, so content at or below the
 * skills' inline threshold travels in the {@code upload} request itself, and
 * larger content is PUT to the short-lived URL {@code createUploadUrl} mints
 * and then uploaded by its reference.
 *
 * <p>Trade-offs:
 * <ul>
 *   <li>A {@link Path} is sent with {@code BodyPublishers.ofFile}, which
 *       streams it from disk, so a large file is never held in memory; only
 *       a file small enough to travel inline is read whole, because the
 *       inline request carries the bytes.</li>
 *   <li>The PUT carries no Authorization header: the URL is the credential.
 *       For the same reason no error names it, since a bucket's URL holds
 *       its signature in the query and the server's own lane holds its token
 *       in the path. A bucket's XML rejection is cut down to its Code and
 *       Message, the parts that never restate the signed request.</li>
 * </ul>
 *
 * <p>Every other method is the generated client's, inherited unchanged;
 * {@link #upload} also routes, so a request built with large inline data is
 * staged instead of refused by the transport. Wired in via
 * {@code GeneratedClient.newFileClient}, which {@link StigmerClient}
 * overrides.
 */
public final class RoutedFileClient extends FileClient {

    /**
     * Largest content uploaded inline: the skills' threshold
     * ({@link RoutedSkillClient#MAX_INLINE_ARTIFACT_BYTES}), 64 KiB under the
     * transport's 10 MiB request cap.
     */
    public static final int MAX_INLINE_BYTES = RoutedSkillClient.MAX_INLINE_ARTIFACT_BYTES;

    private static final int MAX_REJECTION_DETAIL = 512;
    private static final int MAX_REJECTION_BODY = 64 * 1024;
    private static final Pattern XML_CODE = Pattern.compile("<Code>([^<]*)</Code>");
    private static final Pattern XML_MESSAGE = Pattern.compile("<Message>([^<]*)</Message>");

    private final HttpClient httpClient;

    /**
     * Built from the channel alone — the GeneratedClient factory hook calls
     * this during its own constructor.
     */
    public RoutedFileClient(Channel channel) {
        super(channel);
        this.httpClient = HttpClient.newHttpClient();
    }

    // -- Size-routed uploads -------------------------------------------------

    /** Uploads a File from bytes in memory, routing them by size. */
    public File uploadFile(UploadFileParams params, byte[] content) {
        Objects.requireNonNull(content, "content");
        if (content.length > MAX_INLINE_BYTES) {
            return uploadStaged(params, content.length, HttpRequest.BodyPublishers.ofByteArray(content));
        }
        return super.upload(target(params).setData(ByteString.copyFrom(content)).build());
    }

    /**
     * Uploads a File from a file on disk, routing it by size. A large file
     * is streamed from disk, never read into memory.
     */
    public File uploadFile(UploadFileParams params, Path content) {
        Objects.requireNonNull(content, "content");
        try {
            long size = Files.size(content);
            if (size <= MAX_INLINE_BYTES) {
                return super.upload(target(params).setData(ByteString.copyFrom(Files.readAllBytes(content))).build());
            }
            return uploadStaged(params, size, HttpRequest.BodyPublishers.ofFile(content));
        } catch (IOException e) {
            throw new UncheckedIOException("stigmer: reading " + content + ": " + e, e);
        }
    }

    /**
     * Uploads a File from a built request. Inline data above
     * {@link #MAX_INLINE_BYTES} is staged and uploaded by reference; any
     * other request is sent as it is.
     */
    @Override
    public File upload(UploadFileInput input) {
        if (input.getSourceCase() == UploadFileInput.SourceCase.DATA && input.getData().size() > MAX_INLINE_BYTES) {
            UploadFileParams params = new UploadFileParams(
                    input.getOrg(), input.getSessionId(), input.getFilename(), input.getMimeType());
            ByteString data = input.getData();
            // A stream over the ByteString with its length stated: no copy,
            // and a Content-Length rather than a chunked body.
            HttpRequest.BodyPublisher body = HttpRequest.BodyPublishers.fromPublisher(
                    HttpRequest.BodyPublishers.ofInputStream(data::newInput), data.size());
            return uploadStaged(params, data.size(), body);
        }
        return super.upload(input);
    }

    // -- The staged lane -----------------------------------------------------

    private static UploadFileInput.Builder target(UploadFileParams params) {
        return UploadFileInput.newBuilder()
                .setOrg(params.org())
                .setSessionId(params.sessionId())
                .setFilename(params.filename())
                .setMimeType(params.mimeType());
    }

    /** createUploadUrl, PUT the bytes, then upload by the returned reference. */
    private File uploadStaged(UploadFileParams params, long size, HttpRequest.BodyPublisher body) {
        FileUploadUrl minted = super.createUploadUrl(CreateFileUploadUrlInput.newBuilder()
                .setOrg(params.org())
                .setSessionId(params.sessionId())
                .setSizeBytes(size)
                .build());
        putContent(minted.getUrl(), body);
        return super.upload(target(params).setUploadRef(minted.getUploadRef()).build());
    }

    /**
     * PUT the content to the upload URL with no auth header. The publisher
     * states the exact length, which the client sends as Content-Length; on
     * a bucket that length is signed into the URL.
     */
    private void putContent(String url, HttpRequest.BodyPublisher body) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(url))
                    .PUT(body)
                    .header("Content-Type", "application/octet-stream")
                    .build();
        } catch (IllegalArgumentException e) {
            // URI.create's message quotes the URL; report the failure without it.
            throw new StigmerException(ErrorCode.UNKNOWN,
                    "file upload failed: the upload URL is malformed", Status.Code.UNKNOWN);
        }

        HttpResponse<InputStream> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            throw new StigmerException(ErrorCode.UNAVAILABLE,
                    "file upload failed: " + redactUrl(e.getClass().getSimpleName()
                            + (e.getMessage() == null ? "" : ": " + e.getMessage()), url),
                    Status.Code.UNAVAILABLE);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new StigmerException(ErrorCode.UNKNOWN, "file upload interrupted", Status.Code.CANCELLED);
        }

        int status = response.statusCode();
        String text = readAnswer(response.body());
        if (status >= 200 && status < 300) {
            return;
        }
        String detail = redactUrl(rejectionDetail(text), url);
        throw new StigmerException(ErrorCode.UNKNOWN,
                "file upload rejected with HTTP " + status + (detail.isEmpty() ? "" : ": " + detail),
                Status.Code.UNKNOWN);
    }

    /**
     * The start of the answer body, closing it. The status already decided
     * the outcome, so an unreadable body only loses the detail.
     */
    private static String readAnswer(InputStream answer) {
        try (answer) {
            return new String(answer.readNBytes(MAX_REJECTION_BODY), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    /**
     * The part of a rejection body worth showing. A bucket answers XML whose
     * other elements can restate the signed request, so only its Code and
     * Message are kept; the server's own lane answers plain text.
     */
    static String rejectionDetail(String body) {
        String text = body.strip();
        if (!text.startsWith("<")) {
            return truncate(text);
        }
        List<String> parts = new ArrayList<>();
        for (Pattern element : List.of(XML_CODE, XML_MESSAGE)) {
            Matcher m = element.matcher(text);
            if (m.find() && !m.group(1).isBlank()) {
                parts.add(m.group(1).strip());
            }
        }
        return truncate(String.join(": ", parts));
    }

    /** Remove the URL, and its query on its own, from text that echoes either. */
    static String redactUrl(String text, String url) {
        String out = text.replace(url, "[redacted]");
        int queryStart = url.indexOf('?');
        if (queryStart >= 0 && queryStart + 1 < url.length()) {
            out = out.replace(url.substring(queryStart + 1), "[redacted]");
        }
        return out;
    }

    private static String truncate(String s) {
        return s.length() <= MAX_REJECTION_DETAIL ? s : s.substring(0, MAX_REJECTION_DETAIL);
    }
}
