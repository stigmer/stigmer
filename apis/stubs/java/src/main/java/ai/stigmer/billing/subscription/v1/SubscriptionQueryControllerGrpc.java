package ai.stigmer.billing.subscription.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SubscriptionQueryController provides the read operations on an
 * organization's subscription.
 * Every read is keyed by the organization, because an organization has at
 * most one active subscription, and authorizes on the organization with
 * can_view_billing, the permission the billing account's reads use.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SubscriptionQueryControllerGrpc {

  private SubscriptionQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.subscription.v1.SubscriptionQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput,
      ai.stigmer.billing.subscription.v1.Subscription> getGetForOrganizationMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getForOrganization",
      requestType = ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput.class,
      responseType = ai.stigmer.billing.subscription.v1.Subscription.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput,
      ai.stigmer.billing.subscription.v1.Subscription> getGetForOrganizationMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput, ai.stigmer.billing.subscription.v1.Subscription> getGetForOrganizationMethod;
    if ((getGetForOrganizationMethod = SubscriptionQueryControllerGrpc.getGetForOrganizationMethod) == null) {
      synchronized (SubscriptionQueryControllerGrpc.class) {
        if ((getGetForOrganizationMethod = SubscriptionQueryControllerGrpc.getGetForOrganizationMethod) == null) {
          SubscriptionQueryControllerGrpc.getGetForOrganizationMethod = getGetForOrganizationMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput, ai.stigmer.billing.subscription.v1.Subscription>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getForOrganization"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.Subscription.getDefaultInstance()))
              .setSchemaDescriptor(new SubscriptionQueryControllerMethodDescriptorSupplier("getForOrganization"))
              .build();
        }
      }
    }
    return getGetForOrganizationMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetEntitlementsInput,
      ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> getGetEntitlementsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getEntitlements",
      requestType = ai.stigmer.billing.subscription.v1.GetEntitlementsInput.class,
      responseType = ai.stigmer.billing.subscription.v1.GetEntitlementsOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetEntitlementsInput,
      ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> getGetEntitlementsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetEntitlementsInput, ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> getGetEntitlementsMethod;
    if ((getGetEntitlementsMethod = SubscriptionQueryControllerGrpc.getGetEntitlementsMethod) == null) {
      synchronized (SubscriptionQueryControllerGrpc.class) {
        if ((getGetEntitlementsMethod = SubscriptionQueryControllerGrpc.getGetEntitlementsMethod) == null) {
          SubscriptionQueryControllerGrpc.getGetEntitlementsMethod = getGetEntitlementsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.subscription.v1.GetEntitlementsInput, ai.stigmer.billing.subscription.v1.GetEntitlementsOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getEntitlements"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.GetEntitlementsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.GetEntitlementsOutput.getDefaultInstance()))
              .setSchemaDescriptor(new SubscriptionQueryControllerMethodDescriptorSupplier("getEntitlements"))
              .build();
        }
      }
    }
    return getGetEntitlementsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput,
      ai.stigmer.billing.subscription.v1.PeriodEstimate> getGetPeriodEstimateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getPeriodEstimate",
      requestType = ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput.class,
      responseType = ai.stigmer.billing.subscription.v1.PeriodEstimate.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput,
      ai.stigmer.billing.subscription.v1.PeriodEstimate> getGetPeriodEstimateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput, ai.stigmer.billing.subscription.v1.PeriodEstimate> getGetPeriodEstimateMethod;
    if ((getGetPeriodEstimateMethod = SubscriptionQueryControllerGrpc.getGetPeriodEstimateMethod) == null) {
      synchronized (SubscriptionQueryControllerGrpc.class) {
        if ((getGetPeriodEstimateMethod = SubscriptionQueryControllerGrpc.getGetPeriodEstimateMethod) == null) {
          SubscriptionQueryControllerGrpc.getGetPeriodEstimateMethod = getGetPeriodEstimateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput, ai.stigmer.billing.subscription.v1.PeriodEstimate>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getPeriodEstimate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.subscription.v1.PeriodEstimate.getDefaultInstance()))
              .setSchemaDescriptor(new SubscriptionQueryControllerMethodDescriptorSupplier("getPeriodEstimate"))
              .build();
        }
      }
    }
    return getGetPeriodEstimateMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SubscriptionQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerStub>() {
        @java.lang.Override
        public SubscriptionQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionQueryControllerStub(channel, callOptions);
        }
      };
    return SubscriptionQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SubscriptionQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public SubscriptionQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SubscriptionQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SubscriptionQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerBlockingStub>() {
        @java.lang.Override
        public SubscriptionQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return SubscriptionQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SubscriptionQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SubscriptionQueryControllerFutureStub>() {
        @java.lang.Override
        public SubscriptionQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SubscriptionQueryControllerFutureStub(channel, callOptions);
        }
      };
    return SubscriptionQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get the organization's subscription.
     * NOT_FOUND when the organization has none: it is on the Free plan, which
     * is not a row. Callers that only need what the organization may do
     * should call getEntitlements, which answers for every organization.
     * </pre>
     */
    default void getForOrganization(ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetForOrganizationMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resolve what the organization is permitted right now.
     * The answer is derived, never stored: the entitlements of the plan the
     * organization's active subscription names, else the Free plan's with an
     * empty plan_id. A platform-managed organization has no subscription of
     * its own; its entitlements resolve through its identity provider to the
     * integrator organization, whose plan counts the managed organization
     * against the managed organizations it includes.
     * </pre>
     */
    default void getEntitlements(ai.stigmer.billing.subscription.v1.GetEntitlementsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetEntitlementsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Estimate what the organization's current period will be invoiced.
     * The estimate is the invoice the period would close with if no further
     * usage occurred before its end: the plan's cost over the whole period
     * (its minimum is not prorated to the time elapsed), less the commission
     * already collected on the period's usage, plus the managed organizations
     * beyond those the plan includes. It is rated by the same rule the
     * monthly close invoices by, over the same usage, so an estimate read at
     * a period's end equals that period's invoice. Every other read derives
     * it the same way; nothing is stored.
     * NOT_FOUND when the organization has no live subscription: it is on
     * Free, or it is platform-managed and on its integrator's plan, and
     * neither is invoiced a plan of its own.
     * </pre>
     */
    default void getPeriodEstimate(ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.PeriodEstimate> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetPeriodEstimateMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SubscriptionQueryController.
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public static abstract class SubscriptionQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SubscriptionQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SubscriptionQueryController.
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public static final class SubscriptionQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SubscriptionQueryControllerStub> {
    private SubscriptionQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get the organization's subscription.
     * NOT_FOUND when the organization has none: it is on the Free plan, which
     * is not a row. Callers that only need what the organization may do
     * should call getEntitlements, which answers for every organization.
     * </pre>
     */
    public void getForOrganization(ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetForOrganizationMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resolve what the organization is permitted right now.
     * The answer is derived, never stored: the entitlements of the plan the
     * organization's active subscription names, else the Free plan's with an
     * empty plan_id. A platform-managed organization has no subscription of
     * its own; its entitlements resolve through its identity provider to the
     * integrator organization, whose plan counts the managed organization
     * against the managed organizations it includes.
     * </pre>
     */
    public void getEntitlements(ai.stigmer.billing.subscription.v1.GetEntitlementsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetEntitlementsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Estimate what the organization's current period will be invoiced.
     * The estimate is the invoice the period would close with if no further
     * usage occurred before its end: the plan's cost over the whole period
     * (its minimum is not prorated to the time elapsed), less the commission
     * already collected on the period's usage, plus the managed organizations
     * beyond those the plan includes. It is rated by the same rule the
     * monthly close invoices by, over the same usage, so an estimate read at
     * a period's end equals that period's invoice. Every other read derives
     * it the same way; nothing is stored.
     * NOT_FOUND when the organization has no live subscription: it is on
     * Free, or it is platform-managed and on its integrator's plan, and
     * neither is invoiced a plan of its own.
     * </pre>
     */
    public void getPeriodEstimate(ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.PeriodEstimate> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetPeriodEstimateMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SubscriptionQueryController.
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public static final class SubscriptionQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SubscriptionQueryControllerBlockingV2Stub> {
    private SubscriptionQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get the organization's subscription.
     * NOT_FOUND when the organization has none: it is on the Free plan, which
     * is not a row. Callers that only need what the organization may do
     * should call getEntitlements, which answers for every organization.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription getForOrganization(ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetForOrganizationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resolve what the organization is permitted right now.
     * The answer is derived, never stored: the entitlements of the plan the
     * organization's active subscription names, else the Free plan's with an
     * empty plan_id. A platform-managed organization has no subscription of
     * its own; its entitlements resolve through its identity provider to the
     * integrator organization, whose plan counts the managed organization
     * against the managed organizations it includes.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.GetEntitlementsOutput getEntitlements(ai.stigmer.billing.subscription.v1.GetEntitlementsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetEntitlementsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Estimate what the organization's current period will be invoiced.
     * The estimate is the invoice the period would close with if no further
     * usage occurred before its end: the plan's cost over the whole period
     * (its minimum is not prorated to the time elapsed), less the commission
     * already collected on the period's usage, plus the managed organizations
     * beyond those the plan includes. It is rated by the same rule the
     * monthly close invoices by, over the same usage, so an estimate read at
     * a period's end equals that period's invoice. Every other read derives
     * it the same way; nothing is stored.
     * NOT_FOUND when the organization has no live subscription: it is on
     * Free, or it is platform-managed and on its integrator's plan, and
     * neither is invoiced a plan of its own.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.PeriodEstimate getPeriodEstimate(ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetPeriodEstimateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SubscriptionQueryController.
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public static final class SubscriptionQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SubscriptionQueryControllerBlockingStub> {
    private SubscriptionQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get the organization's subscription.
     * NOT_FOUND when the organization has none: it is on the Free plan, which
     * is not a row. Callers that only need what the organization may do
     * should call getEntitlements, which answers for every organization.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.Subscription getForOrganization(ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetForOrganizationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resolve what the organization is permitted right now.
     * The answer is derived, never stored: the entitlements of the plan the
     * organization's active subscription names, else the Free plan's with an
     * empty plan_id. A platform-managed organization has no subscription of
     * its own; its entitlements resolve through its identity provider to the
     * integrator organization, whose plan counts the managed organization
     * against the managed organizations it includes.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.GetEntitlementsOutput getEntitlements(ai.stigmer.billing.subscription.v1.GetEntitlementsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetEntitlementsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Estimate what the organization's current period will be invoiced.
     * The estimate is the invoice the period would close with if no further
     * usage occurred before its end: the plan's cost over the whole period
     * (its minimum is not prorated to the time elapsed), less the commission
     * already collected on the period's usage, plus the managed organizations
     * beyond those the plan includes. It is rated by the same rule the
     * monthly close invoices by, over the same usage, so an estimate read at
     * a period's end equals that period's invoice. Every other read derives
     * it the same way; nothing is stored.
     * NOT_FOUND when the organization has no live subscription: it is on
     * Free, or it is platform-managed and on its integrator's plan, and
     * neither is invoiced a plan of its own.
     * </pre>
     */
    public ai.stigmer.billing.subscription.v1.PeriodEstimate getPeriodEstimate(ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetPeriodEstimateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SubscriptionQueryController.
   * <pre>
   * SubscriptionQueryController provides the read operations on an
   * organization's subscription.
   * Every read is keyed by the organization, because an organization has at
   * most one active subscription, and authorizes on the organization with
   * can_view_billing, the permission the billing account's reads use.
   * </pre>
   */
  public static final class SubscriptionQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SubscriptionQueryControllerFutureStub> {
    private SubscriptionQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SubscriptionQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SubscriptionQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get the organization's subscription.
     * NOT_FOUND when the organization has none: it is on the Free plan, which
     * is not a row. Callers that only need what the organization may do
     * should call getEntitlements, which answers for every organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.subscription.v1.Subscription> getForOrganization(
        ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetForOrganizationMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resolve what the organization is permitted right now.
     * The answer is derived, never stored: the entitlements of the plan the
     * organization's active subscription names, else the Free plan's with an
     * empty plan_id. A platform-managed organization has no subscription of
     * its own; its entitlements resolve through its identity provider to the
     * integrator organization, whose plan counts the managed organization
     * against the managed organizations it includes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.subscription.v1.GetEntitlementsOutput> getEntitlements(
        ai.stigmer.billing.subscription.v1.GetEntitlementsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetEntitlementsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Estimate what the organization's current period will be invoiced.
     * The estimate is the invoice the period would close with if no further
     * usage occurred before its end: the plan's cost over the whole period
     * (its minimum is not prorated to the time elapsed), less the commission
     * already collected on the period's usage, plus the managed organizations
     * beyond those the plan includes. It is rated by the same rule the
     * monthly close invoices by, over the same usage, so an estimate read at
     * a period's end equals that period's invoice. Every other read derives
     * it the same way; nothing is stored.
     * NOT_FOUND when the organization has no live subscription: it is on
     * Free, or it is platform-managed and on its integrator's plan, and
     * neither is invoiced a plan of its own.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.subscription.v1.PeriodEstimate> getPeriodEstimate(
        ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetPeriodEstimateMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_FOR_ORGANIZATION = 0;
  private static final int METHODID_GET_ENTITLEMENTS = 1;
  private static final int METHODID_GET_PERIOD_ESTIMATE = 2;

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
        case METHODID_GET_FOR_ORGANIZATION:
          serviceImpl.getForOrganization((ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.Subscription>) responseObserver);
          break;
        case METHODID_GET_ENTITLEMENTS:
          serviceImpl.getEntitlements((ai.stigmer.billing.subscription.v1.GetEntitlementsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.GetEntitlementsOutput>) responseObserver);
          break;
        case METHODID_GET_PERIOD_ESTIMATE:
          serviceImpl.getPeriodEstimate((ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.subscription.v1.PeriodEstimate>) responseObserver);
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
          getGetForOrganizationMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.subscription.v1.GetSubscriptionForOrganizationInput,
              ai.stigmer.billing.subscription.v1.Subscription>(
                service, METHODID_GET_FOR_ORGANIZATION)))
        .addMethod(
          getGetEntitlementsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.subscription.v1.GetEntitlementsInput,
              ai.stigmer.billing.subscription.v1.GetEntitlementsOutput>(
                service, METHODID_GET_ENTITLEMENTS)))
        .addMethod(
          getGetPeriodEstimateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.subscription.v1.GetPeriodEstimateInput,
              ai.stigmer.billing.subscription.v1.PeriodEstimate>(
                service, METHODID_GET_PERIOD_ESTIMATE)))
        .build();
  }

  private static abstract class SubscriptionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SubscriptionQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.subscription.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SubscriptionQueryController");
    }
  }

  private static final class SubscriptionQueryControllerFileDescriptorSupplier
      extends SubscriptionQueryControllerBaseDescriptorSupplier {
    SubscriptionQueryControllerFileDescriptorSupplier() {}
  }

  private static final class SubscriptionQueryControllerMethodDescriptorSupplier
      extends SubscriptionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SubscriptionQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SubscriptionQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SubscriptionQueryControllerFileDescriptorSupplier())
              .addMethod(getGetForOrganizationMethod())
              .addMethod(getGetEntitlementsMethod())
              .addMethod(getGetPeriodEstimateMethod())
              .build();
        }
      }
    }
    return result;
  }
}
