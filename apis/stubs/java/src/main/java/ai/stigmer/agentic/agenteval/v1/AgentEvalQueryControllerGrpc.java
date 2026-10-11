package ai.stigmer.agentic.agenteval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentEvalQueryController handles read operations for agent evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentEvalQueryControllerGrpc {

  private AgentEvalQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agenteval.v1.AgentEvalQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agenteval.v1.AgentEvalId.class,
      responseType = ai.stigmer.agentic.agenteval.v1.AgentEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval> getGetMethod;
    if ((getGetMethod = AgentEvalQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentEvalQueryControllerGrpc.class) {
        if ((getGetMethod = AgentEvalQueryControllerGrpc.getGetMethod) == null) {
          AgentEvalQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEval.getDefaultInstance()))
              .setSchemaDescriptor(new AgentEvalQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest,
      ai.stigmer.agentic.agenteval.v1.AgentEvalList> getListByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAgent",
      requestType = ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest.class,
      responseType = ai.stigmer.agentic.agenteval.v1.AgentEvalList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest,
      ai.stigmer.agentic.agenteval.v1.AgentEvalList> getListByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest, ai.stigmer.agentic.agenteval.v1.AgentEvalList> getListByAgentMethod;
    if ((getListByAgentMethod = AgentEvalQueryControllerGrpc.getListByAgentMethod) == null) {
      synchronized (AgentEvalQueryControllerGrpc.class) {
        if ((getListByAgentMethod = AgentEvalQueryControllerGrpc.getListByAgentMethod) == null) {
          AgentEvalQueryControllerGrpc.getListByAgentMethod = getListByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest, ai.stigmer.agentic.agenteval.v1.AgentEvalList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEvalList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentEvalQueryControllerMethodDescriptorSupplier("listByAgent"))
              .build();
        }
      }
    }
    return getListByAgentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentEvalQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerStub>() {
        @java.lang.Override
        public AgentEvalQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalQueryControllerStub(channel, callOptions);
        }
      };
    return AgentEvalQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentEvalQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentEvalQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentEvalQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentEvalQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentEvalQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentEvalQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentEvalQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentEvalQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentEvalQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an agent's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    default void listByAgent(ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEvalList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAgentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentEvalQueryController.
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public static abstract class AgentEvalQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentEvalQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentEvalQueryController.
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentEvalQueryControllerStub> {
    private AgentEvalQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an agent's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public void listByAgent(ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEvalList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentEvalQueryController.
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentEvalQueryControllerBlockingV2Stub> {
    private AgentEvalQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval get(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an agent's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEvalList listByAgent(ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentEvalQueryController.
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentEvalQueryControllerBlockingStub> {
    private AgentEvalQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval get(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an agent's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEvalList listByAgent(ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentEvalQueryController.
   * <pre>
   * AgentEvalQueryController handles read operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentEvalQueryControllerFutureStub> {
    private AgentEvalQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agenteval.v1.AgentEval> get(
        ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an agent's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agenteval.v1.AgentEvalList> listByAgent(
        ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_AGENT = 1;

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
          serviceImpl.get((ai.stigmer.agentic.agenteval.v1.AgentEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval>) responseObserver);
          break;
        case METHODID_LIST_BY_AGENT:
          serviceImpl.listByAgent((ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEvalList>) responseObserver);
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
              ai.stigmer.agentic.agenteval.v1.AgentEvalId,
              ai.stigmer.agentic.agenteval.v1.AgentEval>(
                service, METHODID_GET)))
        .addMethod(
          getListByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agenteval.v1.ListAgentEvalsByAgentRequest,
              ai.stigmer.agentic.agenteval.v1.AgentEvalList>(
                service, METHODID_LIST_BY_AGENT)))
        .build();
  }

  private static abstract class AgentEvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentEvalQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agenteval.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentEvalQueryController");
    }
  }

  private static final class AgentEvalQueryControllerFileDescriptorSupplier
      extends AgentEvalQueryControllerBaseDescriptorSupplier {
    AgentEvalQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentEvalQueryControllerMethodDescriptorSupplier
      extends AgentEvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentEvalQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentEvalQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentEvalQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByAgentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
