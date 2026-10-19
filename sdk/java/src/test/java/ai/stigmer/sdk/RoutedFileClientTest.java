package ai.stigmer.sdk;

import ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput;
import ai.stigmer.agentic.file.v1.File;
import ai.stigmer.agentic.file.v1.FileCommandControllerGrpc;
import ai.stigmer.agentic.file.v1.FileUploadUrl;
import ai.stigmer.agentic.file.v1.UploadFileInput;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.ByteString;
import com.sun.net.httpserver.HttpServer;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Routing pins for RoutedFileClient, the File twin of
 * RoutedSkillClientTest: a real gRPC server captures uploads and mints and
 * the JDK's HttpServer plays the upload URL, so the PUT is seen as a server
 * sees it. Pins: inline at or below the threshold, staged above it with the
 * exact bytes and Content-Length and no Authorization header, a Path sent
 * whole from disk, {@code upload} itself routing large inline data, and a
 * rejected PUT reported without the URL or its query, and
 * {@code StigmerClient.file} being this client. That a Path is
 * streamed rather than read is {@code BodyPublishers.ofFile}'s contract,
 * which these tests cannot observe from the receiving side.
 */
@DisplayName("RoutedFileClient upload routing")
class RoutedFileClientTest {

    private static final String XML_REJECTION =
            "<Error><Code>SignatureDoesNotMatch</Code><Message>The signature does not match.</Message>"
                    + "<CanonicalRequest>PUT /b/k X-Amz-Credential=AKIDEXAMPLE&amp;X-Amz-Signature=s3cret"
                    + "</CanonicalRequest></Error>";

    private final List<UploadFileInput> uploads = new CopyOnWriteArrayList<>();
    private final List<CreateFileUploadUrlInput> mints = new CopyOnWriteArrayList<>();
    private final AtomicReference<byte[]> stagedBytes = new AtomicReference<>();
    private final AtomicReference<String> stagedContentLength = new AtomicReference<>();
    private final AtomicReference<String> stagedAuthorization = new AtomicReference<>();
    private final AtomicReference<String> stagedUri = new AtomicReference<>();

    private Server grpcServer;
    private HttpServer stagingServer;
    private ManagedChannel channel;
    /** Behavior knobs, set per test before the first RPC. */
    private volatile String mintPathAndQuery = "/staging/fup_t?sig=s3cret";
    private volatile int stagingStatus = 200;
    private volatile String stagingBody = "";

    private final class FakeFileService extends FileCommandControllerGrpc.FileCommandControllerImplBase {
        @Override
        public void upload(UploadFileInput request, StreamObserver<File> responseObserver) {
            uploads.add(request);
            responseObserver.onNext(File.getDefaultInstance());
            responseObserver.onCompleted();
        }

