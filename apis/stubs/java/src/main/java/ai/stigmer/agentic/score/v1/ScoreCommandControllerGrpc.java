package ai.stigmer.agentic.score.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScoreCommandController handles write operations for scores.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScoreCommandControllerGrpc {

  private ScoreCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.score.v1.ScoreCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score,
      ai.stigmer.agentic.score.v1.Score> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.score.v1.Score.class,
      responseType = ai.stigmer.agentic.score.v1.Score.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score,
      ai.stigmer.agentic.score.v1.Score> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score, ai.stigmer.agentic.score.v1.Score> getCreateMethod;
    if ((getCreateMethod = ScoreCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ScoreCommandControllerGrpc.class) {
        if ((getCreateMethod = ScoreCommandControllerGrpc.getCreateMethod) == null) {
          ScoreCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.Score, ai.stigmer.agentic.score.v1.Score>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score,
      ai.stigmer.agentic.score.v1.Score> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.score.v1.Score.class,
      responseType = ai.stigmer.agentic.score.v1.Score.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score,
      ai.stigmer.agentic.score.v1.Score> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.Score, ai.stigmer.agentic.score.v1.Score> getUpdateMethod;
    if ((getUpdateMethod = ScoreCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ScoreCommandControllerGrpc.class) {
        if ((getUpdateMethod = ScoreCommandControllerGrpc.getUpdateMethod) == null) {
          ScoreCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.Score, ai.stigmer.agentic.score.v1.Score>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId,
      ai.stigmer.agentic.score.v1.Score> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.score.v1.ScoreId.class,
      responseType = ai.stigmer.agentic.score.v1.Score.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId,
      ai.stigmer.agentic.score.v1.Score> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.score.v1.ScoreId, ai.stigmer.agentic.score.v1.Score> getDeleteMethod;
    if ((getDeleteMethod = ScoreCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ScoreCommandControllerGrpc.class) {
        if ((getDeleteMethod = ScoreCommandControllerGrpc.getDeleteMethod) == null) {
          ScoreCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.score.v1.ScoreId, ai.stigmer.agentic.score.v1.Score>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.ScoreId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.score.v1.Score.getDefaultInstance()))
              .setSchemaDescriptor(new ScoreCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScoreCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerStub>() {
        @java.lang.Override
        public ScoreCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreCommandControllerStub(channel, callOptions);
        }
      };
    return ScoreCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScoreCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScoreCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScoreCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScoreCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerBlockingStub>() {
        @java.lang.Override
        public ScoreCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ScoreCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScoreCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScoreCommandControllerFutureStub>() {
        @java.lang.Override
        public ScoreCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScoreCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ScoreCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a score on a completed run.
     * A person rates a run with name `feedback` and source
     * score_source_human; each person rates a run once and changes the
     * rating with update. The session and organization are taken from the
     * run.
     * </pre>
     */
    default void create(ai.stigmer.agentic.score.v1.Score request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a person's rating: its value and comment.
     * Only feedback is editable, and only by the person who gave it; a
     * check's verdict never changes.
     * </pre>
     */
    default void update(ai.stigmer.agentic.score.v1.Score request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a score.
     * A person deletes their own rating; the run's owner may delete any
     * score on the run.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.score.v1.ScoreId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScoreCommandController.
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public static abstract class ScoreCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScoreCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScoreCommandController.
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public static final class ScoreCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScoreCommandControllerStub> {
    private ScoreCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a score on a completed run.
     * A person rates a run with name `feedback` and source
     * score_source_human; each person rates a run once and changes the
     * rating with update. The session and organization are taken from the
     * run.
     * </pre>
     */
    public void create(ai.stigmer.agentic.score.v1.Score request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a person's rating: its value and comment.
     * Only feedback is editable, and only by the person who gave it; a
     * check's verdict never changes.
     * </pre>
     */
    public void update(ai.stigmer.agentic.score.v1.Score request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a score.
     * A person deletes their own rating; the run's owner may delete any
     * score on the run.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.score.v1.ScoreId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScoreCommandController.
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public static final class ScoreCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScoreCommandControllerBlockingV2Stub> {
    private ScoreCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a score on a completed run.
     * A person rates a run with name `feedback` and source
     * score_source_human; each person rates a run once and changes the
     * rating with update. The session and organization are taken from the
     * run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score create(ai.stigmer.agentic.score.v1.Score request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a person's rating: its value and comment.
     * Only feedback is editable, and only by the person who gave it; a
     * check's verdict never changes.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score update(ai.stigmer.agentic.score.v1.Score request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a score.
     * A person deletes their own rating; the run's owner may delete any
     * score on the run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score delete(ai.stigmer.agentic.score.v1.ScoreId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScoreCommandController.
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public static final class ScoreCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScoreCommandControllerBlockingStub> {
    private ScoreCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a score on a completed run.
     * A person rates a run with name `feedback` and source
     * score_source_human; each person rates a run once and changes the
     * rating with update. The session and organization are taken from the
     * run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score create(ai.stigmer.agentic.score.v1.Score request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a person's rating: its value and comment.
     * Only feedback is editable, and only by the person who gave it; a
     * check's verdict never changes.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score update(ai.stigmer.agentic.score.v1.Score request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a score.
     * A person deletes their own rating; the run's owner may delete any
     * score on the run.
     * </pre>
     */
    public ai.stigmer.agentic.score.v1.Score delete(ai.stigmer.agentic.score.v1.ScoreId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScoreCommandController.
   * <pre>
   * ScoreCommandController handles write operations for scores.
   * </pre>
   */
  public static final class ScoreCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScoreCommandControllerFutureStub> {
    private ScoreCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScoreCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScoreCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a score on a completed run.
     * A person rates a run with name `feedback` and source
     * score_source_human; each person rates a run once and changes the
     * rating with update. The session and organization are taken from the
     * run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.Score> create(
        ai.stigmer.agentic.score.v1.Score request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a person's rating: its value and comment.
     * Only feedback is editable, and only by the person who gave it; a
     * check's verdict never changes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.Score> update(
        ai.stigmer.agentic.score.v1.Score request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a score.
     * A person deletes their own rating; the run's owner may delete any
     * score on the run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.score.v1.Score> delete(
        ai.stigmer.agentic.score.v1.ScoreId request) {
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
          serviceImpl.create((ai.stigmer.agentic.score.v1.Score) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.score.v1.Score) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.score.v1.ScoreId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.score.v1.Score>) responseObserver);
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
              ai.stigmer.agentic.score.v1.Score,
              ai.stigmer.agentic.score.v1.Score>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.score.v1.Score,
              ai.stigmer.agentic.score.v1.Score>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.score.v1.ScoreId,
              ai.stigmer.agentic.score.v1.Score>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ScoreCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScoreCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.score.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScoreCommandController");
    }
  }

  private static final class ScoreCommandControllerFileDescriptorSupplier
      extends ScoreCommandControllerBaseDescriptorSupplier {
    ScoreCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ScoreCommandControllerMethodDescriptorSupplier
      extends ScoreCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScoreCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScoreCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScoreCommandControllerFileDescriptorSupplier())
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
