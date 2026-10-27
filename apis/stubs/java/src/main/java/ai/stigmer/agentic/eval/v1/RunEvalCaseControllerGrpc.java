package ai.stigmer.agentic.eval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunEvalCaseController is a runner's door to the eval case its run tries:
 * it hands the turn a link to the archive of the Eval version the run's
 * case names, signed for the runner's address.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunEvalCaseControllerGrpc {

  private RunEvalCaseControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.eval.v1.RunEvalCaseController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput,
      ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetArchiveDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArchiveDownloadUrl",
      requestType = ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput,
      ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetArchiveDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput, ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetArchiveDownloadUrlMethod;
    if ((getGetArchiveDownloadUrlMethod = RunEvalCaseControllerGrpc.getGetArchiveDownloadUrlMethod) == null) {
      synchronized (RunEvalCaseControllerGrpc.class) {
        if ((getGetArchiveDownloadUrlMethod = RunEvalCaseControllerGrpc.getGetArchiveDownloadUrlMethod) == null) {
          RunEvalCaseControllerGrpc.getGetArchiveDownloadUrlMethod = getGetArchiveDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput, ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArchiveDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new RunEvalCaseControllerMethodDescriptorSupplier("getArchiveDownloadUrl"))
              .build();
        }
      }
    }
    return getGetArchiveDownloadUrlMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunEvalCaseControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerStub>() {
        @java.lang.Override
        public RunEvalCaseControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunEvalCaseControllerStub(channel, callOptions);
        }
      };
    return RunEvalCaseControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunEvalCaseControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunEvalCaseControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunEvalCaseControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunEvalCaseControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunEvalCaseControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerBlockingStub>() {
        @java.lang.Override
        public RunEvalCaseControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunEvalCaseControllerBlockingStub(channel, callOptions);
        }
      };
    return RunEvalCaseControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunEvalCaseControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunEvalCaseControllerFutureStub>() {
        @java.lang.Override
        public RunEvalCaseControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunEvalCaseControllerFutureStub(channel, callOptions);
        }
      };
    return RunEvalCaseControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * A link to the archive of the Eval version a run's case names, valid
     * for an hour.
     * </pre>
     */
    default void getArchiveDownloadUrl(ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArchiveDownloadUrlMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunEvalCaseController.
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public static abstract class RunEvalCaseControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunEvalCaseControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunEvalCaseController.
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public static final class RunEvalCaseControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunEvalCaseControllerStub> {
    private RunEvalCaseControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunEvalCaseControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunEvalCaseControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * A link to the archive of the Eval version a run's case names, valid
     * for an hour.
     * </pre>
     */
    public void getArchiveDownloadUrl(ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArchiveDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunEvalCaseController.
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public static final class RunEvalCaseControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunEvalCaseControllerBlockingV2Stub> {
    private RunEvalCaseControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunEvalCaseControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunEvalCaseControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * A link to the archive of the Eval version a run's case names, valid
     * for an hour.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl getArchiveDownloadUrl(ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArchiveDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunEvalCaseController.
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public static final class RunEvalCaseControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunEvalCaseControllerBlockingStub> {
    private RunEvalCaseControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunEvalCaseControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunEvalCaseControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * A link to the archive of the Eval version a run's case names, valid
     * for an hour.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl getArchiveDownloadUrl(ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArchiveDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunEvalCaseController.
   * <pre>
   * RunEvalCaseController is a runner's door to the eval case its run tries:
   * it hands the turn a link to the archive of the Eval version the run's
   * case names, signed for the runner's address.
   * </pre>
   */
  public static final class RunEvalCaseControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunEvalCaseControllerFutureStub> {
    private RunEvalCaseControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunEvalCaseControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunEvalCaseControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * A link to the archive of the Eval version a run's case names, valid
     * for an hour.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getArchiveDownloadUrl(
        ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArchiveDownloadUrlMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_ARCHIVE_DOWNLOAD_URL = 0;

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
        case METHODID_GET_ARCHIVE_DOWNLOAD_URL:
          serviceImpl.getArchiveDownloadUrl((ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>) responseObserver);
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
          getGetArchiveDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.GetRunEvalCaseArchiveInput,
              ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>(
                service, METHODID_GET_ARCHIVE_DOWNLOAD_URL)))
        .build();
  }

  private static abstract class RunEvalCaseControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunEvalCaseControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.eval.v1.RunEvalCaseProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunEvalCaseController");
    }
  }

  private static final class RunEvalCaseControllerFileDescriptorSupplier
      extends RunEvalCaseControllerBaseDescriptorSupplier {
    RunEvalCaseControllerFileDescriptorSupplier() {}
  }

  private static final class RunEvalCaseControllerMethodDescriptorSupplier
      extends RunEvalCaseControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunEvalCaseControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunEvalCaseControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunEvalCaseControllerFileDescriptorSupplier())
              .addMethod(getGetArchiveDownloadUrlMethod())
              .build();
        }
      }
    }
    return result;
  }
}
