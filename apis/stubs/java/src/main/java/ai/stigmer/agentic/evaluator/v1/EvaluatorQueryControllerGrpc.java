package ai.stigmer.agentic.evaluator.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvaluatorQueryController handles read operations for evaluators.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvaluatorQueryControllerGrpc {

  private EvaluatorQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.evaluator.v1.EvaluatorQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.evaluator.v1.EvaluatorId.class,
      responseType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId, ai.stigmer.agentic.evaluator.v1.Evaluator> getGetMethod;
    if ((getGetMethod = EvaluatorQueryControllerGrpc.getGetMethod) == null) {
      synchronized (EvaluatorQueryControllerGrpc.class) {
        if ((getGetMethod = EvaluatorQueryControllerGrpc.getGetMethod) == null) {
          EvaluatorQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evaluator.v1.EvaluatorId, ai.stigmer.agentic.evaluator.v1.Evaluator>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.EvaluatorId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setSchemaDescriptor(new EvaluatorQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest.class,
      responseType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest, ai.stigmer.agentic.evaluator.v1.Evaluator> getGetByAgentMethod;
    if ((getGetByAgentMethod = EvaluatorQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (EvaluatorQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = EvaluatorQueryControllerGrpc.getGetByAgentMethod) == null) {
          EvaluatorQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest, ai.stigmer.agentic.evaluator.v1.Evaluator>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setSchemaDescriptor(new EvaluatorQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvaluatorQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerStub>() {
        @java.lang.Override
        public EvaluatorQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorQueryControllerStub(channel, callOptions);
        }
      };
    return EvaluatorQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvaluatorQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvaluatorQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvaluatorQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvaluatorQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerBlockingStub>() {
        @java.lang.Override
        public EvaluatorQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return EvaluatorQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvaluatorQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorQueryControllerFutureStub>() {
        @java.lang.Override
        public EvaluatorQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorQueryControllerFutureStub(channel, callOptions);
        }
      };
    return EvaluatorQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single evaluator by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.evaluator.v1.EvaluatorId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the evaluator of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvaluatorQueryController.
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public static abstract class EvaluatorQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvaluatorQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvaluatorQueryController.
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvaluatorQueryControllerStub> {
    private EvaluatorQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single evaluator by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.evaluator.v1.EvaluatorId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the evaluator of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvaluatorQueryController.
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvaluatorQueryControllerBlockingV2Stub> {
    private EvaluatorQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single evaluator by ID.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator get(ai.stigmer.agentic.evaluator.v1.EvaluatorId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the evaluator of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator getByAgent(ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvaluatorQueryController.
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvaluatorQueryControllerBlockingStub> {
    private EvaluatorQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single evaluator by ID.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator get(ai.stigmer.agentic.evaluator.v1.EvaluatorId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the evaluator of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator getByAgent(ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvaluatorQueryController.
   * <pre>
   * EvaluatorQueryController handles read operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvaluatorQueryControllerFutureStub> {
    private EvaluatorQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single evaluator by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evaluator.v1.Evaluator> get(
        ai.stigmer.agentic.evaluator.v1.EvaluatorId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the evaluator of an agent.
     * Returns NOT_FOUND when the agent has none, which means AI grading is
     * off for it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evaluator.v1.Evaluator> getByAgent(
        ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest request) {
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
          serviceImpl.get((ai.stigmer.agentic.evaluator.v1.EvaluatorId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator>) responseObserver);
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
              ai.stigmer.agentic.evaluator.v1.EvaluatorId,
              ai.stigmer.agentic.evaluator.v1.Evaluator>(
                service, METHODID_GET)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evaluator.v1.GetEvaluatorByAgentRequest,
              ai.stigmer.agentic.evaluator.v1.Evaluator>(
                service, METHODID_GET_BY_AGENT)))
        .build();
  }

  private static abstract class EvaluatorQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvaluatorQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.evaluator.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvaluatorQueryController");
    }
  }

  private static final class EvaluatorQueryControllerFileDescriptorSupplier
      extends EvaluatorQueryControllerBaseDescriptorSupplier {
    EvaluatorQueryControllerFileDescriptorSupplier() {}
  }

  private static final class EvaluatorQueryControllerMethodDescriptorSupplier
      extends EvaluatorQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvaluatorQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvaluatorQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvaluatorQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByAgentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
