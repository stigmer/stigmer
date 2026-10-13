package ai.stigmer.iam.identityprovider.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IdentityProviderCommandController provides write operations for identity providers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityProviderCommandControllerGrpc {

  private IdentityProviderCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityprovider.v1.IdentityProviderCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod;
    if ((getApplyMethod = IdentityProviderCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getApplyMethod = IdentityProviderCommandControllerGrpc.getApplyMethod) == null) {
          IdentityProviderCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod;
    if ((getCreateMethod = IdentityProviderCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getCreateMethod = IdentityProviderCommandControllerGrpc.getCreateMethod) == null) {
          IdentityProviderCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;
    if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
          IdentityProviderCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getRenameMethod;
    if ((getRenameMethod = IdentityProviderCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getRenameMethod = IdentityProviderCommandControllerGrpc.getRenameMethod) == null) {
          IdentityProviderCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod;
    if ((getDeleteMethod = IdentityProviderCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getDeleteMethod = IdentityProviderCommandControllerGrpc.getDeleteMethod) == null) {
          IdentityProviderCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.AccessMoveRequest,
      ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> getCreateAccessMoveMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createAccessMove",
      requestType = ai.stigmer.iam.identityprovider.v1.AccessMoveRequest.class,
      responseType = ai.stigmer.iam.identityprovider.v1.AccessMoveTicket.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.AccessMoveRequest,
      ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> getCreateAccessMoveMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.AccessMoveRequest, ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> getCreateAccessMoveMethod;
    if ((getCreateAccessMoveMethod = IdentityProviderCommandControllerGrpc.getCreateAccessMoveMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getCreateAccessMoveMethod = IdentityProviderCommandControllerGrpc.getCreateAccessMoveMethod) == null) {
          IdentityProviderCommandControllerGrpc.getCreateAccessMoveMethod = getCreateAccessMoveMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.AccessMoveRequest, ai.stigmer.iam.identityprovider.v1.AccessMoveTicket>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createAccessMove"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.AccessMoveRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.AccessMoveTicket.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("createAccessMove"))
              .build();
        }
      }
    }
    return getCreateAccessMoveMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput,
      ai.stigmer.iam.identityprovider.v1.AccessMoveResult> getRedeemAccessMoveMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "redeemAccessMove",
      requestType = ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.AccessMoveResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput,
      ai.stigmer.iam.identityprovider.v1.AccessMoveResult> getRedeemAccessMoveMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput, ai.stigmer.iam.identityprovider.v1.AccessMoveResult> getRedeemAccessMoveMethod;
    if ((getRedeemAccessMoveMethod = IdentityProviderCommandControllerGrpc.getRedeemAccessMoveMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getRedeemAccessMoveMethod = IdentityProviderCommandControllerGrpc.getRedeemAccessMoveMethod) == null) {
          IdentityProviderCommandControllerGrpc.getRedeemAccessMoveMethod = getRedeemAccessMoveMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput, ai.stigmer.iam.identityprovider.v1.AccessMoveResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "redeemAccessMove"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.AccessMoveResult.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("redeemAccessMove"))
              .build();
        }
      }
    }
    return getRedeemAccessMoveMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityProviderCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityProviderCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityProviderCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityProviderCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerFutureStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an identity provider.
     * If the resource does not exist, creates a new identity provider.
     * If the resource exists, updates the existing identity provider.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of an identity provider in its
     * organization updates that identity provider, and its slug changes only
     * through rename. A slug the identity provider was renamed away from, named
     * without the identity provider's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second identity provider:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     identity provider for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an identity provider.
     * The creator's organization owns the identity provider.
     * On Stigmer Enterprise, a new identity provider is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     identity provider that exists keeps signing people in. No metadata.
     * A slug another identity provider of the organization holds is refused with
     * ALREADY_EXISTS. A slug another identity provider was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another identity provider held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * A create that sets sso_required also needs can_assign_roles on the
     * organization, which only its owners hold (PERMISSION_DENIED otherwise):
     * requiring sign-in through a provider decides how every member gets in.
     * Where the organization's plan decides it, a plan without SSO
     * enforcement refuses it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     SSO enforcement. Metadata: feature ("sso_enforcement"), org.
     * </pre>
     */
    default void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an identity provider: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update whose only change is turning sso_required off is never
     * refused this way: an organization may always stop requiring its SSO
     * provider.
     * An update that changes sso_required, or that changes whom a provider
     * with sso_required on trusts (allowed_issuers, jwks_uri,
     * expected_audience), also needs can_assign_roles on the organization,
     * which only its owners hold (PERMISSION_DENIED otherwise).
     * Turning it on is refused with PLAN_UPGRADE_REQUIRED where the
     * organization's plan does not include SSO enforcement (see create);
     * an organization that already requires it keeps it, and may always
     * turn it off.
     * resource.metadata.id names the identity provider; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the identity provider does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the identity provider changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the identity provider kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename an identity provider: change its slug, the name people type.
     * The identity provider keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the identity provider for reading for 30 days, during which no
     * other identity provider of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another identity provider
     * holds is refused with ALREADY_EXISTS, and one another identity provider was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * The federated accounts the provider vouches for are
     * deleted with it, with every role they hold, so a provider created again
     * under the same slug inherits none of them.
     * Deleting a provider that sets sso_required ends the requirement, so it
     * also needs can_assign_roles on the organization, which only its owners
     * hold (PERMISSION_DENIED otherwise).
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start moving your access in an organization to the account its SSO
     * provider signs you in as.
     * For someone who worked in an organization under another sign-in (an
     * email login) before the organization connected its SSO provider. The
     * caller, signed in the old way, asks for a ticket; the answer says what
     * the move will do (AccessMoveTicket.preview: the access that moves, the
     * My vault entries it deletes, the automations that stop); the person
     * then signs in through the organization's SSO provider and redeems the
     * ticket with redeemAccessMove. The ticket works once, for ten minutes,
     * for this account and this organization only.
     * Refused with FAILED_PRECONDITION when the caller holds no access in the
     * organization, is one of its owners (owners keep their own sign-in), or
     * already signed in through an SSO provider; with NOT_FOUND when the
     * organization has no SSO provider (the same copy getSsoProvider answers).
     * </pre>
     */
    default void createAccessMove(ai.stigmer.iam.identityprovider.v1.AccessMoveRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateAccessMoveMethod(), responseObserver);
    }

    /**
     * <pre>
     * Redeem an access move ticket: the access it names moves to the caller.
     * The caller must be signed in through the organization's SSO provider,
     * as the account it made for them; anyone else is refused with
     * PERMISSION_DENIED and the ticket stays usable until it expires. A
     * ticket that is unknown, expired or already redeemed is refused with
     * FAILED_PRECONDITION. A move that stops partway may be redeemed again
     * with the same ticket while it lasts, and completes.
     * Every change is recorded in the organization's permission history as a
     * move, acting for the caller.
     * </pre>
     */
    default void redeemAccessMove(ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveResult> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRedeemAccessMoveMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static abstract class IdentityProviderCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityProviderCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityProviderCommandControllerStub> {
    private IdentityProviderCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider.
     * If the resource does not exist, creates a new identity provider.
     * If the resource exists, updates the existing identity provider.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of an identity provider in its
     * organization updates that identity provider, and its slug changes only
     * through rename. A slug the identity provider was renamed away from, named
     * without the identity provider's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second identity provider:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     identity provider for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public void apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an identity provider.
     * The creator's organization owns the identity provider.
     * On Stigmer Enterprise, a new identity provider is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     identity provider that exists keeps signing people in. No metadata.
     * A slug another identity provider of the organization holds is refused with
     * ALREADY_EXISTS. A slug another identity provider was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another identity provider held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * A create that sets sso_required also needs can_assign_roles on the
     * organization, which only its owners hold (PERMISSION_DENIED otherwise):
     * requiring sign-in through a provider decides how every member gets in.
     * Where the organization's plan decides it, a plan without SSO
     * enforcement refuses it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     SSO enforcement. Metadata: feature ("sso_enforcement"), org.
     * </pre>
     */
    public void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an identity provider: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update whose only change is turning sso_required off is never
     * refused this way: an organization may always stop requiring its SSO
     * provider.
     * An update that changes sso_required, or that changes whom a provider
     * with sso_required on trusts (allowed_issuers, jwks_uri,
     * expected_audience), also needs can_assign_roles on the organization,
     * which only its owners hold (PERMISSION_DENIED otherwise).
     * Turning it on is refused with PLAN_UPGRADE_REQUIRED where the
     * organization's plan does not include SSO enforcement (see create);
     * an organization that already requires it keeps it, and may always
     * turn it off.
     * resource.metadata.id names the identity provider; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the identity provider does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the identity provider changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the identity provider kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename an identity provider: change its slug, the name people type.
     * The identity provider keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the identity provider for reading for 30 days, during which no
     * other identity provider of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another identity provider
     * holds is refused with ALREADY_EXISTS, and one another identity provider was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * The federated accounts the provider vouches for are
     * deleted with it, with every role they hold, so a provider created again
     * under the same slug inherits none of them.
     * Deleting a provider that sets sso_required ends the requirement, so it
     * also needs can_assign_roles on the organization, which only its owners
     * hold (PERMISSION_DENIED otherwise).
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start moving your access in an organization to the account its SSO
     * provider signs you in as.
     * For someone who worked in an organization under another sign-in (an
     * email login) before the organization connected its SSO provider. The
     * caller, signed in the old way, asks for a ticket; the answer says what
     * the move will do (AccessMoveTicket.preview: the access that moves, the
     * My vault entries it deletes, the automations that stop); the person
     * then signs in through the organization's SSO provider and redeems the
     * ticket with redeemAccessMove. The ticket works once, for ten minutes,
     * for this account and this organization only.
     * Refused with FAILED_PRECONDITION when the caller holds no access in the
     * organization, is one of its owners (owners keep their own sign-in), or
     * already signed in through an SSO provider; with NOT_FOUND when the
     * organization has no SSO provider (the same copy getSsoProvider answers).
     * </pre>
     */
    public void createAccessMove(ai.stigmer.iam.identityprovider.v1.AccessMoveRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateAccessMoveMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Redeem an access move ticket: the access it names moves to the caller.
     * The caller must be signed in through the organization's SSO provider,
     * as the account it made for them; anyone else is refused with
     * PERMISSION_DENIED and the ticket stays usable until it expires. A
     * ticket that is unknown, expired or already redeemed is refused with
     * FAILED_PRECONDITION. A move that stops partway may be redeemed again
     * with the same ticket while it lasts, and completes.
     * Every change is recorded in the organization's permission history as a
     * move, acting for the caller.
     * </pre>
     */
    public void redeemAccessMove(ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveResult> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRedeemAccessMoveMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderCommandControllerBlockingV2Stub> {
    private IdentityProviderCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider.
     * If the resource does not exist, creates a new identity provider.
     * If the resource exists, updates the existing identity provider.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of an identity provider in its
     * organization updates that identity provider, and its slug changes only
     * through rename. A slug the identity provider was renamed away from, named
     * without the identity provider's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second identity provider:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     identity provider for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an identity provider.
     * The creator's organization owns the identity provider.
     * On Stigmer Enterprise, a new identity provider is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     identity provider that exists keeps signing people in. No metadata.
     * A slug another identity provider of the organization holds is refused with
     * ALREADY_EXISTS. A slug another identity provider was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another identity provider held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * A create that sets sso_required also needs can_assign_roles on the
     * organization, which only its owners hold (PERMISSION_DENIED otherwise):
     * requiring sign-in through a provider decides how every member gets in.
     * Where the organization's plan decides it, a plan without SSO
     * enforcement refuses it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     SSO enforcement. Metadata: feature ("sso_enforcement"), org.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an identity provider: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update whose only change is turning sso_required off is never
     * refused this way: an organization may always stop requiring its SSO
     * provider.
     * An update that changes sso_required, or that changes whom a provider
     * with sso_required on trusts (allowed_issuers, jwks_uri,
     * expected_audience), also needs can_assign_roles on the organization,
     * which only its owners hold (PERMISSION_DENIED otherwise).
     * Turning it on is refused with PLAN_UPGRADE_REQUIRED where the
     * organization's plan does not include SSO enforcement (see create);
     * an organization that already requires it keeps it, and may always
     * turn it off.
     * resource.metadata.id names the identity provider; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the identity provider does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the identity provider changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the identity provider kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an identity provider: change its slug, the name people type.
     * The identity provider keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the identity provider for reading for 30 days, during which no
     * other identity provider of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another identity provider
     * holds is refused with ALREADY_EXISTS, and one another identity provider was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * The federated accounts the provider vouches for are
     * deleted with it, with every role they hold, so a provider created again
     * under the same slug inherits none of them.
     * Deleting a provider that sets sso_required ends the requirement, so it
     * also needs can_assign_roles on the organization, which only its owners
     * hold (PERMISSION_DENIED otherwise).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start moving your access in an organization to the account its SSO
     * provider signs you in as.
     * For someone who worked in an organization under another sign-in (an
     * email login) before the organization connected its SSO provider. The
     * caller, signed in the old way, asks for a ticket; the answer says what
     * the move will do (AccessMoveTicket.preview: the access that moves, the
     * My vault entries it deletes, the automations that stop); the person
     * then signs in through the organization's SSO provider and redeems the
     * ticket with redeemAccessMove. The ticket works once, for ten minutes,
     * for this account and this organization only.
     * Refused with FAILED_PRECONDITION when the caller holds no access in the
     * organization, is one of its owners (owners keep their own sign-in), or
     * already signed in through an SSO provider; with NOT_FOUND when the
     * organization has no SSO provider (the same copy getSsoProvider answers).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.AccessMoveTicket createAccessMove(ai.stigmer.iam.identityprovider.v1.AccessMoveRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateAccessMoveMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Redeem an access move ticket: the access it names moves to the caller.
     * The caller must be signed in through the organization's SSO provider,
     * as the account it made for them; anyone else is refused with
     * PERMISSION_DENIED and the ticket stays usable until it expires. A
     * ticket that is unknown, expired or already redeemed is refused with
     * FAILED_PRECONDITION. A move that stops partway may be redeemed again
     * with the same ticket while it lasts, and completes.
     * Every change is recorded in the organization's permission history as a
     * move, acting for the caller.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.AccessMoveResult redeemAccessMove(ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRedeemAccessMoveMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderCommandControllerBlockingStub> {
    private IdentityProviderCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider.
     * If the resource does not exist, creates a new identity provider.
     * If the resource exists, updates the existing identity provider.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of an identity provider in its
     * organization updates that identity provider, and its slug changes only
     * through rename. A slug the identity provider was renamed away from, named
     * without the identity provider's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second identity provider:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     identity provider for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an identity provider.
     * The creator's organization owns the identity provider.
     * On Stigmer Enterprise, a new identity provider is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     identity provider that exists keeps signing people in. No metadata.
     * A slug another identity provider of the organization holds is refused with
     * ALREADY_EXISTS. A slug another identity provider was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another identity provider held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * A create that sets sso_required also needs can_assign_roles on the
     * organization, which only its owners hold (PERMISSION_DENIED otherwise):
     * requiring sign-in through a provider decides how every member gets in.
     * Where the organization's plan decides it, a plan without SSO
     * enforcement refuses it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     SSO enforcement. Metadata: feature ("sso_enforcement"), org.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an identity provider: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update whose only change is turning sso_required off is never
     * refused this way: an organization may always stop requiring its SSO
     * provider.
     * An update that changes sso_required, or that changes whom a provider
     * with sso_required on trusts (allowed_issuers, jwks_uri,
     * expected_audience), also needs can_assign_roles on the organization,
     * which only its owners hold (PERMISSION_DENIED otherwise).
     * Turning it on is refused with PLAN_UPGRADE_REQUIRED where the
     * organization's plan does not include SSO enforcement (see create);
     * an organization that already requires it keeps it, and may always
     * turn it off.
     * resource.metadata.id names the identity provider; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the identity provider does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the identity provider changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the identity provider kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an identity provider: change its slug, the name people type.
     * The identity provider keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the identity provider for reading for 30 days, during which no
     * other identity provider of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another identity provider
     * holds is refused with ALREADY_EXISTS, and one another identity provider was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * The federated accounts the provider vouches for are
     * deleted with it, with every role they hold, so a provider created again
     * under the same slug inherits none of them.
     * Deleting a provider that sets sso_required ends the requirement, so it
     * also needs can_assign_roles on the organization, which only its owners
     * hold (PERMISSION_DENIED otherwise).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start moving your access in an organization to the account its SSO
     * provider signs you in as.
     * For someone who worked in an organization under another sign-in (an
     * email login) before the organization connected its SSO provider. The
     * caller, signed in the old way, asks for a ticket; the answer says what
     * the move will do (AccessMoveTicket.preview: the access that moves, the
     * My vault entries it deletes, the automations that stop); the person
     * then signs in through the organization's SSO provider and redeems the
     * ticket with redeemAccessMove. The ticket works once, for ten minutes,
     * for this account and this organization only.
     * Refused with FAILED_PRECONDITION when the caller holds no access in the
     * organization, is one of its owners (owners keep their own sign-in), or
     * already signed in through an SSO provider; with NOT_FOUND when the
     * organization has no SSO provider (the same copy getSsoProvider answers).
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.AccessMoveTicket createAccessMove(ai.stigmer.iam.identityprovider.v1.AccessMoveRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateAccessMoveMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Redeem an access move ticket: the access it names moves to the caller.
     * The caller must be signed in through the organization's SSO provider,
     * as the account it made for them; anyone else is refused with
     * PERMISSION_DENIED and the ticket stays usable until it expires. A
     * ticket that is unknown, expired or already redeemed is refused with
     * FAILED_PRECONDITION. A move that stops partway may be redeemed again
     * with the same ticket while it lasts, and completes.
     * Every change is recorded in the organization's permission history as a
     * move, acting for the caller.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.AccessMoveResult redeemAccessMove(ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRedeemAccessMoveMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityProviderCommandControllerFutureStub> {
    private IdentityProviderCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider.
     * If the resource does not exist, creates a new identity provider.
     * If the resource exists, updates the existing identity provider.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of an identity provider in its
     * organization updates that identity provider, and its slug changes only
     * through rename. A slug the identity provider was renamed away from, named
     * without the identity provider's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second identity provider:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     identity provider for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> apply(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an identity provider.
     * The creator's organization owns the identity provider.
     * On Stigmer Enterprise, a new identity provider is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     identity provider that exists keeps signing people in. No metadata.
     * A slug another identity provider of the organization holds is refused with
     * ALREADY_EXISTS. A slug another identity provider was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another identity provider held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * A create that sets sso_required also needs can_assign_roles on the
     * organization, which only its owners hold (PERMISSION_DENIED otherwise):
     * requiring sign-in through a provider decides how every member gets in.
     * Where the organization's plan decides it, a plan without SSO
     * enforcement refuses it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     SSO enforcement. Metadata: feature ("sso_enforcement"), org.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> create(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an identity provider: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update whose only change is turning sso_required off is never
     * refused this way: an organization may always stop requiring its SSO
     * provider.
     * An update that changes sso_required, or that changes whom a provider
     * with sso_required on trusts (allowed_issuers, jwks_uri,
     * expected_audience), also needs can_assign_roles on the organization,
     * which only its owners hold (PERMISSION_DENIED otherwise).
     * Turning it on is refused with PLAN_UPGRADE_REQUIRED where the
     * organization's plan does not include SSO enforcement (see create);
     * an organization that already requires it keeps it, and may always
     * turn it off.
     * resource.metadata.id names the identity provider; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the identity provider does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the identity provider changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the identity provider kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> update(
        ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename an identity provider: change its slug, the name people type.
     * The identity provider keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the identity provider for reading for 30 days, during which no
     * other identity provider of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another identity provider
     * holds is refused with ALREADY_EXISTS, and one another identity provider was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * The federated accounts the provider vouches for are
     * deleted with it, with every role they hold, so a provider created again
     * under the same slug inherits none of them.
     * Deleting a provider that sets sso_required ends the requirement, so it
     * also needs can_assign_roles on the organization, which only its owners
     * hold (PERMISSION_DENIED otherwise).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start moving your access in an organization to the account its SSO
     * provider signs you in as.
     * For someone who worked in an organization under another sign-in (an
     * email login) before the organization connected its SSO provider. The
     * caller, signed in the old way, asks for a ticket; the answer says what
     * the move will do (AccessMoveTicket.preview: the access that moves, the
     * My vault entries it deletes, the automations that stop); the person
     * then signs in through the organization's SSO provider and redeems the
     * ticket with redeemAccessMove. The ticket works once, for ten minutes,
     * for this account and this organization only.
     * Refused with FAILED_PRECONDITION when the caller holds no access in the
     * organization, is one of its owners (owners keep their own sign-in), or
     * already signed in through an SSO provider; with NOT_FOUND when the
     * organization has no SSO provider (the same copy getSsoProvider answers).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.AccessMoveTicket> createAccessMove(
        ai.stigmer.iam.identityprovider.v1.AccessMoveRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateAccessMoveMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Redeem an access move ticket: the access it names moves to the caller.
     * The caller must be signed in through the organization's SSO provider,
     * as the account it made for them; anyone else is refused with
     * PERMISSION_DENIED and the ticket stays usable until it expires. A
     * ticket that is unknown, expired or already redeemed is refused with
     * FAILED_PRECONDITION. A move that stops partway may be redeemed again
     * with the same ticket while it lasts, and completes.
     * Every change is recorded in the organization's permission history as a
     * move, acting for the caller.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.AccessMoveResult> redeemAccessMove(
        ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRedeemAccessMoveMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_RENAME = 3;
  private static final int METHODID_DELETE = 4;
  private static final int METHODID_CREATE_ACCESS_MOVE = 5;
  private static final int METHODID_REDEEM_ACCESS_MOVE = 6;

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
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_CREATE_ACCESS_MOVE:
          serviceImpl.createAccessMove((ai.stigmer.iam.identityprovider.v1.AccessMoveRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveTicket>) responseObserver);
          break;
        case METHODID_REDEEM_ACCESS_MOVE:
          serviceImpl.redeemAccessMove((ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.AccessMoveResult>) responseObserver);
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
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.UpdateIdentityProviderInput,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_DELETE)))
        .addMethod(
          getCreateAccessMoveMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.AccessMoveRequest,
              ai.stigmer.iam.identityprovider.v1.AccessMoveTicket>(
                service, METHODID_CREATE_ACCESS_MOVE)))
        .addMethod(
          getRedeemAccessMoveMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.RedeemAccessMoveInput,
              ai.stigmer.iam.identityprovider.v1.AccessMoveResult>(
                service, METHODID_REDEEM_ACCESS_MOVE)))
        .build();
  }

  private static abstract class IdentityProviderCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityProviderCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityprovider.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityProviderCommandController");
    }
  }

  private static final class IdentityProviderCommandControllerFileDescriptorSupplier
      extends IdentityProviderCommandControllerBaseDescriptorSupplier {
    IdentityProviderCommandControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityProviderCommandControllerMethodDescriptorSupplier
      extends IdentityProviderCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityProviderCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityProviderCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getCreateAccessMoveMethod())
              .addMethod(getRedeemAccessMoveMethod())
              .build();
        }
      }
    }
    return result;
  }
}
