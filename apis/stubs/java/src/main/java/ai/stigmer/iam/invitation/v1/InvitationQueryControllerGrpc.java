package ai.stigmer.iam.invitation.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * InvitationQueryController handles read operations for invitations.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class InvitationQueryControllerGrpc {

  private InvitationQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.invitation.v1.InvitationQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId,
      ai.stigmer.iam.invitation.v1.Invitation> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.iam.invitation.v1.InvitationId.class,
      responseType = ai.stigmer.iam.invitation.v1.Invitation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId,
      ai.stigmer.iam.invitation.v1.Invitation> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId, ai.stigmer.iam.invitation.v1.Invitation> getGetMethod;
    if ((getGetMethod = InvitationQueryControllerGrpc.getGetMethod) == null) {
      synchronized (InvitationQueryControllerGrpc.class) {
        if ((getGetMethod = InvitationQueryControllerGrpc.getGetMethod) == null) {
          InvitationQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.InvitationId, ai.stigmer.iam.invitation.v1.Invitation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.InvitationId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitation.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput,
      ai.stigmer.iam.invitation.v1.Invitations> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput.class,
      responseType = ai.stigmer.iam.invitation.v1.Invitations.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput,
      ai.stigmer.iam.invitation.v1.Invitations> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput, ai.stigmer.iam.invitation.v1.Invitations> getListByOrgMethod;
    if ((getListByOrgMethod = InvitationQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (InvitationQueryControllerGrpc.class) {
        if ((getListByOrgMethod = InvitationQueryControllerGrpc.getListByOrgMethod) == null) {
          InvitationQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput, ai.stigmer.iam.invitation.v1.Invitations>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitations.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationTokenInput,
      ai.stigmer.iam.invitation.v1.InvitationPreview> getGetByTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByToken",
      requestType = ai.stigmer.iam.invitation.v1.InvitationTokenInput.class,
      responseType = ai.stigmer.iam.invitation.v1.InvitationPreview.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationTokenInput,
      ai.stigmer.iam.invitation.v1.InvitationPreview> getGetByTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationTokenInput, ai.stigmer.iam.invitation.v1.InvitationPreview> getGetByTokenMethod;
    if ((getGetByTokenMethod = InvitationQueryControllerGrpc.getGetByTokenMethod) == null) {
      synchronized (InvitationQueryControllerGrpc.class) {
        if ((getGetByTokenMethod = InvitationQueryControllerGrpc.getGetByTokenMethod) == null) {
          InvitationQueryControllerGrpc.getGetByTokenMethod = getGetByTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.InvitationTokenInput, ai.stigmer.iam.invitation.v1.InvitationPreview>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.InvitationTokenInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.InvitationPreview.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationQueryControllerMethodDescriptorSupplier("getByToken"))
              .build();
        }
      }
    }
    return getGetByTokenMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static InvitationQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerStub>() {
        @java.lang.Override
        public InvitationQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationQueryControllerStub(channel, callOptions);
        }
      };
    return InvitationQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static InvitationQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public InvitationQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return InvitationQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static InvitationQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerBlockingStub>() {
        @java.lang.Override
        public InvitationQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return InvitationQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static InvitationQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationQueryControllerFutureStub>() {
        @java.lang.Override
        public InvitationQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationQueryControllerFutureStub(channel, callOptions);
        }
      };
    return InvitationQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an invitation by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the invitation resource.
     * </pre>
     */
    default void get(ai.stigmer.iam.invitation.v1.InvitationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all invitations belonging to an organization.
     * Returns invitations ordered by creation time (newest first).
     * &#64;internal
     * Authorization: Requires can_view_access permission on the organization.
     * This is intentionally stricter than can_view — only users who can
     * manage org access (admins and owners) should see invitation links.
     * </pre>
     */
    default void listByOrg(ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitations> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a preview of an invitation by its shareable token.
     * Returns a safe projection (InvitationPreview) containing only the
     * information needed to render the invite acceptance page: organization
     * name, logo, the role being offered, and whether the invitation is
     * still valid.
     * This endpoint is called by the web app's invite page before the user
     * has authenticated, so it requires no authorization. The response
     * intentionally omits the token value, redemption history, and internal
     * invitation metadata.
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for rendering
     * the invite acceptance page. Uses is_skip_authorization following the
     * getSsoProvider precedent.
     * </pre>
     */
    default void getByToken(ai.stigmer.iam.invitation.v1.InvitationTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.InvitationPreview> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByTokenMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service InvitationQueryController.
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public static abstract class InvitationQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return InvitationQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service InvitationQueryController.
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public static final class InvitationQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<InvitationQueryControllerStub> {
    private InvitationQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an invitation by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the invitation resource.
     * </pre>
     */
    public void get(ai.stigmer.iam.invitation.v1.InvitationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all invitations belonging to an organization.
     * Returns invitations ordered by creation time (newest first).
     * &#64;internal
     * Authorization: Requires can_view_access permission on the organization.
     * This is intentionally stricter than can_view — only users who can
     * manage org access (admins and owners) should see invitation links.
     * </pre>
     */
    public void listByOrg(ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitations> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a preview of an invitation by its shareable token.
     * Returns a safe projection (InvitationPreview) containing only the
     * information needed to render the invite acceptance page: organization
     * name, logo, the role being offered, and whether the invitation is
     * still valid.
     * This endpoint is called by the web app's invite page before the user
     * has authenticated, so it requires no authorization. The response
     * intentionally omits the token value, redemption history, and internal
     * invitation metadata.
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for rendering
     * the invite acceptance page. Uses is_skip_authorization following the
     * getSsoProvider precedent.
     * </pre>
     */
    public void getByToken(ai.stigmer.iam.invitation.v1.InvitationTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.InvitationPreview> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByTokenMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service InvitationQueryController.
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public static final class InvitationQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<InvitationQueryControllerBlockingV2Stub> {
    private InvitationQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an invitation by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the invitation resource.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation get(ai.stigmer.iam.invitation.v1.InvitationId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all invitations belonging to an organization.
     * Returns invitations ordered by creation time (newest first).
     * &#64;internal
     * Authorization: Requires can_view_access permission on the organization.
     * This is intentionally stricter than can_view — only users who can
     * manage org access (admins and owners) should see invitation links.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitations listByOrg(ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a preview of an invitation by its shareable token.
     * Returns a safe projection (InvitationPreview) containing only the
     * information needed to render the invite acceptance page: organization
     * name, logo, the role being offered, and whether the invitation is
     * still valid.
     * This endpoint is called by the web app's invite page before the user
     * has authenticated, so it requires no authorization. The response
     * intentionally omits the token value, redemption history, and internal
     * invitation metadata.
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for rendering
     * the invite acceptance page. Uses is_skip_authorization following the
     * getSsoProvider precedent.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.InvitationPreview getByToken(ai.stigmer.iam.invitation.v1.InvitationTokenInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service InvitationQueryController.
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public static final class InvitationQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<InvitationQueryControllerBlockingStub> {
    private InvitationQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an invitation by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the invitation resource.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation get(ai.stigmer.iam.invitation.v1.InvitationId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all invitations belonging to an organization.
     * Returns invitations ordered by creation time (newest first).
     * &#64;internal
     * Authorization: Requires can_view_access permission on the organization.
     * This is intentionally stricter than can_view — only users who can
     * manage org access (admins and owners) should see invitation links.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitations listByOrg(ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a preview of an invitation by its shareable token.
     * Returns a safe projection (InvitationPreview) containing only the
     * information needed to render the invite acceptance page: organization
     * name, logo, the role being offered, and whether the invitation is
     * still valid.
     * This endpoint is called by the web app's invite page before the user
     * has authenticated, so it requires no authorization. The response
     * intentionally omits the token value, redemption history, and internal
     * invitation metadata.
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for rendering
     * the invite acceptance page. Uses is_skip_authorization following the
     * getSsoProvider precedent.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.InvitationPreview getByToken(ai.stigmer.iam.invitation.v1.InvitationTokenInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service InvitationQueryController.
   * <pre>
   * InvitationQueryController handles read operations for invitations.
   * </pre>
   */
  public static final class InvitationQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<InvitationQueryControllerFutureStub> {
    private InvitationQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an invitation by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the invitation resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.Invitation> get(
        ai.stigmer.iam.invitation.v1.InvitationId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all invitations belonging to an organization.
     * Returns invitations ordered by creation time (newest first).
     * &#64;internal
     * Authorization: Requires can_view_access permission on the organization.
     * This is intentionally stricter than can_view — only users who can
     * manage org access (admins and owners) should see invitation links.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.Invitations> listByOrg(
        ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a preview of an invitation by its shareable token.
     * Returns a safe projection (InvitationPreview) containing only the
     * information needed to render the invite acceptance page: organization
     * name, logo, the role being offered, and whether the invitation is
     * still valid.
     * This endpoint is called by the web app's invite page before the user
     * has authenticated, so it requires no authorization. The response
     * intentionally omits the token value, redemption history, and internal
     * invitation metadata.
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for rendering
     * the invite acceptance page. Uses is_skip_authorization following the
     * getSsoProvider precedent.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.InvitationPreview> getByToken(
        ai.stigmer.iam.invitation.v1.InvitationTokenInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByTokenMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_BY_ORG = 1;
  private static final int METHODID_GET_BY_TOKEN = 2;

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
          serviceImpl.get((ai.stigmer.iam.invitation.v1.InvitationId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitations>) responseObserver);
          break;
        case METHODID_GET_BY_TOKEN:
          serviceImpl.getByToken((ai.stigmer.iam.invitation.v1.InvitationTokenInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.InvitationPreview>) responseObserver);
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
              ai.stigmer.iam.invitation.v1.InvitationId,
              ai.stigmer.iam.invitation.v1.Invitation>(
                service, METHODID_GET)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.invitation.v1.ListInvitationsByOrgInput,
              ai.stigmer.iam.invitation.v1.Invitations>(
                service, METHODID_LIST_BY_ORG)))
        .addMethod(
          getGetByTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.invitation.v1.InvitationTokenInput,
              ai.stigmer.iam.invitation.v1.InvitationPreview>(
                service, METHODID_GET_BY_TOKEN)))
        .build();
  }

  private static abstract class InvitationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    InvitationQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.invitation.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("InvitationQueryController");
    }
  }

  private static final class InvitationQueryControllerFileDescriptorSupplier
      extends InvitationQueryControllerBaseDescriptorSupplier {
    InvitationQueryControllerFileDescriptorSupplier() {}
  }

  private static final class InvitationQueryControllerMethodDescriptorSupplier
      extends InvitationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    InvitationQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (InvitationQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new InvitationQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListByOrgMethod())
              .addMethod(getGetByTokenMethod())
              .build();
        }
      }
    }
    return result;
  }
}
