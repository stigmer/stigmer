package ai.stigmer.iam.federationissuer.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * FederationIssuerCommandController provides write operations for federation issuers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class FederationIssuerCommandControllerGrpc {

  private FederationIssuerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.federationissuer.v1.FederationIssuerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getApplyMethod;
    if ((getApplyMethod = FederationIssuerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        if ((getApplyMethod = FederationIssuerCommandControllerGrpc.getApplyMethod) == null) {
          FederationIssuerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.federationissuer.v1.FederationIssuer, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.FederationIssuer, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getCreateMethod;
    if ((getCreateMethod = FederationIssuerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        if ((getCreateMethod = FederationIssuerCommandControllerGrpc.getCreateMethod) == null) {
          FederationIssuerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.federationissuer.v1.FederationIssuer, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getUpdateMethod;
    if ((getUpdateMethod = FederationIssuerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        if ((getUpdateMethod = FederationIssuerCommandControllerGrpc.getUpdateMethod) == null) {
          FederationIssuerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getRenameMethod;
    if ((getRenameMethod = FederationIssuerCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        if ((getRenameMethod = FederationIssuerCommandControllerGrpc.getRenameMethod) == null) {
          FederationIssuerCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getDeleteMethod;
    if ((getDeleteMethod = FederationIssuerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        if ((getDeleteMethod = FederationIssuerCommandControllerGrpc.getDeleteMethod) == null) {
          FederationIssuerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static FederationIssuerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerStub>() {
        @java.lang.Override
        public FederationIssuerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerCommandControllerStub(channel, callOptions);
        }
      };
    return FederationIssuerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static FederationIssuerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public FederationIssuerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return FederationIssuerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static FederationIssuerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerBlockingStub>() {
        @java.lang.Override
        public FederationIssuerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return FederationIssuerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static FederationIssuerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerCommandControllerFutureStub>() {
        @java.lang.Override
        public FederationIssuerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return FederationIssuerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a federation issuer.
     * If the resource does not exist, creates a new federation issuer.
     * If the resource exists, updates the existing federation issuer.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of a federation issuer in its
     * organization updates that federation issuer, and its slug changes only
     * through rename. A slug the federation issuer was renamed away from, named
     * without the federation issuer's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second federation issuer:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     federation issuer for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.iam.federationissuer.v1.FederationIssuer request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a federation issuer.
     * The creator's organization owns the federation issuer.
     * On Stigmer Enterprise, a new federation issuer is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     federation issuer that exists keeps signing people in. No metadata.
     * A slug another federation issuer of the organization holds is refused with
     * ALREADY_EXISTS. A slug another federation issuer was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another federation issuer held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.iam.federationissuer.v1.FederationIssuer request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a federation issuer: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     federation issuer keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * resource.metadata.id names the federation issuer; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the federation issuer does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the federation issuer changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the federation issuer kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename a federation issuer: change its slug, the name people type.
     * The federation issuer keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the federation issuer for reading for 30 days, during which no
     * other federation issuer of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another federation issuer
     * holds is refused with ALREADY_EXISTS, and one another federation issuer was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a federation issuer.
     * The federated accounts the issuer vouches for are
     * deleted with it, with every role they hold, so an issuer created again
     * under the same slug inherits none of them.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service FederationIssuerCommandController.
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public static abstract class FederationIssuerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return FederationIssuerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service FederationIssuerCommandController.
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<FederationIssuerCommandControllerStub> {
    private FederationIssuerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a federation issuer.
     * If the resource does not exist, creates a new federation issuer.
     * If the resource exists, updates the existing federation issuer.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of a federation issuer in its
     * organization updates that federation issuer, and its slug changes only
     * through rename. A slug the federation issuer was renamed away from, named
     * without the federation issuer's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second federation issuer:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     federation issuer for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public void apply(ai.stigmer.iam.federationissuer.v1.FederationIssuer request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a federation issuer.
     * The creator's organization owns the federation issuer.
     * On Stigmer Enterprise, a new federation issuer is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     federation issuer that exists keeps signing people in. No metadata.
     * A slug another federation issuer of the organization holds is refused with
     * ALREADY_EXISTS. A slug another federation issuer was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another federation issuer held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.iam.federationissuer.v1.FederationIssuer request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a federation issuer: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     federation issuer keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * resource.metadata.id names the federation issuer; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the federation issuer does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the federation issuer changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the federation issuer kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename a federation issuer: change its slug, the name people type.
     * The federation issuer keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the federation issuer for reading for 30 days, during which no
     * other federation issuer of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another federation issuer
     * holds is refused with ALREADY_EXISTS, and one another federation issuer was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a federation issuer.
     * The federated accounts the issuer vouches for are
     * deleted with it, with every role they hold, so an issuer created again
     * under the same slug inherits none of them.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service FederationIssuerCommandController.
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<FederationIssuerCommandControllerBlockingV2Stub> {
    private FederationIssuerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a federation issuer.
     * If the resource does not exist, creates a new federation issuer.
     * If the resource exists, updates the existing federation issuer.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of a federation issuer in its
     * organization updates that federation issuer, and its slug changes only
     * through rename. A slug the federation issuer was renamed away from, named
     * without the federation issuer's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second federation issuer:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     federation issuer for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer apply(ai.stigmer.iam.federationissuer.v1.FederationIssuer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a federation issuer.
     * The creator's organization owns the federation issuer.
     * On Stigmer Enterprise, a new federation issuer is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     federation issuer that exists keeps signing people in. No metadata.
     * A slug another federation issuer of the organization holds is refused with
     * ALREADY_EXISTS. A slug another federation issuer was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another federation issuer held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer create(ai.stigmer.iam.federationissuer.v1.FederationIssuer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a federation issuer: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     federation issuer keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * resource.metadata.id names the federation issuer; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the federation issuer does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the federation issuer changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the federation issuer kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer update(ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a federation issuer: change its slug, the name people type.
     * The federation issuer keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the federation issuer for reading for 30 days, during which no
     * other federation issuer of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another federation issuer
     * holds is refused with ALREADY_EXISTS, and one another federation issuer was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a federation issuer.
     * The federated accounts the issuer vouches for are
     * deleted with it, with every role they hold, so an issuer created again
     * under the same slug inherits none of them.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service FederationIssuerCommandController.
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<FederationIssuerCommandControllerBlockingStub> {
    private FederationIssuerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a federation issuer.
     * If the resource does not exist, creates a new federation issuer.
     * If the resource exists, updates the existing federation issuer.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of a federation issuer in its
     * organization updates that federation issuer, and its slug changes only
     * through rename. A slug the federation issuer was renamed away from, named
     * without the federation issuer's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second federation issuer:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     federation issuer for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer apply(ai.stigmer.iam.federationissuer.v1.FederationIssuer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a federation issuer.
     * The creator's organization owns the federation issuer.
     * On Stigmer Enterprise, a new federation issuer is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     federation issuer that exists keeps signing people in. No metadata.
     * A slug another federation issuer of the organization holds is refused with
     * ALREADY_EXISTS. A slug another federation issuer was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another federation issuer held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer create(ai.stigmer.iam.federationissuer.v1.FederationIssuer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a federation issuer: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     federation issuer keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * resource.metadata.id names the federation issuer; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the federation issuer does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the federation issuer changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the federation issuer kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer update(ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a federation issuer: change its slug, the name people type.
     * The federation issuer keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the federation issuer for reading for 30 days, during which no
     * other federation issuer of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another federation issuer
     * holds is refused with ALREADY_EXISTS, and one another federation issuer was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a federation issuer.
     * The federated accounts the issuer vouches for are
     * deleted with it, with every role they hold, so an issuer created again
     * under the same slug inherits none of them.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service FederationIssuerCommandController.
   * <pre>
   * FederationIssuerCommandController provides write operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<FederationIssuerCommandControllerFutureStub> {
    private FederationIssuerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a federation issuer.
     * If the resource does not exist, creates a new federation issuer.
     * If the resource exists, updates the existing federation issuer.
     * Either arm is refused as create or update is, LICENSE_RENEWAL_REQUIRED
     * included.
     * A request that carries metadata.id of a federation issuer in its
     * organization updates that federation issuer, and its slug changes only
     * through rename. A slug the federation issuer was renamed away from, named
     * without the federation issuer's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second federation issuer:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     federation issuer for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> apply(
        ai.stigmer.iam.federationissuer.v1.FederationIssuer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a federation issuer.
     * The creator's organization owns the federation issuer.
     * On Stigmer Enterprise, a new federation issuer is growth the server's
     * license pays for. Once the license and its grace period have ended, a
     * create is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     federation issuer that exists keeps signing people in. No metadata.
     * A slug another federation issuer of the organization holds is refused with
     * ALREADY_EXISTS. A slug another federation issuer was renamed away from,
     * which still leads to it for 30 days, is refused with ALREADY_EXISTS
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another federation issuer held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> create(
        ai.stigmer.iam.federationissuer.v1.FederationIssuer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a federation issuer: the fields update_mask names change, every other
     * field keeps its stored value.
     * On Stigmer Enterprise, changing how people sign in is growth the
     * server's license pays for. Once the license and its grace period have
     * ended, an update is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; the
     *     federation issuer keeps signing people in as it is, and can still
     *     be deleted. No metadata.
     * resource.metadata.id names the federation issuer; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the federation issuer does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the federation issuer changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the federation issuer kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> update(
        ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename a federation issuer: change its slug, the name people type.
     * The federation issuer keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the federation issuer for reading for 30 days, during which no
     * other federation issuer of the organization can take it and this one can
     * take it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another federation issuer
     * holds is refused with ALREADY_EXISTS, and one another federation issuer was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Sign-in does not name its slug, so the people it signs in keep signing in.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a federation issuer.
     * The federated accounts the issuer vouches for are
     * deleted with it, with every role they hold, so an issuer created again
     * under the same slug inherits none of them.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> delete(
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
          serviceImpl.apply((ai.stigmer.iam.federationissuer.v1.FederationIssuer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.federationissuer.v1.FederationIssuer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
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
              ai.stigmer.iam.federationissuer.v1.FederationIssuer,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.federationissuer.v1.FederationIssuer,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.federationissuer.v1.UpdateFederationIssuerInput,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class FederationIssuerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    FederationIssuerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.federationissuer.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("FederationIssuerCommandController");
    }
  }

  private static final class FederationIssuerCommandControllerFileDescriptorSupplier
      extends FederationIssuerCommandControllerBaseDescriptorSupplier {
    FederationIssuerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class FederationIssuerCommandControllerMethodDescriptorSupplier
      extends FederationIssuerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    FederationIssuerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (FederationIssuerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new FederationIssuerCommandControllerFileDescriptorSupplier())
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
