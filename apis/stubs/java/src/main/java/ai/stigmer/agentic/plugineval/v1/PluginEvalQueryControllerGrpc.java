package ai.stigmer.agentic.plugineval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PluginEvalQueryController handles read operations for plugin evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PluginEvalQueryControllerGrpc {

  private PluginEvalQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.plugineval.v1.PluginEvalQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.plugineval.v1.PluginEvalId.class,
      responseType = ai.stigmer.agentic.plugineval.v1.PluginEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval> getGetMethod;
    if ((getGetMethod = PluginEvalQueryControllerGrpc.getGetMethod) == null) {
      synchronized (PluginEvalQueryControllerGrpc.class) {
        if ((getGetMethod = PluginEvalQueryControllerGrpc.getGetMethod) == null) {
          PluginEvalQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEval.getDefaultInstance()))
              .setSchemaDescriptor(new PluginEvalQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest,
      ai.stigmer.agentic.plugineval.v1.PluginEvalList> getListByPluginMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByPlugin",
      requestType = ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest.class,
      responseType = ai.stigmer.agentic.plugineval.v1.PluginEvalList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest,
      ai.stigmer.agentic.plugineval.v1.PluginEvalList> getListByPluginMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest, ai.stigmer.agentic.plugineval.v1.PluginEvalList> getListByPluginMethod;
    if ((getListByPluginMethod = PluginEvalQueryControllerGrpc.getListByPluginMethod) == null) {
      synchronized (PluginEvalQueryControllerGrpc.class) {
        if ((getListByPluginMethod = PluginEvalQueryControllerGrpc.getListByPluginMethod) == null) {
          PluginEvalQueryControllerGrpc.getListByPluginMethod = getListByPluginMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest, ai.stigmer.agentic.plugineval.v1.PluginEvalList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByPlugin"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEvalList.getDefaultInstance()))
              .setSchemaDescriptor(new PluginEvalQueryControllerMethodDescriptorSupplier("listByPlugin"))
              .build();
        }
      }
    }
    return getListByPluginMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PluginEvalQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerStub>() {
        @java.lang.Override
        public PluginEvalQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalQueryControllerStub(channel, callOptions);
        }
      };
    return PluginEvalQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PluginEvalQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public PluginEvalQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PluginEvalQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PluginEvalQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerBlockingStub>() {
        @java.lang.Override
        public PluginEvalQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return PluginEvalQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PluginEvalQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalQueryControllerFutureStub>() {
        @java.lang.Override
        public PluginEvalQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalQueryControllerFutureStub(channel, callOptions);
        }
      };
    return PluginEvalQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List a plugin's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    default void listByPlugin(ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEvalList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByPluginMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PluginEvalQueryController.
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public static abstract class PluginEvalQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PluginEvalQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PluginEvalQueryController.
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PluginEvalQueryControllerStub> {
    private PluginEvalQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List a plugin's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public void listByPlugin(ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEvalList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByPluginMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PluginEvalQueryController.
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PluginEvalQueryControllerBlockingV2Stub> {
    private PluginEvalQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval get(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a plugin's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEvalList listByPlugin(ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByPluginMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PluginEvalQueryController.
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PluginEvalQueryControllerBlockingStub> {
    private PluginEvalQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval get(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a plugin's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEvalList listByPlugin(ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByPluginMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PluginEvalQueryController.
   * <pre>
   * PluginEvalQueryController handles read operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PluginEvalQueryControllerFutureStub> {
    private PluginEvalQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugineval.v1.PluginEval> get(
        ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List a plugin's evals, newest first.
     * Each eval comes with its scores, aggregates, per-target results and
     * notes, but with every arm's `tries` list empty, so a list stays small
     * however many tries its evals ran. Get an eval by its id for its tries.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugineval.v1.PluginEvalList> listByPlugin(
        ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByPluginMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_PLUGIN = 1;

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
          serviceImpl.get((ai.stigmer.agentic.plugineval.v1.PluginEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval>) responseObserver);
          break;
        case METHODID_LIST_BY_PLUGIN:
          serviceImpl.listByPlugin((ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEvalList>) responseObserver);
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
              ai.stigmer.agentic.plugineval.v1.PluginEvalId,
              ai.stigmer.agentic.plugineval.v1.PluginEval>(
                service, METHODID_GET)))
        .addMethod(
          getListByPluginMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugineval.v1.ListPluginEvalsByPluginRequest,
              ai.stigmer.agentic.plugineval.v1.PluginEvalList>(
                service, METHODID_LIST_BY_PLUGIN)))
        .build();
  }

  private static abstract class PluginEvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PluginEvalQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.plugineval.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PluginEvalQueryController");
    }
  }

  private static final class PluginEvalQueryControllerFileDescriptorSupplier
      extends PluginEvalQueryControllerBaseDescriptorSupplier {
    PluginEvalQueryControllerFileDescriptorSupplier() {}
  }

  private static final class PluginEvalQueryControllerMethodDescriptorSupplier
      extends PluginEvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PluginEvalQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PluginEvalQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PluginEvalQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByPluginMethod())
              .build();
        }
      }
    }
    return result;
  }
}
