package ai.stigmer.agentic.artifact.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ArtifactQueryController handles read operations for Artifact resources.
 * &#64;internal
 * Follows the Command-Query Separation (CQS) pattern.
 * These RPCs are exposed to the SDK and consumed by:
 * - Execution viewer (T09): lists artifacts per execution, provides download links
 * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
 * - React SDK: useArtifact() hook for artifact metadata and download
 * Authorization follows the parent execution's access model:
 * if a user can view an execution, they can view its artifacts.
 * &#64;since T07 (Artifact Store)
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ArtifactQueryControllerGrpc {

  private ArtifactQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.artifact.v1.ArtifactQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId,
      ai.stigmer.agentic.artifact.v1.Artifact> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.artifact.v1.ArtifactId.class,
      responseType = ai.stigmer.agentic.artifact.v1.Artifact.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId,
      ai.stigmer.agentic.artifact.v1.Artifact> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId, ai.stigmer.agentic.artifact.v1.Artifact> getGetMethod;
    if ((getGetMethod = ArtifactQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ArtifactQueryControllerGrpc.class) {
        if ((getGetMethod = ArtifactQueryControllerGrpc.getGetMethod) == null) {
          ArtifactQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.artifact.v1.ArtifactId, ai.stigmer.agentic.artifact.v1.Artifact>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.ArtifactId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.Artifact.getDefaultInstance()))
              .setSchemaDescriptor(new ArtifactQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest,
      ai.stigmer.agentic.artifact.v1.ArtifactList> getListByExecutionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByExecution",
      requestType = ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest.class,
      responseType = ai.stigmer.agentic.artifact.v1.ArtifactList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest,
      ai.stigmer.agentic.artifact.v1.ArtifactList> getListByExecutionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest, ai.stigmer.agentic.artifact.v1.ArtifactList> getListByExecutionMethod;
    if ((getListByExecutionMethod = ArtifactQueryControllerGrpc.getListByExecutionMethod) == null) {
      synchronized (ArtifactQueryControllerGrpc.class) {
        if ((getListByExecutionMethod = ArtifactQueryControllerGrpc.getListByExecutionMethod) == null) {
          ArtifactQueryControllerGrpc.getListByExecutionMethod = getListByExecutionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest, ai.stigmer.agentic.artifact.v1.ArtifactList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByExecution"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.ArtifactList.getDefaultInstance()))
              .setSchemaDescriptor(new ArtifactQueryControllerMethodDescriptorSupplier("listByExecution"))
              .build();
        }
      }
    }
    return getListByExecutionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId,
      ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> getGetDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getDownloadUrl",
      requestType = ai.stigmer.agentic.artifact.v1.ArtifactId.class,
      responseType = ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId,
      ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> getGetDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.ArtifactId, ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> getGetDownloadUrlMethod;
    if ((getGetDownloadUrlMethod = ArtifactQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
      synchronized (ArtifactQueryControllerGrpc.class) {
        if ((getGetDownloadUrlMethod = ArtifactQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
          ArtifactQueryControllerGrpc.getGetDownloadUrlMethod = getGetDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.artifact.v1.ArtifactId, ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.ArtifactId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new ArtifactQueryControllerMethodDescriptorSupplier("getDownloadUrl"))
              .build();
        }
      }
    }
    return getGetDownloadUrlMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ArtifactQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerStub>() {
        @java.lang.Override
        public ArtifactQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactQueryControllerStub(channel, callOptions);
        }
      };
    return ArtifactQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ArtifactQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ArtifactQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ArtifactQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ArtifactQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerBlockingStub>() {
        @java.lang.Override
        public ArtifactQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ArtifactQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ArtifactQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactQueryControllerFutureStub>() {
        @java.lang.Override
        public ArtifactQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ArtifactQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single artifact by ID.
     * Returns the complete Artifact resource including metadata, spec,
     * and status (content hash, size, storage state, expiration).
     * Does NOT return the artifact content — use getDownloadUrl to
     * retrieve a URL for downloading the content via HTTP GET.
     * Use Cases:
     * 1. Artifact Detail View:
     *    - User clicks an artifact in the execution viewer
     *    - UI calls get() to fetch full metadata
     *    - UI displays content type, size, source task, expiration
     * 2. Artifact Reference Resolution:
     *    - Task output contains _artifact_ref field
     *    - UI calls get() to resolve the reference to metadata
     *    - UI renders a download/preview widget instead of raw JSON
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    default void get(ai.stigmer.agentic.artifact.v1.ArtifactId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all artifacts produced by a specific execution.
     * Returns a paginated list of artifacts filtered by either
     * workflow_execution_id or agent_execution_id.
     * Use Cases:
     * 1. Execution Viewer Artifact Panel:
     *    - User views a workflow execution in the execution viewer
     *    - UI calls listByExecution() to populate the artifact sidebar
     *    - Each artifact shows display name, content type, size, source task
     * 2. CLI Artifact Listing:
     *    - `stigmer workflow artifacts wex_abc123`
     *    - CLI calls listByExecution() and formats as a table
     * Error Cases:
     * - INVALID_ARGUMENT: Neither workflow_execution_id nor agent_execution_id provided
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    default void listByExecution(ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByExecutionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a download URL for artifact content.
     * Returns a URL that the client can use to download the artifact's
     * content via HTTP GET. This avoids streaming large blobs through
     * the gRPC control plane.
     * Cloud: returns a pre-signed S3 URL with a short TTL (15 minutes).
     * OSS: returns a direct URL to the local artifact server endpoint.
     * Use Cases:
     * 1. Download Artifact:
     *    - User clicks "Download" in the execution viewer
     *    - UI calls getDownloadUrl() to get a URL
     *    - Browser opens the URL in a new tab or triggers a download
     * 2. Preview Artifact:
     *    - UI calls getDownloadUrl() for JSON/text artifacts
     *    - UI fetches content from the URL and renders inline
     *    - Large artifacts show a truncated preview with download option
     * 3. CLI Download:
     *    - `stigmer workflow artifact download art_abc123 -o output.json`
     *    - CLI calls getDownloadUrl() then fetches via HTTP GET
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * - FAILED_PRECONDITION: Artifact blob has been deleted (storage_state_deleted)
     * </pre>
     */
    default void getDownloadUrl(ai.stigmer.agentic.artifact.v1.ArtifactId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetDownloadUrlMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ArtifactQueryController.
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static abstract class ArtifactQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ArtifactQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ArtifactQueryController.
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ArtifactQueryControllerStub> {
    private ArtifactQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single artifact by ID.
     * Returns the complete Artifact resource including metadata, spec,
     * and status (content hash, size, storage state, expiration).
     * Does NOT return the artifact content — use getDownloadUrl to
     * retrieve a URL for downloading the content via HTTP GET.
     * Use Cases:
     * 1. Artifact Detail View:
     *    - User clicks an artifact in the execution viewer
     *    - UI calls get() to fetch full metadata
     *    - UI displays content type, size, source task, expiration
     * 2. Artifact Reference Resolution:
     *    - Task output contains _artifact_ref field
     *    - UI calls get() to resolve the reference to metadata
     *    - UI renders a download/preview widget instead of raw JSON
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public void get(ai.stigmer.agentic.artifact.v1.ArtifactId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all artifacts produced by a specific execution.
     * Returns a paginated list of artifacts filtered by either
     * workflow_execution_id or agent_execution_id.
     * Use Cases:
     * 1. Execution Viewer Artifact Panel:
     *    - User views a workflow execution in the execution viewer
     *    - UI calls listByExecution() to populate the artifact sidebar
     *    - Each artifact shows display name, content type, size, source task
     * 2. CLI Artifact Listing:
     *    - `stigmer workflow artifacts wex_abc123`
     *    - CLI calls listByExecution() and formats as a table
     * Error Cases:
     * - INVALID_ARGUMENT: Neither workflow_execution_id nor agent_execution_id provided
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public void listByExecution(ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByExecutionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a download URL for artifact content.
     * Returns a URL that the client can use to download the artifact's
     * content via HTTP GET. This avoids streaming large blobs through
     * the gRPC control plane.
     * Cloud: returns a pre-signed S3 URL with a short TTL (15 minutes).
     * OSS: returns a direct URL to the local artifact server endpoint.
     * Use Cases:
     * 1. Download Artifact:
     *    - User clicks "Download" in the execution viewer
     *    - UI calls getDownloadUrl() to get a URL
     *    - Browser opens the URL in a new tab or triggers a download
     * 2. Preview Artifact:
     *    - UI calls getDownloadUrl() for JSON/text artifacts
     *    - UI fetches content from the URL and renders inline
     *    - Large artifacts show a truncated preview with download option
     * 3. CLI Download:
     *    - `stigmer workflow artifact download art_abc123 -o output.json`
     *    - CLI calls getDownloadUrl() then fetches via HTTP GET
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * - FAILED_PRECONDITION: Artifact blob has been deleted (storage_state_deleted)
     * </pre>
     */
    public void getDownloadUrl(ai.stigmer.agentic.artifact.v1.ArtifactId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ArtifactQueryController.
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ArtifactQueryControllerBlockingV2Stub> {
    private ArtifactQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single artifact by ID.
     * Returns the complete Artifact resource including metadata, spec,
     * and status (content hash, size, storage state, expiration).
     * Does NOT return the artifact content — use getDownloadUrl to
     * retrieve a URL for downloading the content via HTTP GET.
     * Use Cases:
     * 1. Artifact Detail View:
     *    - User clicks an artifact in the execution viewer
     *    - UI calls get() to fetch full metadata
     *    - UI displays content type, size, source task, expiration
     * 2. Artifact Reference Resolution:
     *    - Task output contains _artifact_ref field
     *    - UI calls get() to resolve the reference to metadata
     *    - UI renders a download/preview widget instead of raw JSON
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact get(ai.stigmer.agentic.artifact.v1.ArtifactId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all artifacts produced by a specific execution.
     * Returns a paginated list of artifacts filtered by either
     * workflow_execution_id or agent_execution_id.
     * Use Cases:
     * 1. Execution Viewer Artifact Panel:
     *    - User views a workflow execution in the execution viewer
     *    - UI calls listByExecution() to populate the artifact sidebar
     *    - Each artifact shows display name, content type, size, source task
     * 2. CLI Artifact Listing:
     *    - `stigmer workflow artifacts wex_abc123`
     *    - CLI calls listByExecution() and formats as a table
     * Error Cases:
     * - INVALID_ARGUMENT: Neither workflow_execution_id nor agent_execution_id provided
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.ArtifactList listByExecution(ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByExecutionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a download URL for artifact content.
     * Returns a URL that the client can use to download the artifact's
     * content via HTTP GET. This avoids streaming large blobs through
     * the gRPC control plane.
     * Cloud: returns a pre-signed S3 URL with a short TTL (15 minutes).
     * OSS: returns a direct URL to the local artifact server endpoint.
     * Use Cases:
     * 1. Download Artifact:
     *    - User clicks "Download" in the execution viewer
     *    - UI calls getDownloadUrl() to get a URL
     *    - Browser opens the URL in a new tab or triggers a download
     * 2. Preview Artifact:
     *    - UI calls getDownloadUrl() for JSON/text artifacts
     *    - UI fetches content from the URL and renders inline
     *    - Large artifacts show a truncated preview with download option
     * 3. CLI Download:
     *    - `stigmer workflow artifact download art_abc123 -o output.json`
     *    - CLI calls getDownloadUrl() then fetches via HTTP GET
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * - FAILED_PRECONDITION: Artifact blob has been deleted (storage_state_deleted)
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl getDownloadUrl(ai.stigmer.agentic.artifact.v1.ArtifactId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ArtifactQueryController.
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ArtifactQueryControllerBlockingStub> {
    private ArtifactQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single artifact by ID.
     * Returns the complete Artifact resource including metadata, spec,
     * and status (content hash, size, storage state, expiration).
     * Does NOT return the artifact content — use getDownloadUrl to
     * retrieve a URL for downloading the content via HTTP GET.
     * Use Cases:
     * 1. Artifact Detail View:
     *    - User clicks an artifact in the execution viewer
     *    - UI calls get() to fetch full metadata
     *    - UI displays content type, size, source task, expiration
     * 2. Artifact Reference Resolution:
     *    - Task output contains _artifact_ref field
     *    - UI calls get() to resolve the reference to metadata
     *    - UI renders a download/preview widget instead of raw JSON
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact get(ai.stigmer.agentic.artifact.v1.ArtifactId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all artifacts produced by a specific execution.
     * Returns a paginated list of artifacts filtered by either
     * workflow_execution_id or agent_execution_id.
     * Use Cases:
     * 1. Execution Viewer Artifact Panel:
     *    - User views a workflow execution in the execution viewer
     *    - UI calls listByExecution() to populate the artifact sidebar
     *    - Each artifact shows display name, content type, size, source task
     * 2. CLI Artifact Listing:
     *    - `stigmer workflow artifacts wex_abc123`
     *    - CLI calls listByExecution() and formats as a table
     * Error Cases:
     * - INVALID_ARGUMENT: Neither workflow_execution_id nor agent_execution_id provided
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.ArtifactList listByExecution(ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByExecutionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a download URL for artifact content.
     * Returns a URL that the client can use to download the artifact's
     * content via HTTP GET. This avoids streaming large blobs through
     * the gRPC control plane.
     * Cloud: returns a pre-signed S3 URL with a short TTL (15 minutes).
     * OSS: returns a direct URL to the local artifact server endpoint.
     * Use Cases:
     * 1. Download Artifact:
     *    - User clicks "Download" in the execution viewer
     *    - UI calls getDownloadUrl() to get a URL
     *    - Browser opens the URL in a new tab or triggers a download
     * 2. Preview Artifact:
     *    - UI calls getDownloadUrl() for JSON/text artifacts
     *    - UI fetches content from the URL and renders inline
     *    - Large artifacts show a truncated preview with download option
     * 3. CLI Download:
     *    - `stigmer workflow artifact download art_abc123 -o output.json`
     *    - CLI calls getDownloadUrl() then fetches via HTTP GET
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * - FAILED_PRECONDITION: Artifact blob has been deleted (storage_state_deleted)
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl getDownloadUrl(ai.stigmer.agentic.artifact.v1.ArtifactId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ArtifactQueryController.
   * <pre>
   * ArtifactQueryController handles read operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are exposed to the SDK and consumed by:
   * - Execution viewer (T09): lists artifacts per execution, provides download links
   * - CLI: `stigmer workflow artifacts &lt;execution-id&gt;`
   * - React SDK: useArtifact() hook for artifact metadata and download
   * Authorization follows the parent execution's access model:
   * if a user can view an execution, they can view its artifacts.
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ArtifactQueryControllerFutureStub> {
    private ArtifactQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single artifact by ID.
     * Returns the complete Artifact resource including metadata, spec,
     * and status (content hash, size, storage state, expiration).
     * Does NOT return the artifact content — use getDownloadUrl to
     * retrieve a URL for downloading the content via HTTP GET.
     * Use Cases:
     * 1. Artifact Detail View:
     *    - User clicks an artifact in the execution viewer
     *    - UI calls get() to fetch full metadata
     *    - UI displays content type, size, source task, expiration
     * 2. Artifact Reference Resolution:
     *    - Task output contains _artifact_ref field
     *    - UI calls get() to resolve the reference to metadata
     *    - UI renders a download/preview widget instead of raw JSON
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.artifact.v1.Artifact> get(
        ai.stigmer.agentic.artifact.v1.ArtifactId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all artifacts produced by a specific execution.
     * Returns a paginated list of artifacts filtered by either
     * workflow_execution_id or agent_execution_id.
     * Use Cases:
     * 1. Execution Viewer Artifact Panel:
     *    - User views a workflow execution in the execution viewer
     *    - UI calls listByExecution() to populate the artifact sidebar
     *    - Each artifact shows display name, content type, size, source task
     * 2. CLI Artifact Listing:
     *    - `stigmer workflow artifacts wex_abc123`
     *    - CLI calls listByExecution() and formats as a table
     * Error Cases:
     * - INVALID_ARGUMENT: Neither workflow_execution_id nor agent_execution_id provided
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.artifact.v1.ArtifactList> listByExecution(
        ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByExecutionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a download URL for artifact content.
     * Returns a URL that the client can use to download the artifact's
     * content via HTTP GET. This avoids streaming large blobs through
     * the gRPC control plane.
     * Cloud: returns a pre-signed S3 URL with a short TTL (15 minutes).
     * OSS: returns a direct URL to the local artifact server endpoint.
     * Use Cases:
     * 1. Download Artifact:
     *    - User clicks "Download" in the execution viewer
     *    - UI calls getDownloadUrl() to get a URL
     *    - Browser opens the URL in a new tab or triggers a download
     * 2. Preview Artifact:
     *    - UI calls getDownloadUrl() for JSON/text artifacts
     *    - UI fetches content from the URL and renders inline
     *    - Large artifacts show a truncated preview with download option
     * 3. CLI Download:
     *    - `stigmer workflow artifact download art_abc123 -o output.json`
     *    - CLI calls getDownloadUrl() then fetches via HTTP GET
     * Error Cases:
     * - NOT_FOUND: No Artifact exists with the given ID
     * - PERMISSION_DENIED: User doesn't have view access to the parent execution
     * - FAILED_PRECONDITION: Artifact blob has been deleted (storage_state_deleted)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl> getDownloadUrl(
        ai.stigmer.agentic.artifact.v1.ArtifactId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_EXECUTION = 1;
  private static final int METHODID_GET_DOWNLOAD_URL = 2;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.agentic.artifact.v1.ArtifactId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact>) responseObserver);
          break;
        case METHODID_LIST_BY_EXECUTION:
          serviceImpl.listByExecution((ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactList>) responseObserver);
          break;
        case METHODID_GET_DOWNLOAD_URL:
          serviceImpl.getDownloadUrl((ai.stigmer.agentic.artifact.v1.ArtifactId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.artifact.v1.ArtifactId,
              ai.stigmer.agentic.artifact.v1.Artifact>(
                service, METHODID_GET)))
        .addMethod(
          getListByExecutionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.artifact.v1.ListArtifactsByExecutionRequest,
              ai.stigmer.agentic.artifact.v1.ArtifactList>(
                service, METHODID_LIST_BY_EXECUTION)))
        .addMethod(
          getGetDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.artifact.v1.ArtifactId,
              ai.stigmer.agentic.artifact.v1.ArtifactDownloadUrl>(
                service, METHODID_GET_DOWNLOAD_URL)))
        .build();
  }

  private static abstract class ArtifactQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ArtifactQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.artifact.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ArtifactQueryController");
    }
  }

  private static final class ArtifactQueryControllerFileDescriptorSupplier
      extends ArtifactQueryControllerBaseDescriptorSupplier {
    ArtifactQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ArtifactQueryControllerMethodDescriptorSupplier
      extends ArtifactQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ArtifactQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (ArtifactQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ArtifactQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByExecutionMethod())
              .addMethod(getGetDownloadUrlMethod())
              .build();
        }
      }
    }
    return result;
  }
}
