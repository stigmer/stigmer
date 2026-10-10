package ai.stigmer.agentic.vault.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * VaultValueController hands a runner the values one execution uses, read
 * from their vaults when its work starts. Nothing else reads a vault's
 * values.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class VaultValueControllerGrpc {

  private VaultValueControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.vault.v1.VaultValueController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput,
      ai.stigmer.agentic.vault.v1.ExecutionValues> getFetchValuesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "fetchValues",
      requestType = ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput.class,
      responseType = ai.stigmer.agentic.vault.v1.ExecutionValues.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput,
      ai.stigmer.agentic.vault.v1.ExecutionValues> getFetchValuesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput, ai.stigmer.agentic.vault.v1.ExecutionValues> getFetchValuesMethod;
    if ((getFetchValuesMethod = VaultValueControllerGrpc.getFetchValuesMethod) == null) {
      synchronized (VaultValueControllerGrpc.class) {
        if ((getFetchValuesMethod = VaultValueControllerGrpc.getFetchValuesMethod) == null) {
          VaultValueControllerGrpc.getFetchValuesMethod = getFetchValuesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput, ai.stigmer.agentic.vault.v1.ExecutionValues>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "fetchValues"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ExecutionValues.getDefaultInstance()))
              .setSchemaDescriptor(new VaultValueControllerMethodDescriptorSupplier("fetchValues"))
              .build();
        }
      }
    }
    return getFetchValuesMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static VaultValueControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerStub>() {
        @java.lang.Override
        public VaultValueControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultValueControllerStub(channel, callOptions);
        }
      };
    return VaultValueControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static VaultValueControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerBlockingV2Stub>() {
        @java.lang.Override
        public VaultValueControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultValueControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return VaultValueControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static VaultValueControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerBlockingStub>() {
        @java.lang.Override
        public VaultValueControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultValueControllerBlockingStub(channel, callOptions);
        }
      };
    return VaultValueControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static VaultValueControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultValueControllerFutureStub>() {
        @java.lang.Override
        public VaultValueControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultValueControllerFutureStub(channel, callOptions);
        }
      };
    return VaultValueControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Fetch the values of a run or of a tools listing, grouped by who declared
     * them, opened from the vaults the run's source manifest names
     * (RunStatus.credentials.sources) as they are now.
     * </pre>
     */
    default void fetchValues(ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ExecutionValues> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFetchValuesMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service VaultValueController.
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public static abstract class VaultValueControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return VaultValueControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service VaultValueController.
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public static final class VaultValueControllerStub
      extends io.grpc.stub.AbstractAsyncStub<VaultValueControllerStub> {
    private VaultValueControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultValueControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultValueControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Fetch the values of a run or of a tools listing, grouped by who declared
     * them, opened from the vaults the run's source manifest names
     * (RunStatus.credentials.sources) as they are now.
     * </pre>
     */
    public void fetchValues(ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ExecutionValues> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFetchValuesMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service VaultValueController.
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public static final class VaultValueControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<VaultValueControllerBlockingV2Stub> {
    private VaultValueControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultValueControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultValueControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Fetch the values of a run or of a tools listing, grouped by who declared
     * them, opened from the vaults the run's source manifest names
     * (RunStatus.credentials.sources) as they are now.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ExecutionValues fetchValues(ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFetchValuesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service VaultValueController.
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public static final class VaultValueControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<VaultValueControllerBlockingStub> {
    private VaultValueControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultValueControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultValueControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Fetch the values of a run or of a tools listing, grouped by who declared
     * them, opened from the vaults the run's source manifest names
     * (RunStatus.credentials.sources) as they are now.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ExecutionValues fetchValues(ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFetchValuesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service VaultValueController.
   * <pre>
   * VaultValueController hands a runner the values one execution uses, read
   * from their vaults when its work starts. Nothing else reads a vault's
   * values.
   * </pre>
   */
  public static final class VaultValueControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<VaultValueControllerFutureStub> {
    private VaultValueControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultValueControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultValueControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Fetch the values of a run or of a tools listing, grouped by who declared
     * them, opened from the vaults the run's source manifest names
     * (RunStatus.credentials.sources) as they are now.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.ExecutionValues> fetchValues(
        ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFetchValuesMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_FETCH_VALUES = 0;

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
        case METHODID_FETCH_VALUES:
          serviceImpl.fetchValues((ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ExecutionValues>) responseObserver);
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
          getFetchValuesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.FetchExecutionValuesInput,
              ai.stigmer.agentic.vault.v1.ExecutionValues>(
                service, METHODID_FETCH_VALUES)))
        .build();
  }

  private static abstract class VaultValueControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    VaultValueControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.vault.v1.ValuesProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("VaultValueController");
    }
  }

  private static final class VaultValueControllerFileDescriptorSupplier
      extends VaultValueControllerBaseDescriptorSupplier {
    VaultValueControllerFileDescriptorSupplier() {}
  }

  private static final class VaultValueControllerMethodDescriptorSupplier
      extends VaultValueControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    VaultValueControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (VaultValueControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new VaultValueControllerFileDescriptorSupplier())
              .addMethod(getFetchValuesMethod())
              .build();
        }
      }
    }
    return result;
  }
}
