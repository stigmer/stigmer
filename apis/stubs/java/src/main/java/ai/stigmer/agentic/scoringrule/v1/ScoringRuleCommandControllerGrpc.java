package ai.stigmer.agentic.scoringrule.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScoringRuleCommandController handles write operations for scoring rules.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScoringRuleCommandControllerGrpc {

  private ScoringRuleCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.scoringrule.v1.ScoringRuleCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRule,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      responseType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRule,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRule, ai.stigmer.agentic.scoringrule.v1.ScoringRule> getCreateMethod;
    if ((getCreateMethod = ScoringRuleCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ScoringRuleCommandControllerGrpc.class) {
        if ((getCreateMethod = ScoringRuleCommandControllerGrpc.getCreateMethod) == null) {
          ScoringRuleCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.scoringrule.v1.ScoringRule, ai.stigmer.agentic.scoringrule.v1.ScoringRule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setSchemaDescriptor(new ScoringRuleCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput.class,
      responseType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput, ai.stigmer.agentic.scoringrule.v1.ScoringRule> getUpdateMethod;
    if ((getUpdateMethod = ScoringRuleCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ScoringRuleCommandControllerGrpc.class) {
        if ((getUpdateMethod = ScoringRuleCommandControllerGrpc.getUpdateMethod) == null) {
          ScoringRuleCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput, ai.stigmer.agentic.scoringrule.v1.ScoringRule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setSchemaDescriptor(new ScoringRuleCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.scoringrule.v1.ScoringRuleId.class,
      responseType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId, ai.stigmer.agentic.scoringrule.v1.ScoringRule> getDeleteMethod;
    if ((getDeleteMethod = ScoringRuleCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ScoringRuleCommandControllerGrpc.class) {
        if ((getDeleteMethod = ScoringRuleCommandControllerGrpc.getDeleteMethod) == null) {
          ScoringRuleCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId, ai.stigmer.agentic.scoringrule.v1.ScoringRule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRuleId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setSchemaDescriptor(new ScoringRuleCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScoringRuleCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerStub>() {
        @java.lang.Override
        public ScoringRuleCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleCommandControllerStub(channel, callOptions);
        }
      };
    return ScoringRuleCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScoringRuleCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScoringRuleCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScoringRuleCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScoringRuleCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerBlockingStub>() {
        @java.lang.Override
        public ScoringRuleCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ScoringRuleCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScoringRuleCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleCommandControllerFutureStub>() {
        @java.lang.Override
        public ScoringRuleCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ScoringRuleCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create the scoring rule that switches AI grading on for an agent.
     * An agent has at most one scoring rule. The scoring rule lives in its agent's
     * organization.
     * </pre>
     */
    default void create(ai.stigmer.agentic.scoringrule.v1.ScoringRule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a scoring rule: the fields update_mask names change, every other
     * field keeps its stored value.
     * Its settings are whether it is enabled, its sample rate, its monthly
     * limit and its model. The agent it grades stays as created, and this
     * month's spend and counts are kept.
     * resource.metadata.id names the scoring rule; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the scoring rule does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the scoring rule changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the scoring rule kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a scoring rule, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScoringRuleCommandController.
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public static abstract class ScoringRuleCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScoringRuleCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScoringRuleCommandController.
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScoringRuleCommandControllerStub> {
    private ScoringRuleCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the scoring rule that switches AI grading on for an agent.
     * An agent has at most one scoring rule. The scoring rule lives in its agent's
     * organization.
     * </pre>
     */
    public void create(ai.stigmer.agentic.scoringrule.v1.ScoringRule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a scoring rule: the fields update_mask names change, every other
     * field keeps its stored value.
     * Its settings are whether it is enabled, its sample rate, its monthly
     * limit and its model. The agent it grades stays as created, and this
     * month's spend and counts are kept.
     * resource.metadata.id names the scoring rule; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the scoring rule does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the scoring rule changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the scoring rule kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a scoring rule, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScoringRuleCommandController.
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScoringRuleCommandControllerBlockingV2Stub> {
    private ScoringRuleCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the scoring rule that switches AI grading on for an agent.
     * An agent has at most one scoring rule. The scoring rule lives in its agent's
     * organization.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule create(ai.stigmer.agentic.scoringrule.v1.ScoringRule request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a scoring rule: the fields update_mask names change, every other
     * field keeps its stored value.
     * Its settings are whether it is enabled, its sample rate, its monthly
     * limit and its model. The agent it grades stays as created, and this
     * month's spend and counts are kept.
     * resource.metadata.id names the scoring rule; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the scoring rule does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the scoring rule changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the scoring rule kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule update(ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a scoring rule, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule delete(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScoringRuleCommandController.
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScoringRuleCommandControllerBlockingStub> {
    private ScoringRuleCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the scoring rule that switches AI grading on for an agent.
     * An agent has at most one scoring rule. The scoring rule lives in its agent's
     * organization.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule create(ai.stigmer.agentic.scoringrule.v1.ScoringRule request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a scoring rule: the fields update_mask names change, every other
     * field keeps its stored value.
     * Its settings are whether it is enabled, its sample rate, its monthly
     * limit and its model. The agent it grades stays as created, and this
     * month's spend and counts are kept.
     * resource.metadata.id names the scoring rule; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the scoring rule does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the scoring rule changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the scoring rule kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule update(ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a scoring rule, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule delete(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScoringRuleCommandController.
   * <pre>
   * ScoringRuleCommandController handles write operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScoringRuleCommandControllerFutureStub> {
    private ScoringRuleCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the scoring rule that switches AI grading on for an agent.
     * An agent has at most one scoring rule. The scoring rule lives in its agent's
     * organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.scoringrule.v1.ScoringRule> create(
        ai.stigmer.agentic.scoringrule.v1.ScoringRule request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a scoring rule: the fields update_mask names change, every other
     * field keeps its stored value.
     * Its settings are whether it is enabled, its sample rate, its monthly
     * limit and its model. The agent it grades stays as created, and this
     * month's spend and counts are kept.
     * resource.metadata.id names the scoring rule; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the scoring rule does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the scoring rule changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the scoring rule kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.scoringrule.v1.ScoringRule> update(
        ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a scoring rule, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.scoringrule.v1.ScoringRule> delete(
        ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_DELETE = 2;

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
          serviceImpl.create((ai.stigmer.agentic.scoringrule.v1.ScoringRule) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.scoringrule.v1.ScoringRuleId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule>) responseObserver);
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
              ai.stigmer.agentic.scoringrule.v1.ScoringRule,
              ai.stigmer.agentic.scoringrule.v1.ScoringRule>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.scoringrule.v1.UpdateScoringRuleInput,
              ai.stigmer.agentic.scoringrule.v1.ScoringRule>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
              ai.stigmer.agentic.scoringrule.v1.ScoringRule>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ScoringRuleCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScoringRuleCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.scoringrule.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScoringRuleCommandController");
    }
  }

  private static final class ScoringRuleCommandControllerFileDescriptorSupplier
      extends ScoringRuleCommandControllerBaseDescriptorSupplier {
    ScoringRuleCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ScoringRuleCommandControllerMethodDescriptorSupplier
      extends ScoringRuleCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScoringRuleCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScoringRuleCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScoringRuleCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
