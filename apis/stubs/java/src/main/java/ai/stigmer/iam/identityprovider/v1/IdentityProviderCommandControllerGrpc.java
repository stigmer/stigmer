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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;
    if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
          IdentityProviderCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
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
     * </pre>
     */
    default void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update names the identity provider by its id, and the slug changes
     * only through rename.
     * </pre>
     */
    default void update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
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
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
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
     * </pre>
     */
    public void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update names the identity provider by its id, and the slug changes
     * only through rename.
     * </pre>
     */
    public void update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
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
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
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
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update names the identity provider by its id, and the slug changes
     * only through rename.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
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
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
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
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update names the identity provider by its id, and the slug changes
     * only through rename.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
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
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> create(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     identity provider keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * An update names the identity provider by its id, and the slug changes
     * only through rename.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> update(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_RENAME = 3;
  private static final int METHODID_DELETE = 4;

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
          serviceImpl.update((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
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
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
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
              .build();
        }
      }
    }
    return result;
  }
}
