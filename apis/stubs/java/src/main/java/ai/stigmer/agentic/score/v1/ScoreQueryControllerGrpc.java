package ai.stigmer.agentic.score.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScoreQueryController handles read operations for scores.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScoreQueryControllerGrpc {

  private ScoreQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.score.v1.ScoreQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId,
      ai.stigmer.agentic.score.v1.Score> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.score.v1.ScoreId.class,
      responseType = ai.stigmer.agentic.score.v1.Score.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId,
      ai.stigmer.agentic.score.v1.Score> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId, ai.stigmer.agentic.score.v1.Score> getGetMethod;
    if ((getGetMethod = ScoreQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ScoreQueryControllerGrpc.class) {
        if ((getGetMethod = ScoreQueryControllerGrpc.getGetMethod) == null) {
          ScoreQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.ScoreId, ai.stigmer.agentic.score.v1.Score>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ScoreId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresByRunRequest,
      ai.stigmer.agentic.score.v1.ScoreList> getListByRunMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByRun",
      requestType = ai.stigmer.agentic.score.v1.ListScoresByRunRequest.class,
      responseType = ai.stigmer.agentic.score.v1.ScoreList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresByRunRequest,
      ai.stigmer.agentic.score.v1.ScoreList> getListByRunMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresByRunRequest, ai.stigmer.agentic.score.v1.ScoreList> getListByRunMethod;
    if ((getListByRunMethod = ScoreQueryControllerGrpc.getListByRunMethod) == null) {
      synchronized (ScoreQueryControllerGrpc.class) {
        if ((getListByRunMethod = ScoreQueryControllerGrpc.getListByRunMethod) == null) {
          ScoreQueryControllerGrpc.getListByRunMethod = getListByRunMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.ListScoresByRunRequest, ai.stigmer.agentic.score.v1.ScoreList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByRun"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ListScoresByRunRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ScoreList.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreQueryControllerMethodDescriptorSupplier("listByRun"))
              .build();
        }
      }
    }
    return getListByRunMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresBySessionRequest,
      ai.stigmer.agentic.score.v1.ScoreList> getListBySessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listBySession",
      requestType = ai.stigmer.agentic.score.v1.ListScoresBySessionRequest.class,
      responseType = ai.stigmer.agentic.score.v1.ScoreList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresBySessionRequest,
      ai.stigmer.agentic.score.v1.ScoreList> getListBySessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ListScoresBySessionRequest, ai.stigmer.agentic.score.v1.ScoreList> getListBySessionMethod;
    if ((getListBySessionMethod = ScoreQueryControllerGrpc.getListBySessionMethod) == null) {
      synchronized (ScoreQueryControllerGrpc.class) {
        if ((getListBySessionMethod = ScoreQueryControllerGrpc.getListBySessionMethod) == null) {
          ScoreQueryControllerGrpc.getListBySessionMethod = getListBySessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.ListScoresBySessionRequest, ai.stigmer.agentic.score.v1.ScoreList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listBySession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ListScoresBySessionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ScoreList.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreQueryControllerMethodDescriptorSupplier("listBySession"))
              .build();
        }
      }
    }
    return getListBySessionMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScoreQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerStub>() {
        @java.lang.Override
        public ScoreQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreQueryControllerStub(channel, callOptions);
        }
      };
    return ScoreQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScoreQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScoreQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScoreQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScoreQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerBlockingStub>() {
        @java.lang.Override
        public ScoreQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ScoreQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScoreQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreQueryControllerFutureStub>() {
        @java.lang.Override
        public ScoreQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ScoreQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single score by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.score.v1.ScoreId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List every score of a run.
     * </pre>
     */
    default void listByRun(ai.stigmer.agentic.score.v1.ListScoresByRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByRunMethod(), responseObserver);
    }

    /**
     * <pre>
     * List every score of every run in a session.
     * </pre>
     */
    default void listBySession(ai.stigmer.agentic.score.v1.ListScoresBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListBySessionMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScoreQueryController.
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public static abstract class ScoreQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScoreQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScoreQueryController.
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public static final class ScoreQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScoreQueryControllerStub> {
    private ScoreQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single score by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.score.v1.ScoreId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List every score of a run.
     * </pre>
     */
    public void listByRun(ai.stigmer.agentic.score.v1.ListScoresByRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByRunMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List every score of every run in a session.
     * </pre>
     */
    public void listBySession(ai.stigmer.agentic.score.v1.ListScoresBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScoreQueryController.
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public static final class ScoreQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScoreQueryControllerBlockingV2Stub> {
    private ScoreQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single score by ID.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score get(ai.stigmer.agentic.score.v1.ScoreId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every score of a run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.ScoreList listByRun(ai.stigmer.agentic.score.v1.ListScoresByRunRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByRunMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every score of every run in a session.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.ScoreList listBySession(ai.stigmer.agentic.score.v1.ListScoresBySessionRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScoreQueryController.
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public static final class ScoreQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScoreQueryControllerBlockingStub> {
    private ScoreQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single score by ID.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score get(ai.stigmer.agentic.score.v1.ScoreId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every score of a run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.ScoreList listByRun(ai.stigmer.agentic.score.v1.ListScoresByRunRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByRunMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every score of every run in a session.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.ScoreList listBySession(ai.stigmer.agentic.score.v1.ListScoresBySessionRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScoreQueryController.
   * <pre>
   * ScoreQueryController handles read operations for scores.
   * </pre>
   */
  public static final class ScoreQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScoreQueryControllerFutureStub> {
    private ScoreQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single score by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.Score> get(
        ai.stigmer.agentic.score.v1.ScoreId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List every score of a run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.ScoreList> listByRun(
        ai.stigmer.agentic.score.v1.ListScoresByRunRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByRunMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List every score of every run in a session.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.ScoreList> listBySession(
        ai.stigmer.agentic.score.v1.ListScoresBySessionRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_RUN = 1;
  private static final int METHODID_LIST_BY_SESSION = 2;

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
          serviceImpl.get((ai.stigmer.agentic.score.v1.ScoreId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score>) responseObserver);
          break;
        case METHODID_LIST_BY_RUN:
          serviceImpl.listByRun((ai.stigmer.agentic.score.v1.ListScoresByRunRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList>) responseObserver);
          break;
        case METHODID_LIST_BY_SESSION:
          serviceImpl.listBySession((ai.stigmer.agentic.score.v1.ListScoresBySessionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.ScoreList>) responseObserver);
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
              ai.stigmer.agentic.score.v1.ScoreId,
              ai.stigmer.agentic.score.v1.Score>(
                service, METHODID_GET)))
        .addMethod(
          getListByRunMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.score.v1.ListScoresByRunRequest,
              ai.stigmer.agentic.score.v1.ScoreList>(
                service, METHODID_LIST_BY_RUN)))
        .addMethod(
          getListBySessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.score.v1.ListScoresBySessionRequest,
              ai.stigmer.agentic.score.v1.ScoreList>(
                service, METHODID_LIST_BY_SESSION)))
        .build();
  }

  private static abstract class ScoreQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScoreQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.score.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScoreQueryController");
    }
  }

  private static final class ScoreQueryControllerFileDescriptorSupplier
      extends ScoreQueryControllerBaseDescriptorSupplier {
    ScoreQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ScoreQueryControllerMethodDescriptorSupplier
      extends ScoreQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScoreQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScoreQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScoreQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByRunMethod())
              .addMethod(getListBySessionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
