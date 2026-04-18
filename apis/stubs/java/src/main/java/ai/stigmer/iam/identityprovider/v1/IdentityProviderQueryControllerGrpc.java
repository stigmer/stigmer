package ai.stigmer.iam.identityprovider.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IdentityProviderQueryController provides read operations for identity providers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityProviderQueryControllerGrpc {

  private IdentityProviderQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityprovider.v1.IdentityProviderQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod;
    if ((getGetMethod = IdentityProviderQueryControllerGrpc.getGetMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getGetMethod = IdentityProviderQueryControllerGrpc.getGetMethod) == null) {
          IdentityProviderQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = IdentityProviderQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = IdentityProviderQueryControllerGrpc.getGetByReferenceMethod) == null) {
          IdentityProviderQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProviders> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProviders.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProviders> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput, ai.stigmer.iam.identityprovider.v1.IdentityProviders> getListByOrgMethod;
    if ((getListByOrgMethod = IdentityProviderQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getListByOrgMethod = IdentityProviderQueryControllerGrpc.getListByOrgMethod) == null) {
          IdentityProviderQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput, ai.stigmer.iam.identityprovider.v1.IdentityProviders>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProviders.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup,
      ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> getGetSsoProviderMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSsoProvider",
      requestType = ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup.class,
      responseType = ai.stigmer.iam.identityprovider.v1.SsoProviderInfo.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup,
      ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> getGetSsoProviderMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup, ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> getGetSsoProviderMethod;
    if ((getGetSsoProviderMethod = IdentityProviderQueryControllerGrpc.getGetSsoProviderMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getGetSsoProviderMethod = IdentityProviderQueryControllerGrpc.getGetSsoProviderMethod) == null) {
          IdentityProviderQueryControllerGrpc.getGetSsoProviderMethod = getGetSsoProviderMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup, ai.stigmer.iam.identityprovider.v1.SsoProviderInfo>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSsoProvider"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.SsoProviderInfo.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("getSsoProvider"))
              .build();
        }
      }
    }
    return getGetSsoProviderMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityProviderQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityProviderQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityProviderQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityProviderQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerFutureStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all identity providers belonging to an organization.
     * Returns every IdentityProvider whose metadata.org matches the input org.
     * Typically a small set (1-3 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    default void listByOrg(ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProviders> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }

    /**
     * <pre>
     * Look up the SSO identity provider for an organization.
     * Returns the SSO-relevant projection (display name, OIDC client ID, issuer)
     * of the IdentityProvider where is_sso_provider is true for the given org.
     * Returns NOT_FOUND if the organization has no SSO provider configured.
     * This endpoint is called by the web app's login page before the user has
     * authenticated, so it requires no authorization. The response intentionally
     * omits internal IdP configuration (JWKS URI, rate limits, userinfo endpoint).
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for login page rendering.
     * </pre>
     */
    default void getSsoProvider(ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSsoProviderMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static abstract class IdentityProviderQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityProviderQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityProviderQueryControllerStub> {
    private IdentityProviderQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all identity providers belonging to an organization.
     * Returns every IdentityProvider whose metadata.org matches the input org.
     * Typically a small set (1-3 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public void listByOrg(ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProviders> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Look up the SSO identity provider for an organization.
     * Returns the SSO-relevant projection (display name, OIDC client ID, issuer)
     * of the IdentityProvider where is_sso_provider is true for the given org.
     * Returns NOT_FOUND if the organization has no SSO provider configured.
     * This endpoint is called by the web app's login page before the user has
     * authenticated, so it requires no authorization. The response intentionally
     * omits internal IdP configuration (JWKS URI, rate limits, userinfo endpoint).
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for login page rendering.
     * </pre>
     */
    public void getSsoProvider(ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSsoProviderMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderQueryControllerBlockingV2Stub> {
    private IdentityProviderQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all identity providers belonging to an organization.
     * Returns every IdentityProvider whose metadata.org matches the input org.
     * Typically a small set (1-3 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProviders listByOrg(ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Look up the SSO identity provider for an organization.
     * Returns the SSO-relevant projection (display name, OIDC client ID, issuer)
     * of the IdentityProvider where is_sso_provider is true for the given org.
     * Returns NOT_FOUND if the organization has no SSO provider configured.
     * This endpoint is called by the web app's login page before the user has
     * authenticated, so it requires no authorization. The response intentionally
     * omits internal IdP configuration (JWKS URI, rate limits, userinfo endpoint).
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for login page rendering.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.SsoProviderInfo getSsoProvider(ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSsoProviderMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderQueryControllerBlockingStub> {
    private IdentityProviderQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all identity providers belonging to an organization.
     * Returns every IdentityProvider whose metadata.org matches the input org.
     * Typically a small set (1-3 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProviders listByOrg(ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Look up the SSO identity provider for an organization.
     * Returns the SSO-relevant projection (display name, OIDC client ID, issuer)
     * of the IdentityProvider where is_sso_provider is true for the given org.
     * Returns NOT_FOUND if the organization has no SSO provider configured.
     * This endpoint is called by the web app's login page before the user has
     * authenticated, so it requires no authorization. The response intentionally
     * omits internal IdP configuration (JWKS URI, rate limits, userinfo endpoint).
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for login page rendering.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.SsoProviderInfo getSsoProvider(ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSsoProviderMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityProviderQueryControllerFutureStub> {
    private IdentityProviderQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all identity providers belonging to an organization.
     * Returns every IdentityProvider whose metadata.org matches the input org.
     * Typically a small set (1-3 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProviders> listByOrg(
        ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Look up the SSO identity provider for an organization.
     * Returns the SSO-relevant projection (display name, OIDC client ID, issuer)
     * of the IdentityProvider where is_sso_provider is true for the given org.
     * Returns NOT_FOUND if the organization has no SSO provider configured.
     * This endpoint is called by the web app's login page before the user has
     * authenticated, so it requires no authorization. The response intentionally
     * omits internal IdP configuration (JWKS URI, rate limits, userinfo endpoint).
     * &#64;internal
     * Authorization: none — unauthenticated, public endpoint for login page rendering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.SsoProviderInfo> getSsoProvider(
        ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSsoProviderMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_BY_ORG = 2;
  private static final int METHODID_GET_SSO_PROVIDER = 3;

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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProviders>) responseObserver);
          break;
        case METHODID_GET_SSO_PROVIDER:
          serviceImpl.getSsoProvider((ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.SsoProviderInfo>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.ListIdentityProvidersByOrgInput,
              ai.stigmer.iam.identityprovider.v1.IdentityProviders>(
                service, METHODID_LIST_BY_ORG)))
        .addMethod(
          getGetSsoProviderMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.OrganizationSsoLookup,
              ai.stigmer.iam.identityprovider.v1.SsoProviderInfo>(
                service, METHODID_GET_SSO_PROVIDER)))
        .build();
  }

  private static abstract class IdentityProviderQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityProviderQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityprovider.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityProviderQueryController");
    }
  }

  private static final class IdentityProviderQueryControllerFileDescriptorSupplier
      extends IdentityProviderQueryControllerBaseDescriptorSupplier {
    IdentityProviderQueryControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityProviderQueryControllerMethodDescriptorSupplier
      extends IdentityProviderQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityProviderQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityProviderQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListByOrgMethod())
              .addMethod(getGetSsoProviderMethod())
              .build();
        }
      }
    }
    return result;
  }
}
