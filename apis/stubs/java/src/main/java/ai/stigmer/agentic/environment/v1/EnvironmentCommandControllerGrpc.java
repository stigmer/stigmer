package ai.stigmer.agentic.environment.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EnvironmentCommandController handles write operations for Environments.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EnvironmentCommandControllerGrpc {

  private EnvironmentCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.environment.v1.EnvironmentCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.environment.v1.Environment.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment> getApplyMethod;
    if ((getApplyMethod = EnvironmentCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getApplyMethod = EnvironmentCommandControllerGrpc.getApplyMethod) == null) {
          EnvironmentCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.environment.v1.Environment.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment> getCreateMethod;
    if ((getCreateMethod = EnvironmentCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getCreateMethod = EnvironmentCommandControllerGrpc.getCreateMethod) == null) {
          EnvironmentCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput, ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod;
    if ((getUpdateMethod = EnvironmentCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getUpdateMethod = EnvironmentCommandControllerGrpc.getUpdateMethod) == null) {
          EnvironmentCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.environment.v1.Environment> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = EnvironmentCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = EnvironmentCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          EnvironmentCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.environment.v1.Environment> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.environment.v1.Environment> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.environment.v1.Environment> getRenameMethod;
    if ((getRenameMethod = EnvironmentCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getRenameMethod = EnvironmentCommandControllerGrpc.getRenameMethod) == null) {
          EnvironmentCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentId,
      ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.environment.v1.EnvironmentId.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentId,
      ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentId, ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod;
    if ((getDeleteMethod = EnvironmentCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getDeleteMethod = EnvironmentCommandControllerGrpc.getDeleteMethod) == null) {
          EnvironmentCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.EnvironmentId, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.EnvironmentId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EnvironmentCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EnvironmentCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public EnvironmentCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EnvironmentCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EnvironmentCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerFutureStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerFutureStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an Environment.
     * A request that carries metadata.id of an Environment in its organization
     * updates that Environment, and its slug changes only through rename. A
     * slug the Environment was renamed away from, named without its id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second Environment:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     Environment for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an Environment.
     * It starts visible to every member of the organization, who may then
     * name it for a conversation, unless it is created private
     * (metadata.visibility). Limited networking, or packages, on a server
     * whose sandboxes cannot enforce or install them is refused with
     * FAILED_PRECONDITION saying so.
     * A slug another Environment of the organization holds is refused with
     * ALREADY_EXISTS. A slug another Environment was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another Environment held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an Environment: the fields update_mask names change, every other
     * field keeps its stored value.
     * A conversation using the Environment gets new packages at its sandbox's
     * next start and new network access at its next turn.
     * resource.metadata.id names the Environment; apply finds one by slug.
     * The slug changes only through rename, and a mask naming a path the
     * Environment does not have is refused with INVALID_ARGUMENT naming the
     * path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the Environment
     *     changed since that etag was read: read it again and make the change
     *     again. No metadata.
     *   - WRITE_CONFLICT — the Environment kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an Environment.
     * Setting org lets every member of the organization see it and name it
     * for a conversation; child_orgs also lets the organization's child
     * organizations name it.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename an Environment: change its slug, the name people type.
     * The Environment keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the Environment for reading for 30 days, during which no
     * other Environment of the organization can take it and this one can take
     * it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another Environment holds
     * is refused with ALREADY_EXISTS, and one another Environment was recently
     * renamed away from with SLUG_RESERVED (see create).
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an Environment.
     * Refused with FAILED_PRECONDITION while an agent or a routine of its
     * organization names it, or while it is the organization's default,
     * naming each. A conversation that used it refuses its next message,
     * saying the Environment was deleted.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.environment.v1.EnvironmentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public static abstract class EnvironmentCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EnvironmentCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public static final class EnvironmentCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EnvironmentCommandControllerStub> {
    private EnvironmentCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment.
     * A request that carries metadata.id of an Environment in its organization
     * updates that Environment, and its slug changes only through rename. A
     * slug the Environment was renamed away from, named without its id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second Environment:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     Environment for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public void apply(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an Environment.
     * It starts visible to every member of the organization, who may then
     * name it for a conversation, unless it is created private
     * (metadata.visibility). Limited networking, or packages, on a server
     * whose sandboxes cannot enforce or install them is refused with
     * FAILED_PRECONDITION saying so.
     * A slug another Environment of the organization holds is refused with
     * ALREADY_EXISTS. A slug another Environment was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another Environment held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an Environment: the fields update_mask names change, every other
     * field keeps its stored value.
     * A conversation using the Environment gets new packages at its sandbox's
     * next start and new network access at its next turn.
     * resource.metadata.id names the Environment; apply finds one by slug.
     * The slug changes only through rename, and a mask naming a path the
     * Environment does not have is refused with INVALID_ARGUMENT naming the
     * path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the Environment
     *     changed since that etag was read: read it again and make the change
     *     again. No metadata.
     *   - WRITE_CONFLICT — the Environment kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an Environment.
     * Setting org lets every member of the organization see it and name it
     * for a conversation; child_orgs also lets the organization's child
     * organizations name it.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename an Environment: change its slug, the name people type.
     * The Environment keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the Environment for reading for 30 days, during which no
     * other Environment of the organization can take it and this one can take
     * it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another Environment holds
     * is refused with ALREADY_EXISTS, and one another Environment was recently
     * renamed away from with SLUG_RESERVED (see create).
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an Environment.
     * Refused with FAILED_PRECONDITION while an agent or a routine of its
     * organization names it, or while it is the organization's default,
     * naming each. A conversation that used it refuses its next message,
     * saying the Environment was deleted.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.environment.v1.EnvironmentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public static final class EnvironmentCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentCommandControllerBlockingV2Stub> {
    private EnvironmentCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment.
     * A request that carries metadata.id of an Environment in its organization
     * updates that Environment, and its slug changes only through rename. A
     * slug the Environment was renamed away from, named without its id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second Environment:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     Environment for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment apply(ai.stigmer.agentic.environment.v1.Environment request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an Environment.
     * It starts visible to every member of the organization, who may then
     * name it for a conversation, unless it is created private
     * (metadata.visibility). Limited networking, or packages, on a server
     * whose sandboxes cannot enforce or install them is refused with
     * FAILED_PRECONDITION saying so.
     * A slug another Environment of the organization holds is refused with
     * ALREADY_EXISTS. A slug another Environment was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another Environment held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment create(ai.stigmer.agentic.environment.v1.Environment request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an Environment: the fields update_mask names change, every other
     * field keeps its stored value.
     * A conversation using the Environment gets new packages at its sandbox's
     * next start and new network access at its next turn.
     * resource.metadata.id names the Environment; apply finds one by slug.
     * The slug changes only through rename, and a mask naming a path the
     * Environment does not have is refused with INVALID_ARGUMENT naming the
     * path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the Environment
     *     changed since that etag was read: read it again and make the change
     *     again. No metadata.
     *   - WRITE_CONFLICT — the Environment kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment update(ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an Environment.
     * Setting org lets every member of the organization see it and name it
     * for a conversation; child_orgs also lets the organization's child
     * organizations name it.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an Environment: change its slug, the name people type.
     * The Environment keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the Environment for reading for 30 days, during which no
     * other Environment of the organization can take it and this one can take
     * it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another Environment holds
     * is refused with ALREADY_EXISTS, and one another Environment was recently
     * renamed away from with SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an Environment.
     * Refused with FAILED_PRECONDITION while an agent or a routine of its
     * organization names it, or while it is the organization's default,
     * naming each. A conversation that used it refuses its next message,
     * saying the Environment was deleted.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment delete(ai.stigmer.agentic.environment.v1.EnvironmentId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public static final class EnvironmentCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentCommandControllerBlockingStub> {
    private EnvironmentCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment.
     * A request that carries metadata.id of an Environment in its organization
     * updates that Environment, and its slug changes only through rename. A
     * slug the Environment was renamed away from, named without its id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second Environment:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     Environment for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment apply(ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an Environment.
     * It starts visible to every member of the organization, who may then
     * name it for a conversation, unless it is created private
     * (metadata.visibility). Limited networking, or packages, on a server
     * whose sandboxes cannot enforce or install them is refused with
     * FAILED_PRECONDITION saying so.
     * A slug another Environment of the organization holds is refused with
     * ALREADY_EXISTS. A slug another Environment was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another Environment held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment create(ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an Environment: the fields update_mask names change, every other
     * field keeps its stored value.
     * A conversation using the Environment gets new packages at its sandbox's
     * next start and new network access at its next turn.
     * resource.metadata.id names the Environment; apply finds one by slug.
     * The slug changes only through rename, and a mask naming a path the
     * Environment does not have is refused with INVALID_ARGUMENT naming the
     * path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the Environment
     *     changed since that etag was read: read it again and make the change
     *     again. No metadata.
     *   - WRITE_CONFLICT — the Environment kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment update(ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an Environment.
     * Setting org lets every member of the organization see it and name it
     * for a conversation; child_orgs also lets the organization's child
     * organizations name it.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an Environment: change its slug, the name people type.
     * The Environment keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the Environment for reading for 30 days, during which no
     * other Environment of the organization can take it and this one can take
     * it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another Environment holds
     * is refused with ALREADY_EXISTS, and one another Environment was recently
     * renamed away from with SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an Environment.
     * Refused with FAILED_PRECONDITION while an agent or a routine of its
     * organization names it, or while it is the organization's default,
     * naming each. A conversation that used it refuses its next message,
     * saying the Environment was deleted.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment delete(ai.stigmer.agentic.environment.v1.EnvironmentId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController handles write operations for Environments.
   * </pre>
   */
  public static final class EnvironmentCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EnvironmentCommandControllerFutureStub> {
    private EnvironmentCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment.
     * A request that carries metadata.id of an Environment in its organization
     * updates that Environment, and its slug changes only through rename. A
     * slug the Environment was renamed away from, named without its id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second Environment:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     Environment for reading, but a write names its current slug.
     *     Metadata: slug (the one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> apply(
        ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an Environment.
     * It starts visible to every member of the organization, who may then
     * name it for a conversation, unless it is created private
     * (metadata.visibility). Limited networking, or packages, on a server
     * whose sandboxes cannot enforce or install them is refused with
     * FAILED_PRECONDITION saying so.
     * A slug another Environment of the organization holds is refused with
     * ALREADY_EXISTS. A slug another Environment was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another Environment held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> create(
        ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an Environment: the fields update_mask names change, every other
     * field keeps its stored value.
     * A conversation using the Environment gets new packages at its sandbox's
     * next start and new network access at its next turn.
     * resource.metadata.id names the Environment; apply finds one by slug.
     * The slug changes only through rename, and a mask naming a path the
     * Environment does not have is refused with INVALID_ARGUMENT naming the
     * path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the Environment
     *     changed since that etag was read: read it again and make the change
     *     again. No metadata.
     *   - WRITE_CONFLICT — the Environment kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> update(
        ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an Environment.
     * Setting org lets every member of the organization see it and name it
     * for a conversation; child_orgs also lets the organization's child
     * organizations name it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename an Environment: change its slug, the name people type.
     * The Environment keeps its id, so everything that names it keeps
     * working, and every answer names it by the new slug. The old slug keeps
     * leading to the Environment for reading for 30 days, during which no
     * other Environment of the organization can take it and this one can take
     * it back; then it is released. A write that names the old slug is
     * refused with SLUG_RENAMED (see apply). A slug another Environment holds
     * is refused with ALREADY_EXISTS, and one another Environment was recently
     * renamed away from with SLUG_RESERVED (see create).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an Environment.
     * Refused with FAILED_PRECONDITION while an agent or a routine of its
     * organization names it, or while it is the organization's default,
     * naming each. A conversation that used it refuses its next message,
     * saying the Environment was deleted.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> delete(
        ai.stigmer.agentic.environment.v1.EnvironmentId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_RENAME = 4;
  private static final int METHODID_DELETE = 5;

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
          serviceImpl.apply((ai.stigmer.agentic.environment.v1.Environment) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.environment.v1.Environment) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.environment.v1.EnvironmentId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
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
              ai.stigmer.agentic.environment.v1.Environment,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.Environment,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.UpdateEnvironmentInput,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.EnvironmentId,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class EnvironmentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EnvironmentCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.environment.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EnvironmentCommandController");
    }
  }

  private static final class EnvironmentCommandControllerFileDescriptorSupplier
      extends EnvironmentCommandControllerBaseDescriptorSupplier {
    EnvironmentCommandControllerFileDescriptorSupplier() {}
  }

  private static final class EnvironmentCommandControllerMethodDescriptorSupplier
      extends EnvironmentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EnvironmentCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EnvironmentCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EnvironmentCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
