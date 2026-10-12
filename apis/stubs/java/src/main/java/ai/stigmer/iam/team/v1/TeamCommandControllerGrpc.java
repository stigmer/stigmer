package ai.stigmer.iam.team.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * TeamCommandController provides write operations for teams.
 * Membership is not written here: a person joins a team when they are granted
 * the member role on it, through the IAM policy service, like any other grant.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class TeamCommandControllerGrpc {

  private TeamCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.team.v1.TeamCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team,
      ai.stigmer.iam.team.v1.Team> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.team.v1.Team.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team,
      ai.stigmer.iam.team.v1.Team> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team, ai.stigmer.iam.team.v1.Team> getCreateMethod;
    if ((getCreateMethod = TeamCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (TeamCommandControllerGrpc.class) {
        if ((getCreateMethod = TeamCommandControllerGrpc.getCreateMethod) == null) {
          TeamCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.team.v1.Team, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team,
      ai.stigmer.iam.team.v1.Team> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.team.v1.Team.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team,
      ai.stigmer.iam.team.v1.Team> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.Team, ai.stigmer.iam.team.v1.Team> getUpdateMethod;
    if ((getUpdateMethod = TeamCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (TeamCommandControllerGrpc.class) {
        if ((getUpdateMethod = TeamCommandControllerGrpc.getUpdateMethod) == null) {
          TeamCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.team.v1.Team, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.team.v1.Team> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.iam.team.v1.Team> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.team.v1.Team> getRenameMethod;
    if ((getRenameMethod = TeamCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (TeamCommandControllerGrpc.class) {
        if ((getRenameMethod = TeamCommandControllerGrpc.getRenameMethod) == null) {
          TeamCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.team.v1.Team> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.team.v1.Team> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.team.v1.Team> getDeleteMethod;
    if ((getDeleteMethod = TeamCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (TeamCommandControllerGrpc.class) {
        if ((getDeleteMethod = TeamCommandControllerGrpc.getDeleteMethod) == null) {
          TeamCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static TeamCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerStub>() {
        @java.lang.Override
        public TeamCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamCommandControllerStub(channel, callOptions);
        }
      };
    return TeamCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static TeamCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public TeamCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return TeamCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static TeamCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerBlockingStub>() {
        @java.lang.Override
        public TeamCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return TeamCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static TeamCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamCommandControllerFutureStub>() {
        @java.lang.Override
        public TeamCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamCommandControllerFutureStub(channel, callOptions);
        }
      };
    return TeamCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a team in an organization.
     * On Stigmer Cloud, teams are a plan feature. An organization whose plan
     * lacks them is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     the feature. Metadata: feature ("teams"), org.
     * On Stigmer Enterprise, a new team is growth the server's license pays
     * for. Once the license and its grace period have ended, a create is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), before anything is written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     team that exists keeps working. No metadata.
     * A slug another team of the organization holds is refused with
     * ALREADY_EXISTS. A slug another team was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another team held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.iam.team.v1.Team request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a team's name or description.
     * The slug changes only through rename. A slug the team was renamed away
     * from, named without the team's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second team:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same team
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    default void update(ai.stigmer.iam.team.v1.Team request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename a team: change its slug, the name people type.
     * The team keeps its id, so everything that names it keeps working, and every
     * answer names it by the new slug. The old slug keeps leading to the team for
     * reading for 30 days, during which no other team of the organization can
     * take it and this one can take it back; then it is released. A write that
     * names the old slug is refused with SLUG_RENAMED (see update). A slug
     * another team holds is refused with ALREADY_EXISTS, and one another team was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Its memberships and shares name its id and are unchanged.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a team.
     * Deleting a team removes its memberships and every share made with it.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service TeamCommandController.
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public static abstract class TeamCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return TeamCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service TeamCommandController.
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public static final class TeamCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<TeamCommandControllerStub> {
    private TeamCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a team in an organization.
     * On Stigmer Cloud, teams are a plan feature. An organization whose plan
     * lacks them is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     the feature. Metadata: feature ("teams"), org.
     * On Stigmer Enterprise, a new team is growth the server's license pays
     * for. Once the license and its grace period have ended, a create is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), before anything is written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     team that exists keeps working. No metadata.
     * A slug another team of the organization holds is refused with
     * ALREADY_EXISTS. A slug another team was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another team held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.iam.team.v1.Team request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a team's name or description.
     * The slug changes only through rename. A slug the team was renamed away
     * from, named without the team's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second team:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same team
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public void update(ai.stigmer.iam.team.v1.Team request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename a team: change its slug, the name people type.
     * The team keeps its id, so everything that names it keeps working, and every
     * answer names it by the new slug. The old slug keeps leading to the team for
     * reading for 30 days, during which no other team of the organization can
     * take it and this one can take it back; then it is released. A write that
     * names the old slug is refused with SLUG_RENAMED (see update). A slug
     * another team holds is refused with ALREADY_EXISTS, and one another team was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Its memberships and shares name its id and are unchanged.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a team.
     * Deleting a team removes its memberships and every share made with it.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service TeamCommandController.
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public static final class TeamCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<TeamCommandControllerBlockingV2Stub> {
    private TeamCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a team in an organization.
     * On Stigmer Cloud, teams are a plan feature. An organization whose plan
     * lacks them is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     the feature. Metadata: feature ("teams"), org.
     * On Stigmer Enterprise, a new team is growth the server's license pays
     * for. Once the license and its grace period have ended, a create is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), before anything is written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     team that exists keeps working. No metadata.
     * A slug another team of the organization holds is refused with
     * ALREADY_EXISTS. A slug another team was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another team held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team create(ai.stigmer.iam.team.v1.Team request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a team's name or description.
     * The slug changes only through rename. A slug the team was renamed away
     * from, named without the team's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second team:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same team
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team update(ai.stigmer.iam.team.v1.Team request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a team: change its slug, the name people type.
     * The team keeps its id, so everything that names it keeps working, and every
     * answer names it by the new slug. The old slug keeps leading to the team for
     * reading for 30 days, during which no other team of the organization can
     * take it and this one can take it back; then it is released. A write that
     * names the old slug is refused with SLUG_RENAMED (see update). A slug
     * another team holds is refused with ALREADY_EXISTS, and one another team was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Its memberships and shares name its id and are unchanged.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a team.
     * Deleting a team removes its memberships and every share made with it.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service TeamCommandController.
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public static final class TeamCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<TeamCommandControllerBlockingStub> {
    private TeamCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a team in an organization.
     * On Stigmer Cloud, teams are a plan feature. An organization whose plan
     * lacks them is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     the feature. Metadata: feature ("teams"), org.
     * On Stigmer Enterprise, a new team is growth the server's license pays
     * for. Once the license and its grace period have ended, a create is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), before anything is written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     team that exists keeps working. No metadata.
     * A slug another team of the organization holds is refused with
     * ALREADY_EXISTS. A slug another team was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another team held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team create(ai.stigmer.iam.team.v1.Team request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a team's name or description.
     * The slug changes only through rename. A slug the team was renamed away
     * from, named without the team's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second team:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same team
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team update(ai.stigmer.iam.team.v1.Team request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a team: change its slug, the name people type.
     * The team keeps its id, so everything that names it keeps working, and every
     * answer names it by the new slug. The old slug keeps leading to the team for
     * reading for 30 days, during which no other team of the organization can
     * take it and this one can take it back; then it is released. A write that
     * names the old slug is refused with SLUG_RENAMED (see update). A slug
     * another team holds is refused with ALREADY_EXISTS, and one another team was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Its memberships and shares name its id and are unchanged.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a team.
     * Deleting a team removes its memberships and every share made with it.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service TeamCommandController.
   * <pre>
   * TeamCommandController provides write operations for teams.
   * Membership is not written here: a person joins a team when they are granted
   * the member role on it, through the IAM policy service, like any other grant.
   * </pre>
   */
  public static final class TeamCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<TeamCommandControllerFutureStub> {
    private TeamCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a team in an organization.
     * On Stigmer Cloud, teams are a plan feature. An organization whose plan
     * lacks them is refused with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the organization's plan does not include
     *     the feature. Metadata: feature ("teams"), org.
     * On Stigmer Enterprise, a new team is growth the server's license pays
     * for. Once the license and its grace period have ended, a create is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), before anything is written:
     *   - LICENSE_RENEWAL_REQUIRED — the server's license has ended; every
     *     team that exists keeps working. No metadata.
     * A slug another team of the organization holds is refused with
     * ALREADY_EXISTS. A slug another team was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another team held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> create(
        ai.stigmer.iam.team.v1.Team request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a team's name or description.
     * The slug changes only through rename. A slug the team was renamed away
     * from, named without the team's id, is refused with FAILED_PRECONDITION
     * carrying a google.rpc.ErrorInfo detail (domain "stigmer.ai"), because a
     * write by a name that stops resolving after 30 days would later make a
     * second team:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same team
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> update(
        ai.stigmer.iam.team.v1.Team request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename a team: change its slug, the name people type.
     * The team keeps its id, so everything that names it keeps working, and every
     * answer names it by the new slug. The old slug keeps leading to the team for
     * reading for 30 days, during which no other team of the organization can
     * take it and this one can take it back; then it is released. A write that
     * names the old slug is refused with SLUG_RENAMED (see update). A slug
     * another team holds is refused with ALREADY_EXISTS, and one another team was
     * recently renamed away from with SLUG_RESERVED (see create).
     * Its memberships and shares name its id and are unchanged.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a team.
     * Deleting a team removes its memberships and every share made with it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_RENAME = 2;
  private static final int METHODID_DELETE = 3;

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
          serviceImpl.create((ai.stigmer.iam.team.v1.Team) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.team.v1.Team) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
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
              ai.stigmer.iam.team.v1.Team,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.team.v1.Team,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class TeamCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    TeamCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.team.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("TeamCommandController");
    }
  }

  private static final class TeamCommandControllerFileDescriptorSupplier
      extends TeamCommandControllerBaseDescriptorSupplier {
    TeamCommandControllerFileDescriptorSupplier() {}
  }

  private static final class TeamCommandControllerMethodDescriptorSupplier
      extends TeamCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    TeamCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (TeamCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new TeamCommandControllerFileDescriptorSupplier())
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
