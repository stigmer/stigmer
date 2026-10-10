package ai.stigmer.agentic.plugineval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PluginEvalCommandController handles write operations for plugin evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PluginEvalCommandControllerGrpc {

  private PluginEvalCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.plugineval.v1.PluginEvalCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEval,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.plugineval.v1.PluginEval.class,
      responseType = ai.stigmer.agentic.plugineval.v1.PluginEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEval,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEval, ai.stigmer.agentic.plugineval.v1.PluginEval> getCreateMethod;
    if ((getCreateMethod = PluginEvalCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (PluginEvalCommandControllerGrpc.class) {
        if ((getCreateMethod = PluginEvalCommandControllerGrpc.getCreateMethod) == null) {
          PluginEvalCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugineval.v1.PluginEval, ai.stigmer.agentic.plugineval.v1.PluginEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEval.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEval.getDefaultInstance()))
              .setSchemaDescriptor(new PluginEvalCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.plugineval.v1.PluginEvalId.class,
      responseType = ai.stigmer.agentic.plugineval.v1.PluginEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval> getCancelMethod;
    if ((getCancelMethod = PluginEvalCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (PluginEvalCommandControllerGrpc.class) {
        if ((getCancelMethod = PluginEvalCommandControllerGrpc.getCancelMethod) == null) {
          PluginEvalCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEval.getDefaultInstance()))
              .setSchemaDescriptor(new PluginEvalCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.plugineval.v1.PluginEvalId.class,
      responseType = ai.stigmer.agentic.plugineval.v1.PluginEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId,
      ai.stigmer.agentic.plugineval.v1.PluginEval> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval> getDeleteMethod;
    if ((getDeleteMethod = PluginEvalCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (PluginEvalCommandControllerGrpc.class) {
        if ((getDeleteMethod = PluginEvalCommandControllerGrpc.getDeleteMethod) == null) {
          PluginEvalCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugineval.v1.PluginEvalId, ai.stigmer.agentic.plugineval.v1.PluginEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugineval.v1.PluginEval.getDefaultInstance()))
              .setSchemaDescriptor(new PluginEvalCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PluginEvalCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerStub>() {
        @java.lang.Override
        public PluginEvalCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalCommandControllerStub(channel, callOptions);
        }
      };
    return PluginEvalCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PluginEvalCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public PluginEvalCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PluginEvalCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PluginEvalCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerBlockingStub>() {
        @java.lang.Override
        public PluginEvalCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return PluginEvalCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PluginEvalCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginEvalCommandControllerFutureStub>() {
        @java.lang.Override
        public PluginEvalCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginEvalCommandControllerFutureStub(channel, callOptions);
        }
      };
    return PluginEvalCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Start an eval of a plugin's evals/ cases.
     * The eval lives in its plugin's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    default void create(ai.stigmer.agentic.plugineval.v1.PluginEval request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PluginEvalCommandController.
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public static abstract class PluginEvalCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PluginEvalCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PluginEvalCommandController.
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PluginEvalCommandControllerStub> {
    private PluginEvalCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of a plugin's evals/ cases.
     * The eval lives in its plugin's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public void create(ai.stigmer.agentic.plugineval.v1.PluginEval request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.plugineval.v1.PluginEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PluginEvalCommandController.
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PluginEvalCommandControllerBlockingV2Stub> {
    private PluginEvalCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of a plugin's evals/ cases.
     * The eval lives in its plugin's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval create(ai.stigmer.agentic.plugineval.v1.PluginEval request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval cancel(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval delete(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PluginEvalCommandController.
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PluginEvalCommandControllerBlockingStub> {
    private PluginEvalCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of a plugin's evals/ cases.
     * The eval lives in its plugin's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval create(ai.stigmer.agentic.plugineval.v1.PluginEval request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval cancel(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.plugineval.v1.PluginEval delete(ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PluginEvalCommandController.
   * <pre>
   * PluginEvalCommandController handles write operations for plugin evals.
   * </pre>
   */
  public static final class PluginEvalCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PluginEvalCommandControllerFutureStub> {
    private PluginEvalCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginEvalCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginEvalCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of a plugin's evals/ cases.
     * The eval lives in its plugin's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugineval.v1.PluginEval> create(
        ai.stigmer.agentic.plugineval.v1.PluginEval request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugineval.v1.PluginEval> cancel(
        ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugineval.v1.PluginEval> delete(
        ai.stigmer.agentic.plugineval.v1.PluginEvalId request) {
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
          serviceImpl.create((ai.stigmer.agentic.plugineval.v1.PluginEval) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.plugineval.v1.PluginEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.plugineval.v1.PluginEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugineval.v1.PluginEval>) responseObserver);
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
              ai.stigmer.agentic.plugineval.v1.PluginEval,
              ai.stigmer.agentic.plugineval.v1.PluginEval>(
                service, METHODID_CREATE)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugineval.v1.PluginEvalId,
              ai.stigmer.agentic.plugineval.v1.PluginEval>(
                service, METHODID_CANCEL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugineval.v1.PluginEvalId,
              ai.stigmer.agentic.plugineval.v1.PluginEval>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class PluginEvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PluginEvalCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.plugineval.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PluginEvalCommandController");
    }
  }

  private static final class PluginEvalCommandControllerFileDescriptorSupplier
      extends PluginEvalCommandControllerBaseDescriptorSupplier {
    PluginEvalCommandControllerFileDescriptorSupplier() {}
  }

  private static final class PluginEvalCommandControllerMethodDescriptorSupplier
      extends PluginEvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PluginEvalCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PluginEvalCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PluginEvalCommandControllerFileDescriptorSupplier())
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
