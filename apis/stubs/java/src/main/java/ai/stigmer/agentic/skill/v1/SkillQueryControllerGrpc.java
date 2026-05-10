package ai.stigmer.agentic.skill.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SkillQueryController handles read operations for skills.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SkillQueryControllerGrpc {

  private SkillQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.skill.v1.SkillQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId,
      ai.stigmer.agentic.skill.v1.Skill> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.skill.v1.SkillId.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId,
      ai.stigmer.agentic.skill.v1.Skill> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.SkillId, ai.stigmer.agentic.skill.v1.Skill> getGetMethod;
    if ((getGetMethod = SkillQueryControllerGrpc.getGetMethod) == null) {
      synchronized (SkillQueryControllerGrpc.class) {
        if ((getGetMethod = SkillQueryControllerGrpc.getGetMethod) == null) {
          SkillQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.SkillId, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.SkillId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.skill.v1.Skill> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.skill.v1.Skill.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.skill.v1.Skill> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.skill.v1.Skill> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = SkillQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (SkillQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = SkillQueryControllerGrpc.getGetByReferenceMethod) == null) {
          SkillQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.skill.v1.Skill>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.Skill.getDefaultInstance()))
              .setSchemaDescriptor(new SkillQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.GetArtifactRequest,
      ai.stigmer.agentic.skill.v1.GetArtifactResponse> getGetArtifactMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifact",
      requestType = ai.stigmer.agentic.skill.v1.GetArtifactRequest.class,
      responseType = ai.stigmer.agentic.skill.v1.GetArtifactResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.GetArtifactRequest,
      ai.stigmer.agentic.skill.v1.GetArtifactResponse> getGetArtifactMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.GetArtifactRequest, ai.stigmer.agentic.skill.v1.GetArtifactResponse> getGetArtifactMethod;
    if ((getGetArtifactMethod = SkillQueryControllerGrpc.getGetArtifactMethod) == null) {
      synchronized (SkillQueryControllerGrpc.class) {
        if ((getGetArtifactMethod = SkillQueryControllerGrpc.getGetArtifactMethod) == null) {
          SkillQueryControllerGrpc.getGetArtifactMethod = getGetArtifactMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.GetArtifactRequest, ai.stigmer.agentic.skill.v1.GetArtifactResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifact"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.GetArtifactRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.GetArtifactResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SkillQueryControllerMethodDescriptorSupplier("getArtifact"))
              .build();
        }
      }
    }
    return getGetArtifactMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.ListSkillVersionsInput,
      ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> getListVersionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listVersions",
      requestType = ai.stigmer.agentic.skill.v1.ListSkillVersionsInput.class,
      responseType = ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.ListSkillVersionsInput,
      ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> getListVersionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.skill.v1.ListSkillVersionsInput, ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> getListVersionsMethod;
    if ((getListVersionsMethod = SkillQueryControllerGrpc.getListVersionsMethod) == null) {
      synchronized (SkillQueryControllerGrpc.class) {
        if ((getListVersionsMethod = SkillQueryControllerGrpc.getListVersionsMethod) == null) {
          SkillQueryControllerGrpc.getListVersionsMethod = getListVersionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.skill.v1.ListSkillVersionsInput, ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listVersions"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.ListSkillVersionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SkillQueryControllerMethodDescriptorSupplier("listVersions"))
              .build();
        }
      }
    }
    return getListVersionsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SkillQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerStub>() {
        @java.lang.Override
        public SkillQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillQueryControllerStub(channel, callOptions);
        }
      };
    return SkillQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SkillQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public SkillQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SkillQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SkillQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerBlockingStub>() {
        @java.lang.Override
        public SkillQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return SkillQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SkillQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SkillQueryControllerFutureStub>() {
        @java.lang.Override
        public SkillQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SkillQueryControllerFutureStub(channel, callOptions);
        }
      };
    return SkillQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single skill by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.skill.v1.SkillId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a skill by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to a skill ID.
     * (Input doesn't contain skill ID, so proto-level auth cannot work)
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Download skill artifact from storage by its storage key.
     * Returns the ZIP file containing SKILL.md and implementation files.
     * &#64;internal
     * Used by the agent-runner to download and extract skill artifacts into the
     * sandbox at /bin/skills/{version_hash}/. Authorization is skipped as the
     * storage key itself acts as a capability token.
     * </pre>
     */
    default void getArtifact(ai.stigmer.agentic.skill.v1.GetArtifactRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.GetArtifactResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactMethod(), responseObserver);
    }

    /**
     * <pre>
     * List version history for a skill.
     * Returns all historical versions ordered by push time (newest first).
     * Each entry includes the version hash, push timestamp, actor, tag,
     * git provenance, and artifact storage key for historical artifact access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the skill.
     * (Input uses org+slug, not skill ID, so proto-level auth cannot work)
     * </pre>
     */
    default void listVersions(ai.stigmer.agentic.skill.v1.ListSkillVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListVersionsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SkillQueryController.
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public static abstract class SkillQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SkillQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SkillQueryController.
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public static final class SkillQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SkillQueryControllerStub> {
    private SkillQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single skill by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.skill.v1.SkillId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a skill by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to a skill ID.
     * (Input doesn't contain skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Download skill artifact from storage by its storage key.
     * Returns the ZIP file containing SKILL.md and implementation files.
     * &#64;internal
     * Used by the agent-runner to download and extract skill artifacts into the
     * sandbox at /bin/skills/{version_hash}/. Authorization is skipped as the
     * storage key itself acts as a capability token.
     * </pre>
     */
    public void getArtifact(ai.stigmer.agentic.skill.v1.GetArtifactRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.GetArtifactResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List version history for a skill.
     * Returns all historical versions ordered by push time (newest first).
     * Each entry includes the version hash, push timestamp, actor, tag,
     * git provenance, and artifact storage key for historical artifact access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the skill.
     * (Input uses org+slug, not skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public void listVersions(ai.stigmer.agentic.skill.v1.ListSkillVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SkillQueryController.
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public static final class SkillQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SkillQueryControllerBlockingV2Stub> {
    private SkillQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single skill by ID.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill get(ai.stigmer.agentic.skill.v1.SkillId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a skill by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to a skill ID.
     * (Input doesn't contain skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Download skill artifact from storage by its storage key.
     * Returns the ZIP file containing SKILL.md and implementation files.
     * &#64;internal
     * Used by the agent-runner to download and extract skill artifacts into the
     * sandbox at /bin/skills/{version_hash}/. Authorization is skipped as the
     * storage key itself acts as a capability token.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.GetArtifactResponse getArtifact(ai.stigmer.agentic.skill.v1.GetArtifactRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a skill.
     * Returns all historical versions ordered by push time (newest first).
     * Each entry includes the version hash, push timestamp, actor, tag,
     * git provenance, and artifact storage key for historical artifact access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the skill.
     * (Input uses org+slug, not skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse listVersions(ai.stigmer.agentic.skill.v1.ListSkillVersionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SkillQueryController.
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public static final class SkillQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SkillQueryControllerBlockingStub> {
    private SkillQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single skill by ID.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill get(ai.stigmer.agentic.skill.v1.SkillId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a skill by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to a skill ID.
     * (Input doesn't contain skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.Skill getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Download skill artifact from storage by its storage key.
     * Returns the ZIP file containing SKILL.md and implementation files.
     * &#64;internal
     * Used by the agent-runner to download and extract skill artifacts into the
     * sandbox at /bin/skills/{version_hash}/. Authorization is skipped as the
     * storage key itself acts as a capability token.
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.GetArtifactResponse getArtifact(ai.stigmer.agentic.skill.v1.GetArtifactRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a skill.
     * Returns all historical versions ordered by push time (newest first).
     * Each entry includes the version hash, push timestamp, actor, tag,
     * git provenance, and artifact storage key for historical artifact access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the skill.
     * (Input uses org+slug, not skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse listVersions(ai.stigmer.agentic.skill.v1.ListSkillVersionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SkillQueryController.
   * <pre>
   * SkillQueryController handles read operations for skills.
   * </pre>
   */
  public static final class SkillQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SkillQueryControllerFutureStub> {
    private SkillQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SkillQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SkillQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single skill by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> get(
        ai.stigmer.agentic.skill.v1.SkillId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a skill by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to a skill ID.
     * (Input doesn't contain skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.Skill> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Download skill artifact from storage by its storage key.
     * Returns the ZIP file containing SKILL.md and implementation files.
     * &#64;internal
     * Used by the agent-runner to download and extract skill artifacts into the
     * sandbox at /bin/skills/{version_hash}/. Authorization is skipped as the
     * storage key itself acts as a capability token.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.GetArtifactResponse> getArtifact(
        ai.stigmer.agentic.skill.v1.GetArtifactRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List version history for a skill.
     * Returns all historical versions ordered by push time (newest first).
     * Each entry includes the version hash, push timestamp, actor, tag,
     * git provenance, and artifact storage key for historical artifact access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the skill.
     * (Input uses org+slug, not skill ID, so proto-level auth cannot work)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse> listVersions(
        ai.stigmer.agentic.skill.v1.ListSkillVersionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_ARTIFACT = 2;
  private static final int METHODID_LIST_VERSIONS = 3;

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
          serviceImpl.get((ai.stigmer.agentic.skill.v1.SkillId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.Skill>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT:
          serviceImpl.getArtifact((ai.stigmer.agentic.skill.v1.GetArtifactRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.GetArtifactResponse>) responseObserver);
          break;
        case METHODID_LIST_VERSIONS:
          serviceImpl.listVersions((ai.stigmer.agentic.skill.v1.ListSkillVersionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse>) responseObserver);
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
              ai.stigmer.agentic.skill.v1.SkillId,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.skill.v1.Skill>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetArtifactMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.GetArtifactRequest,
              ai.stigmer.agentic.skill.v1.GetArtifactResponse>(
                service, METHODID_GET_ARTIFACT)))
        .addMethod(
          getListVersionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.skill.v1.ListSkillVersionsInput,
              ai.stigmer.agentic.skill.v1.ListSkillVersionsResponse>(
                service, METHODID_LIST_VERSIONS)))
        .build();
  }

  private static abstract class SkillQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SkillQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.skill.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SkillQueryController");
    }
  }

  private static final class SkillQueryControllerFileDescriptorSupplier
      extends SkillQueryControllerBaseDescriptorSupplier {
    SkillQueryControllerFileDescriptorSupplier() {}
  }

  private static final class SkillQueryControllerMethodDescriptorSupplier
      extends SkillQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SkillQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SkillQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SkillQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetArtifactMethod())
              .addMethod(getListVersionsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
