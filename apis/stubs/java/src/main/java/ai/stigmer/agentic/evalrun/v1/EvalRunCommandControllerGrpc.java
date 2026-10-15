package ai.stigmer.agentic.evalrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvalRunCommandController handles write operations for eval runs.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvalRunCommandControllerGrpc {

  private EvalRunCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.evalrun.v1.EvalRunCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRun,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.evalrun.v1.EvalRun.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRun,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRun, ai.stigmer.agentic.evalrun.v1.EvalRun> getCreateMethod;
    if ((getCreateMethod = EvalRunCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (EvalRunCommandControllerGrpc.class) {
        if ((getCreateMethod = EvalRunCommandControllerGrpc.getCreateMethod) == null) {
          EvalRunCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.EvalRun, ai.stigmer.agentic.evalrun.v1.EvalRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRun.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRun.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.evalrun.v1.EvalRunId.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun> getCancelMethod;
    if ((getCancelMethod = EvalRunCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (EvalRunCommandControllerGrpc.class) {
        if ((getCancelMethod = EvalRunCommandControllerGrpc.getCancelMethod) == null) {
          EvalRunCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRun.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.evalrun.v1.EvalRunId.class,
      responseType = ai.stigmer.agentic.evalrun.v1.EvalRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId,
      ai.stigmer.agentic.evalrun.v1.EvalRun> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun> getDeleteMethod;
    if ((getDeleteMethod = EvalRunCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (EvalRunCommandControllerGrpc.class) {
        if ((getDeleteMethod = EvalRunCommandControllerGrpc.getDeleteMethod) == null) {
          EvalRunCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evalrun.v1.EvalRunId, ai.stigmer.agentic.evalrun.v1.EvalRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evalrun.v1.EvalRun.getDefaultInstance()))
              .setSchemaDescriptor(new EvalRunCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvalRunCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerStub>() {
        @java.lang.Override
        public EvalRunCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunCommandControllerStub(channel, callOptions);
        }
      };
    return EvalRunCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvalRunCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvalRunCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvalRunCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvalRunCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerBlockingStub>() {
        @java.lang.Override
        public EvalRunCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return EvalRunCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvalRunCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalRunCommandControllerFutureStub>() {
        @java.lang.Override
        public EvalRunCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalRunCommandControllerFutureStub(channel, callOptions);
        }
      };
    return EvalRunCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Start an eval run on an agent, or on a plugin.
     * The eval run lives in its subject's organization, which pays for every
     * try. It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    default void create(ai.stigmer.agentic.evalrun.v1.EvalRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval run.
     * Tries in flight are stopped; the eval run ends partial, "cancelled",
     * with the results of the tries that finished. Cancelling a finished
     * eval run changes nothing.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an eval run with its tries' conversations, runs and scores.
     * A pending or running eval run is refused: cancel it first.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvalRunCommandController.
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public static abstract class EvalRunCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvalRunCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvalRunCommandController.
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public static final class EvalRunCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvalRunCommandControllerStub> {
    private EvalRunCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval run on an agent, or on a plugin.
     * The eval run lives in its subject's organization, which pays for every
     * try. It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public void create(ai.stigmer.agentic.evalrun.v1.EvalRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval run.
     * Tries in flight are stopped; the eval run ends partial, "cancelled",
     * with the results of the tries that finished. Cancelling a finished
     * eval run changes nothing.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an eval run with its tries' conversations, runs and scores.
     * A pending or running eval run is refused: cancel it first.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.evalrun.v1.EvalRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvalRunCommandController.
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public static final class EvalRunCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvalRunCommandControllerBlockingV2Stub> {
    private EvalRunCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval run on an agent, or on a plugin.
     * The eval run lives in its subject's organization, which pays for every
     * try. It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun create(ai.stigmer.agentic.evalrun.v1.EvalRun request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval run.
     * Tries in flight are stopped; the eval run ends partial, "cancelled",
     * with the results of the tries that finished. Cancelling a finished
     * eval run changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun cancel(ai.stigmer.agentic.evalrun.v1.EvalRunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval run with its tries' conversations, runs and scores.
     * A pending or running eval run is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun delete(ai.stigmer.agentic.evalrun.v1.EvalRunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvalRunCommandController.
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public static final class EvalRunCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvalRunCommandControllerBlockingStub> {
    private EvalRunCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval run on an agent, or on a plugin.
     * The eval run lives in its subject's organization, which pays for every
     * try. It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun create(ai.stigmer.agentic.evalrun.v1.EvalRun request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval run.
     * Tries in flight are stopped; the eval run ends partial, "cancelled",
     * with the results of the tries that finished. Cancelling a finished
     * eval run changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun cancel(ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval run with its tries' conversations, runs and scores.
     * A pending or running eval run is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.evalrun.v1.EvalRun delete(ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvalRunCommandController.
   * <pre>
   * EvalRunCommandController handles write operations for eval runs.
   * </pre>
   */
  public static final class EvalRunCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvalRunCommandControllerFutureStub> {
    private EvalRunCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalRunCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalRunCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval run on an agent, or on a plugin.
     * The eval run lives in its subject's organization, which pays for every
     * try. It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRun> create(
        ai.stigmer.agentic.evalrun.v1.EvalRun request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval run.
     * Tries in flight are stopped; the eval run ends partial, "cancelled",
     * with the results of the tries that finished. Cancelling a finished
     * eval run changes nothing.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRun> cancel(
        ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an eval run with its tries' conversations, runs and scores.
     * A pending or running eval run is refused: cancel it first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evalrun.v1.EvalRun> delete(
        ai.stigmer.agentic.evalrun.v1.EvalRunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_CANCEL = 1;
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
          serviceImpl.create((ai.stigmer.agentic.evalrun.v1.EvalRun) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.evalrun.v1.EvalRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.evalrun.v1.EvalRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evalrun.v1.EvalRun>) responseObserver);
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
              ai.stigmer.agentic.evalrun.v1.EvalRun,
              ai.stigmer.agentic.evalrun.v1.EvalRun>(
                service, METHODID_CREATE)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evalrun.v1.EvalRunId,
              ai.stigmer.agentic.evalrun.v1.EvalRun>(
                service, METHODID_CANCEL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evalrun.v1.EvalRunId,
              ai.stigmer.agentic.evalrun.v1.EvalRun>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class EvalRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvalRunCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.evalrun.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvalRunCommandController");
    }
  }

  private static final class EvalRunCommandControllerFileDescriptorSupplier
      extends EvalRunCommandControllerBaseDescriptorSupplier {
    EvalRunCommandControllerFileDescriptorSupplier() {}
  }

  private static final class EvalRunCommandControllerMethodDescriptorSupplier
      extends EvalRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvalRunCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvalRunCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvalRunCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getCancelMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
