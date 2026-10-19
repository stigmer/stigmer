package ai.stigmer.sdk;

import java.util.Objects;

/**
 * Names a File to upload with {@link RoutedFileClient#uploadFile}: where it
 * goes and what it is called. The content is passed beside it, as bytes or
 * a path, so one value serves both.
 *
 * @param org the organization the File belongs to, by id or slug; with a
 *     session id, the conversation's organization
 * @param sessionId the conversation to upload the File into; empty or
 *     {@code null} uploads a File of your own
 * @param filename the file's name: at most 255 characters, with no
 *     {@code /}, {@code \} or control characters
 * @param mimeType the media type ({@code "image/png"}); empty or
 *     {@code null} takes it from the filename's extension
 */
public record UploadFileParams(String org, String sessionId, String filename, String mimeType) {

    public UploadFileParams {
        Objects.requireNonNull(org, "stigmer: org must not be null");
        Objects.requireNonNull(filename, "stigmer: filename must not be null");
        sessionId = sessionId == null ? "" : sessionId;
        mimeType = mimeType == null ? "" : mimeType;
    }

    /** A File of your own in {@code org}, typed by its filename's extension. */
    public static UploadFileParams of(String org, String filename) {
        return new UploadFileParams(org, "", filename, "");
    }

    /** The same File, uploaded into the conversation {@code sessionId}. */
    public UploadFileParams withSessionId(String sessionId) {
        return new UploadFileParams(org, sessionId, filename, mimeType);
    }

    /** The same File, with the media type {@code mimeType}. */
    public UploadFileParams withMimeType(String mimeType) {
        return new UploadFileParams(org, sessionId, filename, mimeType);
    }
}
