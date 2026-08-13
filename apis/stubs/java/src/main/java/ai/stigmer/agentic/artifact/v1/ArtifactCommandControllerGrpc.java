package ai.stigmer.agentic.artifact.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ArtifactCommandController handles write operations for Artifact resources.
 * &#64;internal
 * Follows the Command-Query Separation (CQS) pattern.
 * These RPCs are system-level — used by the runner (stigmer-runner)
 * to persist task outputs. They are NOT exposed to end users or the SDK.
 * Artifact creation flow:
 * 1. Runner detects output exceeding auto-promotion threshold (256KB)
 * 2. Runner calls create() with spec (metadata) + content (bytes)
 * 3. Backend hashes content, deduplicates, stores blob, creates record
 * 4. Runner receives Artifact with ID and status
 * 5. Runner replaces inline task output with artifact reference
 * 6. Runner includes artifact_created event in next updateStatus call
 * &#64;since T07 (Artifact Store)
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ArtifactCommandControllerGrpc {

  private ArtifactCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.artifact.v1.ArtifactCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.CreateArtifactInput,
      ai.stigmer.agentic.artifact.v1.Artifact> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.artifact.v1.CreateArtifactInput.class,
      responseType = ai.stigmer.agentic.artifact.v1.Artifact.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.CreateArtifactInput,
      ai.stigmer.agentic.artifact.v1.Artifact> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.artifact.v1.CreateArtifactInput, ai.stigmer.agentic.artifact.v1.Artifact> getCreateMethod;
    if ((getCreateMethod = ArtifactCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ArtifactCommandControllerGrpc.class) {
        if ((getCreateMethod = ArtifactCommandControllerGrpc.getCreateMethod) == null) {
          ArtifactCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.artifact.v1.CreateArtifactInput, ai.stigmer.agentic.artifact.v1.Artifact>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.CreateArtifactInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.Artifact.getDefaultInstance()))
              .setSchemaDescriptor(new ArtifactCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.artifact.v1.Artifact> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.artifact.v1.Artifact.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.artifact.v1.Artifact> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.artifact.v1.Artifact> getDeleteMethod;
    if ((getDeleteMethod = ArtifactCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ArtifactCommandControllerGrpc.class) {
        if ((getDeleteMethod = ArtifactCommandControllerGrpc.getDeleteMethod) == null) {
          ArtifactCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.artifact.v1.Artifact>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.artifact.v1.Artifact.getDefaultInstance()))
              .setSchemaDescriptor(new ArtifactCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ArtifactCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerStub>() {
        @java.lang.Override
        public ArtifactCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactCommandControllerStub(channel, callOptions);
        }
      };
    return ArtifactCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ArtifactCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ArtifactCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ArtifactCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ArtifactCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerBlockingStub>() {
        @java.lang.Override
        public ArtifactCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ArtifactCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ArtifactCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ArtifactCommandControllerFutureStub>() {
        @java.lang.Override
        public ArtifactCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ArtifactCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ArtifactCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a new artifact with content.
     * Persists the artifact's metadata and content blob. The backend:
     * 1. Computes SHA-256 hash of the content bytes
     * 2. Checks for existing blob with same hash (content-addressable dedup)
     * 3. If new: writes blob to storage (filesystem in OSS, S3 in Cloud)
     * 4. Creates Artifact metadata record with status populated
     * 5. Returns the created Artifact
     * &#64;internal
     * Authorization: skip_authorization (system-level RPC, called by runners)
     * The runner authenticates via service identity, not user credentials.
     * Idempotent by content hash: creating the same content twice returns
     * two distinct Artifact metadata records pointing to the same blob.
     * This is intentional — different tasks may independently produce the
     * same content, and each needs its own provenance trail.
     * Error Cases:
     * - INVALID_ARGUMENT: spec or content is missing/invalid
     * - RESOURCE_EXHAUSTED: content exceeds 50MB limit
     * - INTERNAL: blob storage write failure
     * </pre>
     */
    default void create(ai.stigmer.agentic.artifact.v1.CreateArtifactInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an artifact.
     * Marks the artifact for deletion. The backend transitions the storage
     * state to deleted and schedules the blob for garbage collection.
     * If other artifacts reference the same content hash, the blob is
     * retained until all references are deleted.
     * &#64;internal
     * Authorization: requires can_edit permission on the artifact.
     * Error Cases:
     * - NOT_FOUND: Artifact with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ArtifactCommandController.
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static abstract class ArtifactCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ArtifactCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ArtifactCommandController.
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ArtifactCommandControllerStub> {
    private ArtifactCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new artifact with content.
     * Persists the artifact's metadata and content blob. The backend:
     * 1. Computes SHA-256 hash of the content bytes
     * 2. Checks for existing blob with same hash (content-addressable dedup)
     * 3. If new: writes blob to storage (filesystem in OSS, S3 in Cloud)
     * 4. Creates Artifact metadata record with status populated
     * 5. Returns the created Artifact
     * &#64;internal
     * Authorization: skip_authorization (system-level RPC, called by runners)
     * The runner authenticates via service identity, not user credentials.
     * Idempotent by content hash: creating the same content twice returns
     * two distinct Artifact metadata records pointing to the same blob.
     * This is intentional — different tasks may independently produce the
     * same content, and each needs its own provenance trail.
     * Error Cases:
     * - INVALID_ARGUMENT: spec or content is missing/invalid
     * - RESOURCE_EXHAUSTED: content exceeds 50MB limit
     * - INTERNAL: blob storage write failure
     * </pre>
     */
    public void create(ai.stigmer.agentic.artifact.v1.CreateArtifactInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an artifact.
     * Marks the artifact for deletion. The backend transitions the storage
     * state to deleted and schedules the blob for garbage collection.
     * If other artifacts reference the same content hash, the blob is
     * retained until all references are deleted.
     * &#64;internal
     * Authorization: requires can_edit permission on the artifact.
     * Error Cases:
     * - NOT_FOUND: Artifact with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ArtifactCommandController.
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ArtifactCommandControllerBlockingV2Stub> {
    private ArtifactCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new artifact with content.
     * Persists the artifact's metadata and content blob. The backend:
     * 1. Computes SHA-256 hash of the content bytes
     * 2. Checks for existing blob with same hash (content-addressable dedup)
     * 3. If new: writes blob to storage (filesystem in OSS, S3 in Cloud)
     * 4. Creates Artifact metadata record with status populated
     * 5. Returns the created Artifact
     * &#64;internal
     * Authorization: skip_authorization (system-level RPC, called by runners)
     * The runner authenticates via service identity, not user credentials.
     * Idempotent by content hash: creating the same content twice returns
     * two distinct Artifact metadata records pointing to the same blob.
     * This is intentional — different tasks may independently produce the
     * same content, and each needs its own provenance trail.
     * Error Cases:
     * - INVALID_ARGUMENT: spec or content is missing/invalid
     * - RESOURCE_EXHAUSTED: content exceeds 50MB limit
     * - INTERNAL: blob storage write failure
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact create(ai.stigmer.agentic.artifact.v1.CreateArtifactInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an artifact.
     * Marks the artifact for deletion. The backend transitions the storage
     * state to deleted and schedules the blob for garbage collection.
     * If other artifacts reference the same content hash, the blob is
     * retained until all references are deleted.
     * &#64;internal
     * Authorization: requires can_edit permission on the artifact.
     * Error Cases:
     * - NOT_FOUND: Artifact with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ArtifactCommandController.
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ArtifactCommandControllerBlockingStub> {
    private ArtifactCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new artifact with content.
     * Persists the artifact's metadata and content blob. The backend:
     * 1. Computes SHA-256 hash of the content bytes
     * 2. Checks for existing blob with same hash (content-addressable dedup)
     * 3. If new: writes blob to storage (filesystem in OSS, S3 in Cloud)
     * 4. Creates Artifact metadata record with status populated
     * 5. Returns the created Artifact
     * &#64;internal
     * Authorization: skip_authorization (system-level RPC, called by runners)
     * The runner authenticates via service identity, not user credentials.
     * Idempotent by content hash: creating the same content twice returns
     * two distinct Artifact metadata records pointing to the same blob.
     * This is intentional — different tasks may independently produce the
     * same content, and each needs its own provenance trail.
     * Error Cases:
     * - INVALID_ARGUMENT: spec or content is missing/invalid
     * - RESOURCE_EXHAUSTED: content exceeds 50MB limit
     * - INTERNAL: blob storage write failure
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact create(ai.stigmer.agentic.artifact.v1.CreateArtifactInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an artifact.
     * Marks the artifact for deletion. The backend transitions the storage
     * state to deleted and schedules the blob for garbage collection.
     * If other artifacts reference the same content hash, the blob is
     * retained until all references are deleted.
     * &#64;internal
     * Authorization: requires can_edit permission on the artifact.
     * Error Cases:
     * - NOT_FOUND: Artifact with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * </pre>
     */
    public ai.stigmer.agentic.artifact.v1.Artifact delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ArtifactCommandController.
   * <pre>
   * ArtifactCommandController handles write operations for Artifact resources.
   * &#64;internal
   * Follows the Command-Query Separation (CQS) pattern.
   * These RPCs are system-level — used by the runner (stigmer-runner)
   * to persist task outputs. They are NOT exposed to end users or the SDK.
   * Artifact creation flow:
   * 1. Runner detects output exceeding auto-promotion threshold (256KB)
   * 2. Runner calls create() with spec (metadata) + content (bytes)
   * 3. Backend hashes content, deduplicates, stores blob, creates record
   * 4. Runner receives Artifact with ID and status
   * 5. Runner replaces inline task output with artifact reference
   * 6. Runner includes artifact_created event in next updateStatus call
   * &#64;since T07 (Artifact Store)
   * </pre>
   */
  public static final class ArtifactCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ArtifactCommandControllerFutureStub> {
    private ArtifactCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ArtifactCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ArtifactCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new artifact with content.
     * Persists the artifact's metadata and content blob. The backend:
     * 1. Computes SHA-256 hash of the content bytes
     * 2. Checks for existing blob with same hash (content-addressable dedup)
     * 3. If new: writes blob to storage (filesystem in OSS, S3 in Cloud)
     * 4. Creates Artifact metadata record with status populated
     * 5. Returns the created Artifact
     * &#64;internal
     * Authorization: skip_authorization (system-level RPC, called by runners)
     * The runner authenticates via service identity, not user credentials.
     * Idempotent by content hash: creating the same content twice returns
     * two distinct Artifact metadata records pointing to the same blob.
     * This is intentional — different tasks may independently produce the
     * same content, and each needs its own provenance trail.
     * Error Cases:
     * - INVALID_ARGUMENT: spec or content is missing/invalid
     * - RESOURCE_EXHAUSTED: content exceeds 50MB limit
     * - INTERNAL: blob storage write failure
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.artifact.v1.Artifact> create(
        ai.stigmer.agentic.artifact.v1.CreateArtifactInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an artifact.
     * Marks the artifact for deletion. The backend transitions the storage
     * state to deleted and schedules the blob for garbage collection.
     * If other artifacts reference the same content hash, the blob is
     * retained until all references are deleted.
     * &#64;internal
     * Authorization: requires can_edit permission on the artifact.
     * Error Cases:
     * - NOT_FOUND: Artifact with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.artifact.v1.Artifact> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_DELETE = 1;

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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.artifact.v1.CreateArtifactInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.artifact.v1.Artifact>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.artifact.v1.CreateArtifactInput,
              ai.stigmer.agentic.artifact.v1.Artifact>(
                service, METHODID_CREATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.artifact.v1.Artifact>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ArtifactCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ArtifactCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.artifact.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ArtifactCommandController");
    }
  }

  private static final class ArtifactCommandControllerFileDescriptorSupplier
      extends ArtifactCommandControllerBaseDescriptorSupplier {
    ArtifactCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ArtifactCommandControllerMethodDescriptorSupplier
      extends ArtifactCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ArtifactCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ArtifactCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ArtifactCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
