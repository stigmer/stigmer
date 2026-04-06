package ai.stigmer.iam.invitation.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * InvitationCommandController handles write operations for invitations.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class InvitationCommandControllerGrpc {

  private InvitationCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.invitation.v1.InvitationCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.Invitation,
      ai.stigmer.iam.invitation.v1.Invitation> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.invitation.v1.Invitation.class,
      responseType = ai.stigmer.iam.invitation.v1.Invitation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.Invitation,
      ai.stigmer.iam.invitation.v1.Invitation> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.Invitation, ai.stigmer.iam.invitation.v1.Invitation> getCreateMethod;
    if ((getCreateMethod = InvitationCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (InvitationCommandControllerGrpc.class) {
        if ((getCreateMethod = InvitationCommandControllerGrpc.getCreateMethod) == null) {
          InvitationCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.Invitation, ai.stigmer.iam.invitation.v1.Invitation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitation.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitation.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId,
      ai.stigmer.iam.invitation.v1.Invitation> getRevokeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "revoke",
      requestType = ai.stigmer.iam.invitation.v1.InvitationId.class,
      responseType = ai.stigmer.iam.invitation.v1.Invitation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId,
      ai.stigmer.iam.invitation.v1.Invitation> getRevokeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.InvitationId, ai.stigmer.iam.invitation.v1.Invitation> getRevokeMethod;
    if ((getRevokeMethod = InvitationCommandControllerGrpc.getRevokeMethod) == null) {
      synchronized (InvitationCommandControllerGrpc.class) {
        if ((getRevokeMethod = InvitationCommandControllerGrpc.getRevokeMethod) == null) {
          InvitationCommandControllerGrpc.getRevokeMethod = getRevokeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.InvitationId, ai.stigmer.iam.invitation.v1.Invitation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "revoke"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.InvitationId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitation.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationCommandControllerMethodDescriptorSupplier("revoke"))
              .build();
        }
      }
    }
    return getRevokeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.RedeemInvitationInput,
      ai.stigmer.iam.invitation.v1.Invitation> getRedeemMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "redeem",
      requestType = ai.stigmer.iam.invitation.v1.RedeemInvitationInput.class,
      responseType = ai.stigmer.iam.invitation.v1.Invitation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.RedeemInvitationInput,
      ai.stigmer.iam.invitation.v1.Invitation> getRedeemMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.invitation.v1.RedeemInvitationInput, ai.stigmer.iam.invitation.v1.Invitation> getRedeemMethod;
    if ((getRedeemMethod = InvitationCommandControllerGrpc.getRedeemMethod) == null) {
      synchronized (InvitationCommandControllerGrpc.class) {
        if ((getRedeemMethod = InvitationCommandControllerGrpc.getRedeemMethod) == null) {
          InvitationCommandControllerGrpc.getRedeemMethod = getRedeemMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.invitation.v1.RedeemInvitationInput, ai.stigmer.iam.invitation.v1.Invitation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "redeem"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.RedeemInvitationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.invitation.v1.Invitation.getDefaultInstance()))
              .setSchemaDescriptor(new InvitationCommandControllerMethodDescriptorSupplier("redeem"))
              .build();
        }
      }
    }
    return getRedeemMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static InvitationCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerStub>() {
        @java.lang.Override
        public InvitationCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationCommandControllerStub(channel, callOptions);
        }
      };
    return InvitationCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static InvitationCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public InvitationCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return InvitationCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static InvitationCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerBlockingStub>() {
        @java.lang.Override
        public InvitationCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return InvitationCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static InvitationCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<InvitationCommandControllerFutureStub>() {
        @java.lang.Override
        public InvitationCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new InvitationCommandControllerFutureStub(channel, callOptions);
        }
      };
    return InvitationCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create an invitation link for an organization.
     * Generates a cryptographically random token and returns the full
     * invitation resource including the token. The invite URL is
     * constructed as: https://&lt;host&gt;/invite/&lt;token&gt;
     * The specified role must be in the organization's grantable_roles.
     * Platform-managed organizations cannot create invitations.
     * &#64;internal
     * Authorization: Requires can_grant_access permission on the organization.
     * </pre>
     */
    default void create(ai.stigmer.iam.invitation.v1.Invitation request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Revoke an active invitation, preventing further redemptions.
     * Sets the invitation state to revoked. Idempotent — revoking an
     * already-revoked invitation is a no-op.
     * &#64;internal
     * Authorization is handled in the handler: loads the invitation,
     * resolves its organization, and checks can_grant_access on the org.
     * Proto-level auth is skipped because the input (InvitationId) does
     * not directly identify the org.
     * </pre>
     */
    default void revoke(ai.stigmer.iam.invitation.v1.InvitationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRevokeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Redeem an invitation to join an organization.
     * Creates an IAM policy granting the invitation's configured role to
     * the authenticated user on the invitation's organization. The
     * redemption is atomic: the IAM policy is created and the redemption
     * count is incremented in a single operation.
     * Validation:
     * - Invitation must be in active state
     * - Invitation must not be expired
     * - Invitation must not have reached max_redemptions (if &gt; 0)
     * - Redeemer must not already be a member of the organization
     * &#64;internal
     * Authorization: The token itself is the authorization mechanism.
     * The redeemer's identity is resolved from the authentication header.
     * FGA authorization is skipped — any authenticated user with a valid
     * token can redeem.
     * </pre>
     */
    default void redeem(ai.stigmer.iam.invitation.v1.RedeemInvitationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRedeemMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service InvitationCommandController.
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public static abstract class InvitationCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return InvitationCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service InvitationCommandController.
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public static final class InvitationCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<InvitationCommandControllerStub> {
    private InvitationCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create an invitation link for an organization.
     * Generates a cryptographically random token and returns the full
     * invitation resource including the token. The invite URL is
     * constructed as: https://&lt;host&gt;/invite/&lt;token&gt;
     * The specified role must be in the organization's grantable_roles.
     * Platform-managed organizations cannot create invitations.
     * &#64;internal
     * Authorization: Requires can_grant_access permission on the organization.
     * </pre>
     */
    public void create(ai.stigmer.iam.invitation.v1.Invitation request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Revoke an active invitation, preventing further redemptions.
     * Sets the invitation state to revoked. Idempotent — revoking an
     * already-revoked invitation is a no-op.
     * &#64;internal
     * Authorization is handled in the handler: loads the invitation,
     * resolves its organization, and checks can_grant_access on the org.
     * Proto-level auth is skipped because the input (InvitationId) does
     * not directly identify the org.
     * </pre>
     */
    public void revoke(ai.stigmer.iam.invitation.v1.InvitationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRevokeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Redeem an invitation to join an organization.
     * Creates an IAM policy granting the invitation's configured role to
     * the authenticated user on the invitation's organization. The
     * redemption is atomic: the IAM policy is created and the redemption
     * count is incremented in a single operation.
     * Validation:
     * - Invitation must be in active state
     * - Invitation must not be expired
     * - Invitation must not have reached max_redemptions (if &gt; 0)
     * - Redeemer must not already be a member of the organization
     * &#64;internal
     * Authorization: The token itself is the authorization mechanism.
     * The redeemer's identity is resolved from the authentication header.
     * FGA authorization is skipped — any authenticated user with a valid
     * token can redeem.
     * </pre>
     */
    public void redeem(ai.stigmer.iam.invitation.v1.RedeemInvitationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRedeemMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service InvitationCommandController.
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public static final class InvitationCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<InvitationCommandControllerBlockingV2Stub> {
    private InvitationCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create an invitation link for an organization.
     * Generates a cryptographically random token and returns the full
     * invitation resource including the token. The invite URL is
     * constructed as: https://&lt;host&gt;/invite/&lt;token&gt;
     * The specified role must be in the organization's grantable_roles.
     * Platform-managed organizations cannot create invitations.
     * &#64;internal
     * Authorization: Requires can_grant_access permission on the organization.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation create(ai.stigmer.iam.invitation.v1.Invitation request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke an active invitation, preventing further redemptions.
     * Sets the invitation state to revoked. Idempotent — revoking an
     * already-revoked invitation is a no-op.
     * &#64;internal
     * Authorization is handled in the handler: loads the invitation,
     * resolves its organization, and checks can_grant_access on the org.
     * Proto-level auth is skipped because the input (InvitationId) does
     * not directly identify the org.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation revoke(ai.stigmer.iam.invitation.v1.InvitationId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRevokeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Redeem an invitation to join an organization.
     * Creates an IAM policy granting the invitation's configured role to
     * the authenticated user on the invitation's organization. The
     * redemption is atomic: the IAM policy is created and the redemption
     * count is incremented in a single operation.
     * Validation:
     * - Invitation must be in active state
     * - Invitation must not be expired
     * - Invitation must not have reached max_redemptions (if &gt; 0)
     * - Redeemer must not already be a member of the organization
     * &#64;internal
     * Authorization: The token itself is the authorization mechanism.
     * The redeemer's identity is resolved from the authentication header.
     * FGA authorization is skipped — any authenticated user with a valid
     * token can redeem.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation redeem(ai.stigmer.iam.invitation.v1.RedeemInvitationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRedeemMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service InvitationCommandController.
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public static final class InvitationCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<InvitationCommandControllerBlockingStub> {
    private InvitationCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create an invitation link for an organization.
     * Generates a cryptographically random token and returns the full
     * invitation resource including the token. The invite URL is
     * constructed as: https://&lt;host&gt;/invite/&lt;token&gt;
     * The specified role must be in the organization's grantable_roles.
     * Platform-managed organizations cannot create invitations.
     * &#64;internal
     * Authorization: Requires can_grant_access permission on the organization.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation create(ai.stigmer.iam.invitation.v1.Invitation request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke an active invitation, preventing further redemptions.
     * Sets the invitation state to revoked. Idempotent — revoking an
     * already-revoked invitation is a no-op.
     * &#64;internal
     * Authorization is handled in the handler: loads the invitation,
     * resolves its organization, and checks can_grant_access on the org.
     * Proto-level auth is skipped because the input (InvitationId) does
     * not directly identify the org.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation revoke(ai.stigmer.iam.invitation.v1.InvitationId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRevokeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Redeem an invitation to join an organization.
     * Creates an IAM policy granting the invitation's configured role to
     * the authenticated user on the invitation's organization. The
     * redemption is atomic: the IAM policy is created and the redemption
     * count is incremented in a single operation.
     * Validation:
     * - Invitation must be in active state
     * - Invitation must not be expired
     * - Invitation must not have reached max_redemptions (if &gt; 0)
     * - Redeemer must not already be a member of the organization
     * &#64;internal
     * Authorization: The token itself is the authorization mechanism.
     * The redeemer's identity is resolved from the authentication header.
     * FGA authorization is skipped — any authenticated user with a valid
     * token can redeem.
     * </pre>
     */
    public ai.stigmer.iam.invitation.v1.Invitation redeem(ai.stigmer.iam.invitation.v1.RedeemInvitationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRedeemMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service InvitationCommandController.
   * <pre>
   * InvitationCommandController handles write operations for invitations.
   * </pre>
   */
  public static final class InvitationCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<InvitationCommandControllerFutureStub> {
    private InvitationCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected InvitationCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new InvitationCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create an invitation link for an organization.
     * Generates a cryptographically random token and returns the full
     * invitation resource including the token. The invite URL is
     * constructed as: https://&lt;host&gt;/invite/&lt;token&gt;
     * The specified role must be in the organization's grantable_roles.
     * Platform-managed organizations cannot create invitations.
     * &#64;internal
     * Authorization: Requires can_grant_access permission on the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.Invitation> create(
        ai.stigmer.iam.invitation.v1.Invitation request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Revoke an active invitation, preventing further redemptions.
     * Sets the invitation state to revoked. Idempotent — revoking an
     * already-revoked invitation is a no-op.
     * &#64;internal
     * Authorization is handled in the handler: loads the invitation,
     * resolves its organization, and checks can_grant_access on the org.
     * Proto-level auth is skipped because the input (InvitationId) does
     * not directly identify the org.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.Invitation> revoke(
        ai.stigmer.iam.invitation.v1.InvitationId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRevokeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Redeem an invitation to join an organization.
     * Creates an IAM policy granting the invitation's configured role to
     * the authenticated user on the invitation's organization. The
     * redemption is atomic: the IAM policy is created and the redemption
     * count is incremented in a single operation.
     * Validation:
     * - Invitation must be in active state
     * - Invitation must not be expired
     * - Invitation must not have reached max_redemptions (if &gt; 0)
     * - Redeemer must not already be a member of the organization
     * &#64;internal
     * Authorization: The token itself is the authorization mechanism.
     * The redeemer's identity is resolved from the authentication header.
     * FGA authorization is skipped — any authenticated user with a valid
     * token can redeem.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.invitation.v1.Invitation> redeem(
        ai.stigmer.iam.invitation.v1.RedeemInvitationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRedeemMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_REVOKE = 1;
  private static final int METHODID_REDEEM = 2;

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
          serviceImpl.create((ai.stigmer.iam.invitation.v1.Invitation) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation>) responseObserver);
          break;
        case METHODID_REVOKE:
          serviceImpl.revoke((ai.stigmer.iam.invitation.v1.InvitationId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation>) responseObserver);
          break;
        case METHODID_REDEEM:
          serviceImpl.redeem((ai.stigmer.iam.invitation.v1.RedeemInvitationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.invitation.v1.Invitation>) responseObserver);
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
              ai.stigmer.iam.invitation.v1.Invitation,
              ai.stigmer.iam.invitation.v1.Invitation>(
                service, METHODID_CREATE)))
        .addMethod(
          getRevokeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.invitation.v1.InvitationId,
              ai.stigmer.iam.invitation.v1.Invitation>(
                service, METHODID_REVOKE)))
        .addMethod(
          getRedeemMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.invitation.v1.RedeemInvitationInput,
              ai.stigmer.iam.invitation.v1.Invitation>(
                service, METHODID_REDEEM)))
        .build();
  }

  private static abstract class InvitationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    InvitationCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.invitation.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("InvitationCommandController");
    }
  }

  private static final class InvitationCommandControllerFileDescriptorSupplier
      extends InvitationCommandControllerBaseDescriptorSupplier {
    InvitationCommandControllerFileDescriptorSupplier() {}
  }

  private static final class InvitationCommandControllerMethodDescriptorSupplier
      extends InvitationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    InvitationCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (InvitationCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new InvitationCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getRevokeMethod())
              .addMethod(getRedeemMethod())
              .build();
        }
      }
    }
    return result;
  }
}
