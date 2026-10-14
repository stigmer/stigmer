package ai.stigmer.agentic.evalrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvalRunQueryController handles read operations for eval runs.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvalRunQueryControllerGrpc {

  private EvalRunQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.evalrun.v1.EvalRunQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.evalrun.v1.EvalRunId.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun> getGetMethod;
    if ((getGetMethod = EvalRunQueryControllerGrpc.getGetMethod) == null) {
      synchronized (EvalRunQueryControllerGrpc.class) {
        if ((getGetMethod = EvalRunQueryControllerGrpc.getGetMethod) == null) {
          EvalRunQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRun.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest,
      ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAgent",
      requestType = ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest,
      ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest, ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByAgentMethod;
    if ((getListByAgentMethod = EvalRunQueryControllerGrpc.getListByAgentMethod) == null) {
      synchronized (EvalRunQueryControllerGrpc.class) {
        if ((getListByAgentMethod = EvalRunQueryControllerGrpc.getListByAgentMethod) == null) {
          EvalRunQueryControllerGrpc.getListByAgentMethod = getListByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest, ai.stigmer.agentic.evalrun.v1.EvalRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRunList.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunQueryControllerMethodDescriptorSupplier("listByAgent"))
              .build();
        }
      }
    }
    return getListByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest,
      ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByPluginMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByPlugin",
      requestType = ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest,
      ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByPluginMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest, ai.stigmer.agentic.evalrun.v1.EvalRunList> getListByPluginMethod;
    if ((getListByPluginMethod = EvalRunQueryControllerGrpc.getListByPluginMethod) == null) {
      synchronized (EvalRunQueryControllerGrpc.class) {
        if ((getListByPluginMethod = EvalRunQueryControllerGrpc.getListByPluginMethod) == null) {
          EvalRunQueryControllerGrpc.getListByPluginMethod = getListByPluginMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest, ai.stigmer.agentic.evalrun.v1.EvalRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByPlugin"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRunList.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunQueryControllerMethodDescriptorSupplier("listByPlugin"))
              .build();
        }
      }
    }
    return getListByPluginMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvalRunQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerStub>() {
        @java.lang.Override
        public EvalRunQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunQueryControllerStub(channel, callOptions);
        }
      };
    return EvalRunQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvalRunQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvalRunQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvalRunQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvalRunQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerBlockingStub>() {
        @java.lang.Override
        public EvalRunQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return EvalRunQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvalRunQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunQueryControllerFutureStub>() {
        @java.lang.Override
        public EvalRunQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunQueryControllerFutureStub(channel, callOptions);
        }
      };
    return EvalRunQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single eval run by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an agent's eval runs, newest first.
     * Each eval run comes with its scores, aggregates, per-target results
     * and notes, but with every arm's `tries` list empty, so a list stays
     * small however many tries its eval runs ran. Get an eval run by its id
     * for its tries.
     * </pre>
     */
    default void listByAgent(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List a plugin's eval runs, newest first: those about the plugin, on
     * the built-in assistant.
     * Each comes as listByAgent's entries do, with every arm's `tries` list
     * empty.
     * </pre>
     */
    default void listByPlugin(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByPluginMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvalRunQueryController.
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public static abstract class EvalRunQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvalRunQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvalRunQueryController.
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public static final class EvalRunQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvalRunQueryControllerStub> {
    private EvalRunQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval run by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an agent's eval runs, newest first.
     * Each eval run comes with its scores, aggregates, per-target results
     * and notes, but with every arm's `tries` list empty, so a list stays
     * small however many tries its eval runs ran. Get an eval run by its id
     * for its tries.
     * </pre>
     */
    public void listByAgent(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List a plugin's eval runs, newest first: those about the plugin, on
     * the built-in assistant.
     * Each comes as listByAgent's entries do, with every arm's `tries` list
     * empty.
     * </pre>
     */
    public void listByPlugin(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByPluginMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvalRunQueryController.
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public static final class EvalRunQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvalRunQueryControllerBlockingV2Stub> {
    private EvalRunQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun get(ai.stigmer.agentic.evalrun.v1.EvalRunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an agent's eval runs, newest first.
     * Each eval run comes with its scores, aggregates, per-target results
     * and notes, but with every arm's `tries` list empty, so a list stays
     * small however many tries its eval runs ran. Get an eval run by its id
     * for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRunList listByAgent(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a plugin's eval runs, newest first: those about the plugin, on
     * the built-in assistant.
     * Each comes as listByAgent's entries do, with every arm's `tries` list
     * empty.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRunList listByPlugin(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByPluginMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvalRunQueryController.
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public static final class EvalRunQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvalRunQueryControllerBlockingStub> {
    private EvalRunQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun get(ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an agent's eval runs, newest first.
     * Each eval run comes with its scores, aggregates, per-target results
     * and notes, but with every arm's `tries` list empty, so a list stays
     * small however many tries its eval runs ran. Get an eval run by its id
     * for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRunList listByAgent(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a plugin's eval runs, newest first: those about the plugin, on
     * the built-in assistant.
     * Each comes as listByAgent's entries do, with every arm's `tries` list
     * empty.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRunList listByPlugin(ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByPluginMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvalRunQueryController.
   * <pre>
   * EvalRunQueryController handles read operations for eval runs.
   * </pre>
   */
  public static final class EvalRunQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvalRunQueryControllerFutureStub> {
    private EvalRunQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval run by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRun> get(
        ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an agent's eval runs, newest first.
     * Each eval run comes with its scores, aggregates, per-target results
     * and notes, but with every arm's `tries` list empty, so a list stays
     * small however many tries its eval runs ran. Get an eval run by its id
     * for its tries.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRunList> listByAgent(
        ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List a plugin's eval runs, newest first: those about the plugin, on
     * the built-in assistant.
     * Each comes as listByAgent's entries do, with every arm's `tries` list
     * empty.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRunList> listByPlugin(
        ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByPluginMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_AGENT = 1;
  private static final int METHODID_LIST_BY_PLUGIN = 2;

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
          serviceImpl.get((ai.stigmer.agentic.evalrun.v1.EvalRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun>) responseObserver);
          break;
        case METHODID_LIST_BY_AGENT:
          serviceImpl.listByAgent((ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList>) responseObserver);
          break;
        case METHODID_LIST_BY_PLUGIN:
          serviceImpl.listByPlugin((ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRunList>) responseObserver);
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
              ai.stigmer.agentic.evalrun.v1.EvalRunId,
              ai.stigmer.agentic.evalrun.v1.EvalRun>(
                service, METHODID_GET)))
        .addMethod(
          getListByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evalrun.v1.ListEvalRunsByAgentRequest,
              ai.stigmer.agentic.evalrun.v1.EvalRunList>(
                service, METHODID_LIST_BY_AGENT)))
        .addMethod(
          getListByPluginMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evalrun.v1.ListEvalRunsByPluginRequest,
              ai.stigmer.agentic.evalrun.v1.EvalRunList>(
                service, METHODID_LIST_BY_PLUGIN)))
        .build();
  }

  private static abstract class EvalRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvalRunQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.evalrun.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvalRunQueryController");
    }
  }

  private static final class EvalRunQueryControllerFileDescriptorSupplier
      extends EvalRunQueryControllerBaseDescriptorSupplier {
    EvalRunQueryControllerFileDescriptorSupplier() {}
  }

  private static final class EvalRunQueryControllerMethodDescriptorSupplier
      extends EvalRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvalRunQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvalRunQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvalRunQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByAgentMethod())
              .addMethod(getListByPluginMethod())
              .build();
        }
      }
    }
    return result;
  }
}
