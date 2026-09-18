package ai.stigmer.billing.subscription.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SubscriptionCommandController provides the write operations on an
 * organization's subscription.
 * There is no create: how a subscription comes to exist is the payment
 * system's (a checkout), so changePlan on an organization with none is the
 * act of subscribing. Every write authorizes on the organization with
 * can_manage_billing, the permission the billing account's writes use.
 * &#64;internal
 * Served by the cloud composition only (the kind is cloud_only). The
 * billing engine owns what each write does against the payment system;
 * this contract states only the organization-facing act and its
 * authorization.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SubscriptionCommandControllerGrpc {

  private SubscriptionCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.subscription.v1.SubscriptionCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.ChangePlanInput,
      ai.stigmer.billing.subscription.v1.Subscription> getChangePlanMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "changePlan",
      requestType = ai.stigmer.billing.subscription.v1.ChangePlanInput.class,
      responseType = ai.stigmer.billing.subscription.v1.Subscription.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.ChangePlanInput,
      ai.stigmer.billing.subscription.v1.Subscription> getChangePlanMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.ChangePlanInput, ai.stigmer.billing.subscription.v1.Subscription> getChangePlanMethod;
    if ((getChangePlanMethod = SubscriptionCommandControllerGrpc.getChangePlanMethod) == null) {
      synchronized (SubscriptionCommandControllerGrpc.class) {
        if ((getChangePlanMethod = SubscriptionCommandControllerGrpc.getChangePlanMethod) == null) {
          SubscriptionCommandControllerGrpc.getChangePlanMethod = getChangePlanMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.subscription.v1.ChangePlanInput, ai.stigmer.billing.subscription.v1.Subscription>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "changePlan"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.ChangePlanInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.Subscription.getDefaultInstance()))
              .setSchemaDescriptor(new SubscriptionCommandControllerMethodDescriptorSupplier("changePlan"))
              .build();
        }
      }
    }
    return getChangePlanMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.CancelSubscriptionInput,
      ai.stigmer.billing.subscription.v1.Subscription> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.billing.subscription.v1.CancelSubscriptionInput.class,
      responseType = ai.stigmer.billing.subscription.v1.Subscription.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.CancelSubscriptionInput,
      ai.stigmer.billing.subscription.v1.Subscription> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.CancelSubscriptionInput, ai.stigmer.billing.subscription.v1.Subscription> getCancelMethod;
    if ((getCancelMethod = SubscriptionCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (SubscriptionCommandControllerGrpc.class) {
        if ((getCancelMethod = SubscriptionCommandControllerGrpc.getCancelMethod) == null) {
          SubscriptionCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.subscription.v1.CancelSubscriptionInput, ai.stigmer.billing.subscription.v1.Subscription>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.CancelSubscriptionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.Subscription.getDefaultInstance()))
              .setSchemaDescriptor(new SubscriptionCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SubscriptionCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerStub>() {
        @java.lang.Override
        public SubscriptionCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionCommandControllerStub(channel, callOptions);
        }
      };
    return SubscriptionCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SubscriptionCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public SubscriptionCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SubscriptionCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SubscriptionCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerBlockingStub>() {
        @java.lang.Override
        public SubscriptionCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return SubscriptionCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SubscriptionCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionCommandControllerFutureStub>() {
        @java.lang.Override
        public SubscriptionCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionCommandControllerFutureStub(channel, callOptions);
        }
      };
    return SubscriptionCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Move the organization onto a plan.
     * Subscribes an organization that has no subscription, or changes the plan
     * of one that does. The plan must be active and bought through a
     * subscription. Returns the subscription as it stands after the change.
     * </pre>
     */
    default void changePlan(ai.stigmer.billing.subscription.v1.ChangePlanInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getChangePlanMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel the organization's subscription.
     * The organization keeps its plan to the end of the current period and is
     * on Free after it. NOT_FOUND when the organization has no subscription.
     * </pre>
     */
    default void cancel(ai.stigmer.billing.subscription.v1.CancelSubscriptionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SubscriptionCommandController.
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public static abstract class SubscriptionCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SubscriptionCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SubscriptionCommandController.
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public static final class SubscriptionCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SubscriptionCommandControllerStub> {
    private SubscriptionCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Move the organization onto a plan.
     * Subscribes an organization that has no subscription, or changes the plan
     * of one that does. The plan must be active and bought through a
     * subscription. Returns the subscription as it stands after the change.
     * </pre>
     */
    public void changePlan(ai.stigmer.billing.subscription.v1.ChangePlanInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getChangePlanMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel the organization's subscription.
     * The organization keeps its plan to the end of the current period and is
     * on Free after it. NOT_FOUND when the organization has no subscription.
     * </pre>
     */
    public void cancel(ai.stigmer.billing.subscription.v1.CancelSubscriptionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SubscriptionCommandController.
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public static final class SubscriptionCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SubscriptionCommandControllerBlockingV2Stub> {
    private SubscriptionCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Move the organization onto a plan.
     * Subscribes an organization that has no subscription, or changes the plan
     * of one that does. The plan must be active and bought through a
     * subscription. Returns the subscription as it stands after the change.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription changePlan(ai.stigmer.billing.subscription.v1.ChangePlanInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getChangePlanMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel the organization's subscription.
     * The organization keeps its plan to the end of the current period and is
     * on Free after it. NOT_FOUND when the organization has no subscription.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription cancel(ai.stigmer.billing.subscription.v1.CancelSubscriptionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SubscriptionCommandController.
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public static final class SubscriptionCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SubscriptionCommandControllerBlockingStub> {
    private SubscriptionCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Move the organization onto a plan.
     * Subscribes an organization that has no subscription, or changes the plan
     * of one that does. The plan must be active and bought through a
     * subscription. Returns the subscription as it stands after the change.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription changePlan(ai.stigmer.billing.subscription.v1.ChangePlanInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getChangePlanMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel the organization's subscription.
     * The organization keeps its plan to the end of the current period and is
     * on Free after it. NOT_FOUND when the organization has no subscription.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription cancel(ai.stigmer.billing.subscription.v1.CancelSubscriptionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SubscriptionCommandController.
   * <pre>
   * SubscriptionCommandController provides the write operations on an
   * organization's subscription.
   * There is no create: how a subscription comes to exist is the payment
   * system's (a checkout), so changePlan on an organization with none is the
   * act of subscribing. Every write authorizes on the organization with
   * can_manage_billing, the permission the billing account's writes use.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). The
   * billing engine owns what each write does against the payment system;
   * this contract states only the organization-facing act and its
   * authorization.
   * </pre>
   */
  public static final class SubscriptionCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SubscriptionCommandControllerFutureStub> {
    private SubscriptionCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Move the organization onto a plan.
     * Subscribes an organization that has no subscription, or changes the plan
     * of one that does. The plan must be active and bought through a
     * subscription. Returns the subscription as it stands after the change.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.subscription.v1.Subscription> changePlan(
        ai.stigmer.billing.subscription.v1.ChangePlanInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getChangePlanMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel the organization's subscription.
     * The organization keeps its plan to the end of the current period and is
     * on Free after it. NOT_FOUND when the organization has no subscription.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.subscription.v1.Subscription> cancel(
        ai.stigmer.billing.subscription.v1.CancelSubscriptionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CHANGE_PLAN = 0;
  private static final int METHODID_CANCEL = 1;

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
        case METHODID_CHANGE_PLAN:
          serviceImpl.changePlan((ai.stigmer.billing.subscription.v1.ChangePlanInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.billing.subscription.v1.CancelSubscriptionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription>) responseObserver);
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
          getChangePlanMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.subscription.v1.ChangePlanInput,
              ai.stigmer.billing.subscription.v1.Subscription>(
                service, METHODID_CHANGE_PLAN)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.subscription.v1.CancelSubscriptionInput,
              ai.stigmer.billing.subscription.v1.Subscription>(
                service, METHODID_CANCEL)))
        .build();
  }

  private static abstract class SubscriptionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SubscriptionCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.subscription.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SubscriptionCommandController");
    }
  }

  private static final class SubscriptionCommandControllerFileDescriptorSupplier
      extends SubscriptionCommandControllerBaseDescriptorSupplier {
    SubscriptionCommandControllerFileDescriptorSupplier() {}
  }

  private static final class SubscriptionCommandControllerMethodDescriptorSupplier
      extends SubscriptionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SubscriptionCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SubscriptionCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SubscriptionCommandControllerFileDescriptorSupplier())
              .addMethod(getChangePlanMethod())
              .addMethod(getCancelMethod())
              .build();
        }
      }
    }
    return result;
  }
}