        @Override
        public void createUploadUrl(CreateFileUploadUrlInput request, StreamObserver<FileUploadUrl> responseObserver) {
            mints.add(request);
            responseObserver.onNext(FileUploadUrl.newBuilder()
                    .setUrl(stagingBase() + mintPathAndQuery)
                    .setUploadRef("fup_t")
                    .setTtlSeconds(900)
                    .build());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        stagingServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        stagingServer.createContext("/", exchange -> {
            stagedUri.set(exchange.getRequestURI().toString());
            stagedContentLength.set(exchange.getRequestHeaders().getFirst("Content-Length"));
            stagedAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            stagedBytes.set(exchange.getRequestBody().readAllBytes());
            byte[] body = stagingBody.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(stagingStatus, body.length == 0 ? -1 : body.length);
            if (body.length > 0) {
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        stagingServer.start();

        grpcServer = NettyServerBuilder.forPort(0)
                .maxInboundMessageSize(11 * 1024 * 1024)
                .addService(new FakeFileService())
                .build()
                .start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort())
                .usePlaintext()
                .maxInboundMessageSize(11 * 1024 * 1024)
                .build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
        stagingServer.stop(0);
    }

    private String stagingBase() {
        return "http://localhost:" + stagingServer.getAddress().getPort();
    }

    private RoutedFileClient client() {
        return new RoutedFileClient(channel);
    }

    private static byte[] patterned(int size) {
        byte[] bytes = new byte[size];
        for (int i = 0; i < size; i++) {
            bytes[i] = (byte) (i % 251);
        }
        return bytes;
    }

    @Test
    @DisplayName("keeps content at the threshold inline: no mint, the bytes in the request")
    void contentAtThresholdStaysInline() {
        byte[] content = patterned(RoutedFileClient.MAX_INLINE_BYTES);

        client().uploadFile(UploadFileParams.of("acme", "a.bin").withSessionId("ses_1").withMimeType("image/png"), content);

        assertEquals(0, mints.size());
        assertNull(stagedBytes.get());
        UploadFileInput sent = uploads.get(0);
        assertEquals(UploadFileInput.SourceCase.DATA, sent.getSourceCase());
        assertEquals(ByteString.copyFrom(content), sent.getData());
        assertEquals("acme", sent.getOrg());
        assertEquals("ses_1", sent.getSessionId());
        assertEquals("a.bin", sent.getFilename());
        assertEquals("image/png", sent.getMimeType());
    }

    @Test
    @DisplayName("stages content above the threshold: exact bytes, no Authorization, upload by reference")
    void contentAboveThresholdIsStaged() {
        byte[] content = patterned(RoutedFileClient.MAX_INLINE_BYTES + 1);

        client().uploadFile(UploadFileParams.of("acme", "big.bin").withSessionId("ses_1"), content);

        assertEquals(1, mints.size());
        assertEquals("acme", mints.get(0).getOrg());
        assertEquals("ses_1", mints.get(0).getSessionId());
        assertEquals(content.length, mints.get(0).getSizeBytes());
        assertEquals("/staging/fup_t?sig=s3cret", stagedUri.get());
        assertEquals(String.valueOf(content.length), stagedContentLength.get());
        assertNull(stagedAuthorization.get());
        assertArrayEquals(content, stagedBytes.get());
        UploadFileInput sent = uploads.get(0);
        assertEquals(UploadFileInput.SourceCase.UPLOAD_REF, sent.getSourceCase());
        assertEquals("fup_t", sent.getUploadRef());
        assertEquals("big.bin", sent.getFilename());
        assertEquals("ses_1", sent.getSessionId());
    }

    @Test
    @DisplayName("sends a large file from disk with its exact length")
    void largePathIsStaged(@TempDir Path dir) throws Exception {
        byte[] content = patterned(RoutedFileClient.MAX_INLINE_BYTES + 4096);
        Path path = dir.resolve("ledger.xlsx");
        Files.write(path, content);

        client().uploadFile(UploadFileParams.of("acme", "ledger.xlsx"), path);

        assertEquals(content.length, mints.get(0).getSizeBytes());
        assertEquals(String.valueOf(content.length), stagedContentLength.get());
        assertArrayEquals(content, stagedBytes.get());
        assertEquals("fup_t", uploads.get(0).getUploadRef());
    }

    @Test
    @DisplayName("uploads a small file from disk inline")
    void smallPathIsInline(@TempDir Path dir) throws Exception {
        Path path = dir.resolve("notes.txt");
        Files.writeString(path, "hello");

        client().uploadFile(UploadFileParams.of("acme", "notes.txt"), path);

        assertEquals(0, mints.size());
        assertEquals(ByteString.copyFromUtf8("hello"), uploads.get(0).getData());
    }

    @Test
    @DisplayName("routes upload() itself when its inline data is above the threshold")
    void uploadWithLargeInlineDataIsStaged() {
        byte[] data = patterned(RoutedFileClient.MAX_INLINE_BYTES + 1);

        client().upload(UploadFileInput.newBuilder()
                .setOrg("acme")
                .setFilename("big.csv")
                .setMimeType("text/csv")
                .setData(ByteString.copyFrom(data))
                .build());

        assertEquals(String.valueOf(data.length), stagedContentLength.get());
        assertArrayEquals(data, stagedBytes.get());
        UploadFileInput sent = uploads.get(0);
        assertEquals("fup_t", sent.getUploadRef());
        assertEquals("text/csv", sent.getMimeType());
        assertEquals("big.csv", sent.getFilename());
    }

    @Test
    @DisplayName("reports a rejected PUT by its status and the bucket's Code and Message, never the URL")
    void rejectedPutNamesNeitherUrlNorQuery() {
        stagingStatus = 403;
        stagingBody = XML_REJECTION;
        mintPathAndQuery = "/b/k?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=s3cret";

        StigmerException e = assertThrows(StigmerException.class, () -> client()
                .uploadFile(UploadFileParams.of("acme", "big.bin"), patterned(RoutedFileClient.MAX_INLINE_BYTES + 1)));

        assertEquals("file upload rejected with HTTP 403: SignatureDoesNotMatch: The signature does not match.",
                e.getMessage());
        assertTrue(uploads.isEmpty(), "upload must not follow a rejected PUT");
    }

    @Test
    @DisplayName("redacts a plain-text rejection that echoes the URL or its query")
    void plainRejectionEchoingTheUrlIsRedacted() {
        mintPathAndQuery = "/u/fup_t?token=s3cret";
        stagingStatus = 404;
        stagingBody = "no slot at " + stagingBase() + mintPathAndQuery + "; query token=s3cret";

        StigmerException e = assertThrows(StigmerException.class, () -> client()
                .uploadFile(UploadFileParams.of("acme", "big.bin"), patterned(RoutedFileClient.MAX_INLINE_BYTES + 1)));

        assertTrue(e.getMessage().startsWith("file upload rejected with HTTP 404: "), e.getMessage());
        assertFalse(e.getMessage().contains("s3cret"), e.getMessage());
        assertFalse(e.getMessage().contains(stagingBase()), e.getMessage());
    }

    @Test
    @DisplayName("StigmerClient.file is the routed client")
    void stigmerClientFileIsRouted() {
        try (StigmerClient stigmer = StigmerClient.builder("sk_test_key").insecure().build()) {
            assertInstanceOf(RoutedFileClient.class, stigmer.file);
        }
    }

    @Test
    @DisplayName("reports an unreachable upload URL without naming it")
    void unreachableUrlIsNotNamed() {
        stagingServer.stop(0);

        StigmerException e = assertThrows(StigmerException.class, () -> client()
                .uploadFile(UploadFileParams.of("acme", "big.bin"), patterned(RoutedFileClient.MAX_INLINE_BYTES + 1)));

        assertFalse(e.getMessage().contains("s3cret"), e.getMessage());
        assertTrue(uploads.isEmpty());
    }
}
