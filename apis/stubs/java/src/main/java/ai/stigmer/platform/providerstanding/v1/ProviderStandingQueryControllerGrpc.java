package ai.stigmer.platform.providerstanding.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ProviderStandingQueryController serves the operator console's read-only
 * view of platform provider standing: the canary-probe verdicts the
 * cloud#370 detection core records hourly (health, billing/auth
 * rejections, latency, bounded error summaries).
 * Platform-gated and view-only: provider account health is
 * platform-internal, never org-visible, and this surface only observes —
 * there is nothing to CRUD (the standing model is deliberately a
 * lightweight status, not an API resource).
 * &#64;internal
 * Cloud-only; not implemented by the OSS Go server.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ProviderStandingQueryControllerGrpc {

  private ProviderStandingQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.providerstanding.v1.ProviderStandingQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput,
      ai.stigmer.platform.providerstanding.v1.ProviderStandingView> getGetProviderStandingViewMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getProviderStandingView",
      requestType = ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput.class,
      responseType = ai.stigmer.platform.providerstanding.v1.ProviderStandingView.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput,
      ai.stigmer.platform.providerstanding.v1.ProviderStandingView> getGetProviderStandingViewMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput, ai.stigmer.platform.providerstanding.v1.ProviderStandingView> getGetProviderStandingViewMethod;
    if ((getGetProviderStandingViewMethod = ProviderStandingQueryControllerGrpc.getGetProviderStandingViewMethod) == null) {
      synchronized (ProviderStandingQueryControllerGrpc.class) {
        if ((getGetProviderStandingViewMethod = ProviderStandingQueryControllerGrpc.getGetProviderStandingViewMethod) == null) {
          ProviderStandingQueryControllerGrpc.getGetProviderStandingViewMethod = getGetProviderStandingViewMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput, ai.stigmer.platform.providerstanding.v1.ProviderStandingView>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getProviderStandingView"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.providerstanding.v1.ProviderStandingView.getDefaultInstance()))
              .setSchemaDescriptor(new ProviderStandingQueryControllerMethodDescriptorSupplier("getProviderStandingView"))
              .build();
        }
      }
    }
    return getGetProviderStandingViewMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ProviderStandingQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerStub>() {
        @java.lang.Override
        public ProviderStandingQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderStandingQueryControllerStub(channel, callOptions);
        }
      };
    return ProviderStandingQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ProviderStandingQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ProviderStandingQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderStandingQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ProviderStandingQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ProviderStandingQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerBlockingStub>() {
        @java.lang.Override
        public ProviderStandingQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderStandingQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ProviderStandingQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ProviderStandingQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderStandingQueryControllerFutureStub>() {
        @java.lang.Override
        public ProviderStandingQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderStandingQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ProviderStandingQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Retrieve the latest probe verdict for every platform provider.
     * </pre>
     */
    default void getProviderStandingView(ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.providerstanding.v1.ProviderStandingView> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetProviderStandingViewMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ProviderStandingQueryController.
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static abstract class ProviderStandingQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ProviderStandingQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ProviderStandingQueryController.
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class ProviderStandingQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ProviderStandingQueryControllerStub> {
    private ProviderStandingQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderStandingQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderStandingQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the latest probe verdict for every platform provider.
     * </pre>
     */
    public void getProviderStandingView(ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.providerstanding.v1.ProviderStandingView> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetProviderStandingViewMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ProviderStandingQueryController.
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class ProviderStandingQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ProviderStandingQueryControllerBlockingV2Stub> {
    private ProviderStandingQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderStandingQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderStandingQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the latest probe verdict for every platform provider.
     * </pre>
     */
    public ai.stigmer.platform.providerstanding.v1.ProviderStandingView getProviderStandingView(ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetProviderStandingViewMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ProviderStandingQueryController.
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class ProviderStandingQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ProviderStandingQueryControllerBlockingStub> {
    private ProviderStandingQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderStandingQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderStandingQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the latest probe verdict for every platform provider.
     * </pre>
     */
    public ai.stigmer.platform.providerstanding.v1.ProviderStandingView getProviderStandingView(ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetProviderStandingViewMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ProviderStandingQueryController.
   * <pre>
   * ProviderStandingQueryController serves the operator console's read-only
   * view of platform provider standing: the canary-probe verdicts the
   * cloud#370 detection core records hourly (health, billing/auth
   * rejections, latency, bounded error summaries).
   * Platform-gated and view-only: provider account health is
   * platform-internal, never org-visible, and this surface only observes —
   * there is nothing to CRUD (the standing model is deliberately a
   * lightweight status, not an API resource).
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class ProviderStandingQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ProviderStandingQueryControllerFutureStub> {
    private ProviderStandingQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderStandingQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderStandingQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the latest probe verdict for every platform provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.providerstanding.v1.ProviderStandingView> getProviderStandingView(
        ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetProviderStandingViewMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_PROVIDER_STANDING_VIEW = 0;

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
        case METHODID_GET_PROVIDER_STANDING_VIEW:
          serviceImpl.getProviderStandingView((ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.providerstanding.v1.ProviderStandingView>) responseObserver);
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
          getGetProviderStandingViewMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.providerstanding.v1.GetProviderStandingViewInput,
              ai.stigmer.platform.providerstanding.v1.ProviderStandingView>(
                service, METHODID_GET_PROVIDER_STANDING_VIEW)))
        .build();
  }

  private static abstract class ProviderStandingQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ProviderStandingQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.providerstanding.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ProviderStandingQueryController");
    }
  }

  private static final class ProviderStandingQueryControllerFileDescriptorSupplier
      extends ProviderStandingQueryControllerBaseDescriptorSupplier {
    ProviderStandingQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ProviderStandingQueryControllerMethodDescriptorSupplier
      extends ProviderStandingQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ProviderStandingQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ProviderStandingQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ProviderStandingQueryControllerFileDescriptorSupplier())
              .addMethod(getGetProviderStandingViewMethod())
              .build();
        }
      }
    }
    return result;
  }
}
