package ai.stigmer.agentic.scoringrule.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScoringRuleQueryController handles read operations for scoring rules.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScoringRuleQueryControllerGrpc {

  private ScoringRuleQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.scoringrule.v1.ScoringRuleQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.scoringrule.v1.ScoringRuleId.class,
      responseType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId, ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetMethod;
    if ((getGetMethod = ScoringRuleQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ScoringRuleQueryControllerGrpc.class) {
        if ((getGetMethod = ScoringRuleQueryControllerGrpc.getGetMethod) == null) {
          ScoringRuleQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.scoringrule.v1.ScoringRuleId, ai.stigmer.agentic.scoringrule.v1.ScoringRule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRuleId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setSchemaDescriptor(new ScoringRuleQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest.class,
      responseType = ai.stigmer.agentic.scoringrule.v1.ScoringRule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest,
      ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest, ai.stigmer.agentic.scoringrule.v1.ScoringRule> getGetByAgentMethod;
    if ((getGetByAgentMethod = ScoringRuleQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (ScoringRuleQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = ScoringRuleQueryControllerGrpc.getGetByAgentMethod) == null) {
          ScoringRuleQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest, ai.stigmer.agentic.scoringrule.v1.ScoringRule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.scoringrule.v1.ScoringRule.getDefaultInstance()))
              .setSchemaDescriptor(new ScoringRuleQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScoringRuleQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerStub>() {
        @java.lang.Override
        public ScoringRuleQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleQueryControllerStub(channel, callOptions);
        }
      };
    return ScoringRuleQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScoringRuleQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScoringRuleQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScoringRuleQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScoringRuleQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerBlockingStub>() {
        @java.lang.Override
        public ScoringRuleQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ScoringRuleQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScoringRuleQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoringRuleQueryControllerFutureStub>() {
        @java.lang.Override
        public ScoringRuleQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoringRuleQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ScoringRuleQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single scoring rule by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the scoring rule of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScoringRuleQueryController.
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public static abstract class ScoringRuleQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScoringRuleQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScoringRuleQueryController.
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScoringRuleQueryControllerStub> {
    private ScoringRuleQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single scoring rule by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the scoring rule of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScoringRuleQueryController.
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScoringRuleQueryControllerBlockingV2Stub> {
    private ScoringRuleQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single scoring rule by ID.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule get(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the scoring rule of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule getByAgent(ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScoringRuleQueryController.
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScoringRuleQueryControllerBlockingStub> {
    private ScoringRuleQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single scoring rule by ID.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule get(ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the scoring rule of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public ai.stigmer.agentic.scoringrule.v1.ScoringRule getByAgent(ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScoringRuleQueryController.
   * <pre>
   * ScoringRuleQueryController handles read operations for scoring rules.
   * </pre>
   */
  public static final class ScoringRuleQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScoringRuleQueryControllerFutureStub> {
    private ScoringRuleQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoringRuleQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoringRuleQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single scoring rule by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.scoringrule.v1.ScoringRule> get(
        ai.stigmer.agentic.scoringrule.v1.ScoringRuleId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the scoring rule of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.scoringrule.v1.ScoringRule> getByAgent(
        ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_AGENT = 1;

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
          serviceImpl.get((ai.stigmer.agentic.scoringrule.v1.ScoringRuleId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.scoringrule.v1.ScoringRule>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.scoringrule.v1.ScoringRuleId,
              ai.stigmer.agentic.scoringrule.v1.ScoringRule>(
                service, METHODID_GET)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.scoringrule.v1.GetScoringRuleByAgentRequest,
              ai.stigmer.agentic.scoringrule.v1.ScoringRule>(
                service, METHODID_GET_BY_AGENT)))
        .build();
  }

  private static abstract class ScoringRuleQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScoringRuleQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.scoringrule.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScoringRuleQueryController");
    }
  }

  private static final class ScoringRuleQueryControllerFileDescriptorSupplier
      extends ScoringRuleQueryControllerBaseDescriptorSupplier {
    ScoringRuleQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ScoringRuleQueryControllerMethodDescriptorSupplier
      extends ScoringRuleQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScoringRuleQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScoringRuleQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScoringRuleQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByAgentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
