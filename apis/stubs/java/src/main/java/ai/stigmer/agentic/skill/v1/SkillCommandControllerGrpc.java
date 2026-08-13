package ai.stigmer.agentic.skill.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SkillCommandController handles write operations for skills.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SkillCommandControllerGrpc {

  private SkillCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.skill.v1.SkillCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillRequest,
      ai.stigmer.agentic.skill.v1.Skill> getPushMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "push",
      requestType = ai.stigmer.agentic.skill.v1.PushSkillRequest.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillRequest,
      ai.stigmer.agentic.skill.v1.Skill> getPushMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillRequest, ai.stigmer.agentic.skill.v1.Skill> getPushMethod;
    if ((getPushMethod = SkillCommandControllerGrpc.getPushMethod) == null) {
      synchronized (SkillCommandControllerGrpc.class) {
        if ((getPushMethod = SkillCommandControllerGrpc.getPushMethod) == null) {
          SkillCommandControllerGrpc.getPushMethod = getPushMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.PushSkillRequest, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "push"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.PushSkillRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillCommandControllerMethodDescriptorSupplier("push"))
              .build();
        }
      }
    }
    return getPushMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest,
      ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> getCreateArtifactUploadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createArtifactUploadUrl",
      requestType = ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest.class,
      responseType = ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest,
      ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> getCreateArtifactUploadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest, ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> getCreateArtifactUploadUrlMethod;
    if ((getCreateArtifactUploadUrlMethod = SkillCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
      synchronized (SkillCommandControllerGrpc.class) {
        if ((getCreateArtifactUploadUrlMethod = SkillCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
          SkillCommandControllerGrpc.getCreateArtifactUploadUrlMethod = getCreateArtifactUploadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest, ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createArtifactUploadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new SkillCommandControllerMethodDescriptorSupplier("createArtifactUploadUrl"))
              .build();
        }
      }
    }
    return getCreateArtifactUploadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest,
      ai.stigmer.agentic.skill.v1.Skill> getPushFromExecutionArtifactMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pushFromExecutionArtifact",
      requestType = ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest,
      ai.stigmer.agentic.skill.v1.Skill> getPushFromExecutionArtifactMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest, ai.stigmer.agentic.skill.v1.Skill> getPushFromExecutionArtifactMethod;
    if ((getPushFromExecutionArtifactMethod = SkillCommandControllerGrpc.getPushFromExecutionArtifactMethod) == null) {
      synchronized (SkillCommandControllerGrpc.class) {
        if ((getPushFromExecutionArtifactMethod = SkillCommandControllerGrpc.getPushFromExecutionArtifactMethod) == null) {
          SkillCommandControllerGrpc.getPushFromExecutionArtifactMethod = getPushFromExecutionArtifactMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pushFromExecutionArtifact"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillCommandControllerMethodDescriptorSupplier("pushFromExecutionArtifact"))
              .build();
        }
      }
    }
    return getPushFromExecutionArtifactMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.skill.v1.Skill> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.skill.v1.Skill> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.skill.v1.Skill> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = SkillCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (SkillCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = SkillCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          SkillCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId,
      ai.stigmer.agentic.skill.v1.Skill> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.skill.v1.SkillId.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId,
      ai.stigmer.agentic.skill.v1.Skill> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId, ai.stigmer.agentic.skill.v1.Skill> getDeleteMethod;
    if ((getDeleteMethod = SkillCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (SkillCommandControllerGrpc.class) {
        if ((getDeleteMethod = SkillCommandControllerGrpc.getDeleteMethod) == null) {
          SkillCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.SkillId, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.SkillId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SkillCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerStub>() {
        @java.lang.Override
        public SkillCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillCommandControllerStub(channel, callOptions);
        }
      };
    return SkillCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SkillCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public SkillCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SkillCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SkillCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerBlockingStub>() {
        @java.lang.Override
        public SkillCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return SkillCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SkillCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillCommandControllerFutureStub>() {
        @java.lang.Override
        public SkillCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillCommandControllerFutureStub(channel, callOptions);
        }
      };
    return SkillCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Push a skill artifact.
     * Creates a skill if it does not exist, or creates a new version of an
     * existing skill. The artifact must contain a SKILL.md file.
     * &#64;internal
     * Authorization:
     * - Organization-scoped skills: Caller must have can_create_skill permission in the organization
     * - Platform-scoped skills: Caller must be a platform operator
     * The backend will:
     * 1. Normalize the name to a slug
     * 2. Find or create the skill resource
     * 3. Extract SKILL.md from the artifact
     * 4. Calculate SHA256 hash (version identifier)
     * 5. Store the artifact (deduplicated by hash)
     * 6. Update skill spec and status
     * 7. Archive the previous version (if updating)
     * </pre>
     */
    default void push(ai.stigmer.agentic.skill.v1.PushSkillRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPushMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a skill artifact
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushSkillRequest{ artifact_upload_ref }) — same pipeline,
     *    validation, and versioning as an inline push
     * The server refuses over-limit size_bytes here, before any bytes move.
     * &#64;internal
     * Authorization matches push() — the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it.
     * </pre>
     */
    default void createArtifactUploadUrl(ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateArtifactUploadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Push a skill from an execution artifact already in storage.
     * Use this when an agent execution has already produced a skill artifact
     * and you want to publish it without downloading and re-uploading the ZIP.
     * &#64;internal
     * Server-side equivalent of push() — reads the ZIP directly from artifact
     * storage instead of receiving bytes from the client. This eliminates
     * CORS concerns for SDK consumers.
     * Authorization:
     * - Requires can_view on the referenced execution (to read the artifact)
     * - Requires can_create_skill in the target organization (to push the skill)
     * </pre>
     */
    default void pushFromExecutionArtifact(ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPushFromExecutionArtifactMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing skill.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched. Use this to make a skill publicly accessible
     * or to revoke public access.
     * &#64;internal
     * Authorization: Requires can_edit permission on the skill resource.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a skill and all its versions.
     * &#64;internal
     * Removes the skill from the main collection but preserves audit history.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.skill.v1.SkillId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SkillCommandController.
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public static abstract class SkillCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SkillCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SkillCommandController.
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public static final class SkillCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SkillCommandControllerStub> {
    private SkillCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a skill artifact.
     * Creates a skill if it does not exist, or creates a new version of an
     * existing skill. The artifact must contain a SKILL.md file.
     * &#64;internal
     * Authorization:
     * - Organization-scoped skills: Caller must have can_create_skill permission in the organization
     * - Platform-scoped skills: Caller must be a platform operator
     * The backend will:
     * 1. Normalize the name to a slug
     * 2. Find or create the skill resource
     * 3. Extract SKILL.md from the artifact
     * 4. Calculate SHA256 hash (version identifier)
     * 5. Store the artifact (deduplicated by hash)
     * 6. Update skill spec and status
     * 7. Archive the previous version (if updating)
     * </pre>
     */
    public void push(ai.stigmer.agentic.skill.v1.PushSkillRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a skill artifact
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushSkillRequest{ artifact_upload_ref }) — same pipeline,
     *    validation, and versioning as an inline push
     * The server refuses over-limit size_bytes here, before any bytes move.
     * &#64;internal
     * Authorization matches push() — the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it.
     * </pre>
     */
    public void createArtifactUploadUrl(ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Push a skill from an execution artifact already in storage.
     * Use this when an agent execution has already produced a skill artifact
     * and you want to publish it without downloading and re-uploading the ZIP.
     * &#64;internal
     * Server-side equivalent of push() — reads the ZIP directly from artifact
     * storage instead of receiving bytes from the client. This eliminates
     * CORS concerns for SDK consumers.
     * Authorization:
     * - Requires can_view on the referenced execution (to read the artifact)
     * - Requires can_create_skill in the target organization (to push the skill)
     * </pre>
     */
    public void pushFromExecutionArtifact(ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPushFromExecutionArtifactMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing skill.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched. Use this to make a skill publicly accessible
     * or to revoke public access.
     * &#64;internal
     * Authorization: Requires can_edit permission on the skill resource.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a skill and all its versions.
     * &#64;internal
     * Removes the skill from the main collection but preserves audit history.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.skill.v1.SkillId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SkillCommandController.
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public static final class SkillCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SkillCommandControllerBlockingV2Stub> {
    private SkillCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a skill artifact.
     * Creates a skill if it does not exist, or creates a new version of an
     * existing skill. The artifact must contain a SKILL.md file.
     * &#64;internal
     * Authorization:
     * - Organization-scoped skills: Caller must have can_create_skill permission in the organization
     * - Platform-scoped skills: Caller must be a platform operator
     * The backend will:
     * 1. Normalize the name to a slug
     * 2. Find or create the skill resource
     * 3. Extract SKILL.md from the artifact
     * 4. Calculate SHA256 hash (version identifier)
     * 5. Store the artifact (deduplicated by hash)
     * 6. Update skill spec and status
     * 7. Archive the previous version (if updating)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill push(ai.stigmer.agentic.skill.v1.PushSkillRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a skill artifact
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushSkillRequest{ artifact_upload_ref }) — same pipeline,
     *    validation, and versioning as an inline push
     * The server refuses over-limit size_bytes here, before any bytes move.
     * &#64;internal
     * Authorization matches push() — the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Push a skill from an execution artifact already in storage.
     * Use this when an agent execution has already produced a skill artifact
     * and you want to publish it without downloading and re-uploading the ZIP.
     * &#64;internal
     * Server-side equivalent of push() — reads the ZIP directly from artifact
     * storage instead of receiving bytes from the client. This eliminates
     * CORS concerns for SDK consumers.
     * Authorization:
     * - Requires can_view on the referenced execution (to read the artifact)
     * - Requires can_create_skill in the target organization (to push the skill)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill pushFromExecutionArtifact(ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPushFromExecutionArtifactMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing skill.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched. Use this to make a skill publicly accessible
     * or to revoke public access.
     * &#64;internal
     * Authorization: Requires can_edit permission on the skill resource.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a skill and all its versions.
     * &#64;internal
     * Removes the skill from the main collection but preserves audit history.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill delete(ai.stigmer.agentic.skill.v1.SkillId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SkillCommandController.
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public static final class SkillCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SkillCommandControllerBlockingStub> {
    private SkillCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a skill artifact.
     * Creates a skill if it does not exist, or creates a new version of an
     * existing skill. The artifact must contain a SKILL.md file.
     * &#64;internal
     * Authorization:
     * - Organization-scoped skills: Caller must have can_create_skill permission in the organization
     * - Platform-scoped skills: Caller must be a platform operator
     * The backend will:
     * 1. Normalize the name to a slug
     * 2. Find or create the skill resource
     * 3. Extract SKILL.md from the artifact
     * 4. Calculate SHA256 hash (version identifier)
     * 5. Store the artifact (deduplicated by hash)
     * 6. Update skill spec and status
     * 7. Archive the previous version (if updating)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill push(ai.stigmer.agentic.skill.v1.PushSkillRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a skill artifact
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushSkillRequest{ artifact_upload_ref }) — same pipeline,
     *    validation, and versioning as an inline push
     * The server refuses over-limit size_bytes here, before any bytes move.
     * &#64;internal
     * Authorization matches push() — the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Push a skill from an execution artifact already in storage.
     * Use this when an agent execution has already produced a skill artifact
     * and you want to publish it without downloading and re-uploading the ZIP.
     * &#64;internal
     * Server-side equivalent of push() — reads the ZIP directly from artifact
     * storage instead of receiving bytes from the client. This eliminates
     * CORS concerns for SDK consumers.
     * Authorization:
     * - Requires can_view on the referenced execution (to read the artifact)
     * - Requires can_create_skill in the target organization (to push the skill)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill pushFromExecutionArtifact(ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPushFromExecutionArtifactMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing skill.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched. Use this to make a skill publicly accessible
     * or to revoke public access.
     * &#64;internal
     * Authorization: Requires can_edit permission on the skill resource.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a skill and all its versions.
     * &#64;internal
     * Removes the skill from the main collection but preserves audit history.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill delete(ai.stigmer.agentic.skill.v1.SkillId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SkillCommandController.
   * <pre>
   * SkillCommandController handles write operations for skills.
   * </pre>
   */
  public static final class SkillCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SkillCommandControllerFutureStub> {
    private SkillCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a skill artifact.
     * Creates a skill if it does not exist, or creates a new version of an
     * existing skill. The artifact must contain a SKILL.md file.
     * &#64;internal
     * Authorization:
     * - Organization-scoped skills: Caller must have can_create_skill permission in the organization
     * - Platform-scoped skills: Caller must be a platform operator
     * The backend will:
     * 1. Normalize the name to a slug
     * 2. Find or create the skill resource
     * 3. Extract SKILL.md from the artifact
     * 4. Calculate SHA256 hash (version identifier)
     * 5. Store the artifact (deduplicated by hash)
     * 6. Update skill spec and status
     * 7. Archive the previous version (if updating)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> push(
        ai.stigmer.agentic.skill.v1.PushSkillRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a skill artifact
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushSkillRequest{ artifact_upload_ref }) — same pipeline,
     *    validation, and versioning as an inline push
     * The server refuses over-limit size_bytes here, before any bytes move.
     * &#64;internal
     * Authorization matches push() — the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl> createArtifactUploadUrl(
        ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Push a skill from an execution artifact already in storage.
     * Use this when an agent execution has already produced a skill artifact
     * and you want to publish it without downloading and re-uploading the ZIP.
     * &#64;internal
     * Server-side equivalent of push() — reads the ZIP directly from artifact
     * storage instead of receiving bytes from the client. This eliminates
     * CORS concerns for SDK consumers.
     * Authorization:
     * - Requires can_view on the referenced execution (to read the artifact)
     * - Requires can_create_skill in the target organization (to push the skill)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> pushFromExecutionArtifact(
        ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPushFromExecutionArtifactMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing skill.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched. Use this to make a skill publicly accessible
     * or to revoke public access.
     * &#64;internal
     * Authorization: Requires can_edit permission on the skill resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a skill and all its versions.
     * &#64;internal
     * Removes the skill from the main collection but preserves audit history.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> delete(
        ai.stigmer.agentic.skill.v1.SkillId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_PUSH = 0;
  private static final int METHODID_CREATE_ARTIFACT_UPLOAD_URL = 1;
  private static final int METHODID_PUSH_FROM_EXECUTION_ARTIFACT = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_DELETE = 4;

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
        case METHODID_PUSH:
          serviceImpl.push((ai.stigmer.agentic.skill.v1.PushSkillRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
          break;
        case METHODID_CREATE_ARTIFACT_UPLOAD_URL:
          serviceImpl.createArtifactUploadUrl((ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl>) responseObserver);
          break;
        case METHODID_PUSH_FROM_EXECUTION_ARTIFACT:
          serviceImpl.pushFromExecutionArtifact((ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.skill.v1.SkillId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
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
          getPushMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.PushSkillRequest,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_PUSH)))
        .addMethod(
          getCreateArtifactUploadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest,
              ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl>(
                service, METHODID_CREATE_ARTIFACT_UPLOAD_URL)))
        .addMethod(
          getPushFromExecutionArtifactMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.PushSkillFromExecutionArtifactRequest,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_PUSH_FROM_EXECUTION_ARTIFACT)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.SkillId,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class SkillCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SkillCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.skill.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SkillCommandController");
    }
  }

  private static final class SkillCommandControllerFileDescriptorSupplier
      extends SkillCommandControllerBaseDescriptorSupplier {
    SkillCommandControllerFileDescriptorSupplier() {}
  }

  private static final class SkillCommandControllerMethodDescriptorSupplier
      extends SkillCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SkillCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SkillCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SkillCommandControllerFileDescriptorSupplier())
              .addMethod(getPushMethod())
              .addMethod(getCreateArtifactUploadUrlMethod())
              .addMethod(getPushFromExecutionArtifactMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
