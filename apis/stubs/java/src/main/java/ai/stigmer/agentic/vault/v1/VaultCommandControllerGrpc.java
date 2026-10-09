package ai.stigmer.agentic.vault.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * VaultCommandController handles write operations for vaults.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class VaultCommandControllerGrpc {

  private VaultCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.vault.v1.VaultCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault,
      ai.stigmer.agentic.vault.v1.Vault> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.vault.v1.Vault.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault,
      ai.stigmer.agentic.vault.v1.Vault> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault, ai.stigmer.agentic.vault.v1.Vault> getCreateMethod;
    if ((getCreateMethod = VaultCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getCreateMethod = VaultCommandControllerGrpc.getCreateMethod) == null) {
          VaultCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.Vault, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault,
      ai.stigmer.agentic.vault.v1.Vault> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.vault.v1.Vault.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault,
      ai.stigmer.agentic.vault.v1.Vault> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.Vault, ai.stigmer.agentic.vault.v1.Vault> getUpdateMethod;
    if ((getUpdateMethod = VaultCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getUpdateMethod = VaultCommandControllerGrpc.getUpdateMethod) == null) {
          VaultCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.Vault, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.vault.v1.Vault> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.vault.v1.Vault> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.vault.v1.Vault> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = VaultCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = VaultCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          VaultCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.vault.v1.Vault> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.vault.v1.Vault> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.vault.v1.Vault> getDeleteMethod;
    if ((getDeleteMethod = VaultCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getDeleteMethod = VaultCommandControllerGrpc.getDeleteMethod) == null) {
          VaultCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultSecretsInput,
      ai.stigmer.agentic.vault.v1.Vault> getSetSecretsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "setSecrets",
      requestType = ai.stigmer.agentic.vault.v1.SetVaultSecretsInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultSecretsInput,
      ai.stigmer.agentic.vault.v1.Vault> getSetSecretsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultSecretsInput, ai.stigmer.agentic.vault.v1.Vault> getSetSecretsMethod;
    if ((getSetSecretsMethod = VaultCommandControllerGrpc.getSetSecretsMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getSetSecretsMethod = VaultCommandControllerGrpc.getSetSecretsMethod) == null) {
          VaultCommandControllerGrpc.getSetSecretsMethod = getSetSecretsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.SetVaultSecretsInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "setSecrets"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.SetVaultSecretsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("setSecrets"))
              .build();
        }
      }
    }
    return getSetSecretsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput,
      ai.stigmer.agentic.vault.v1.Vault> getRemoveSecretsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "removeSecrets",
      requestType = ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput,
      ai.stigmer.agentic.vault.v1.Vault> getRemoveSecretsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput, ai.stigmer.agentic.vault.v1.Vault> getRemoveSecretsMethod;
    if ((getRemoveSecretsMethod = VaultCommandControllerGrpc.getRemoveSecretsMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getRemoveSecretsMethod = VaultCommandControllerGrpc.getRemoveSecretsMethod) == null) {
          VaultCommandControllerGrpc.getRemoveSecretsMethod = getRemoveSecretsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "removeSecrets"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("removeSecrets"))
              .build();
        }
      }
    }
    return getRemoveSecretsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultConnectionInput,
      ai.stigmer.agentic.vault.v1.Vault> getSetConnectionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "setConnection",
      requestType = ai.stigmer.agentic.vault.v1.SetVaultConnectionInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultConnectionInput,
      ai.stigmer.agentic.vault.v1.Vault> getSetConnectionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.SetVaultConnectionInput, ai.stigmer.agentic.vault.v1.Vault> getSetConnectionMethod;
    if ((getSetConnectionMethod = VaultCommandControllerGrpc.getSetConnectionMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getSetConnectionMethod = VaultCommandControllerGrpc.getSetConnectionMethod) == null) {
          VaultCommandControllerGrpc.getSetConnectionMethod = getSetConnectionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.SetVaultConnectionInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "setConnection"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.SetVaultConnectionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("setConnection"))
              .build();
        }
      }
    }
    return getSetConnectionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput,
      ai.stigmer.agentic.vault.v1.Vault> getRemoveConnectionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "removeConnections",
      requestType = ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput,
      ai.stigmer.agentic.vault.v1.Vault> getRemoveConnectionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput, ai.stigmer.agentic.vault.v1.Vault> getRemoveConnectionsMethod;
    if ((getRemoveConnectionsMethod = VaultCommandControllerGrpc.getRemoveConnectionsMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getRemoveConnectionsMethod = VaultCommandControllerGrpc.getRemoveConnectionsMethod) == null) {
          VaultCommandControllerGrpc.getRemoveConnectionsMethod = getRemoveConnectionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "removeConnections"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("removeConnections"))
              .build();
        }
      }
    }
    return getRemoveConnectionsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.StartSignInInput,
      ai.stigmer.agentic.vault.v1.StartSignInOutput> getStartSignInMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "startSignIn",
      requestType = ai.stigmer.agentic.vault.v1.StartSignInInput.class,
      responseType = ai.stigmer.agentic.vault.v1.StartSignInOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.StartSignInInput,
      ai.stigmer.agentic.vault.v1.StartSignInOutput> getStartSignInMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.StartSignInInput, ai.stigmer.agentic.vault.v1.StartSignInOutput> getStartSignInMethod;
    if ((getStartSignInMethod = VaultCommandControllerGrpc.getStartSignInMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getStartSignInMethod = VaultCommandControllerGrpc.getStartSignInMethod) == null) {
          VaultCommandControllerGrpc.getStartSignInMethod = getStartSignInMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.StartSignInInput, ai.stigmer.agentic.vault.v1.StartSignInOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "startSignIn"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.StartSignInInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.StartSignInOutput.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("startSignIn"))
              .build();
        }
      }
    }
    return getStartSignInMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteSignInInput,
      ai.stigmer.agentic.vault.v1.CompleteSignInOutput> getCompleteSignInMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "completeSignIn",
      requestType = ai.stigmer.agentic.vault.v1.CompleteSignInInput.class,
      responseType = ai.stigmer.agentic.vault.v1.CompleteSignInOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteSignInInput,
      ai.stigmer.agentic.vault.v1.CompleteSignInOutput> getCompleteSignInMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteSignInInput, ai.stigmer.agentic.vault.v1.CompleteSignInOutput> getCompleteSignInMethod;
    if ((getCompleteSignInMethod = VaultCommandControllerGrpc.getCompleteSignInMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getCompleteSignInMethod = VaultCommandControllerGrpc.getCompleteSignInMethod) == null) {
          VaultCommandControllerGrpc.getCompleteSignInMethod = getCompleteSignInMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.CompleteSignInInput, ai.stigmer.agentic.vault.v1.CompleteSignInOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "completeSignIn"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.CompleteSignInInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.CompleteSignInOutput.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("completeSignIn"))
              .build();
        }
      }
    }
    return getCompleteSignInMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CreateConnectLinkInput,
      ai.stigmer.agentic.vault.v1.ConnectLink> getCreateConnectLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createConnectLink",
      requestType = ai.stigmer.agentic.vault.v1.CreateConnectLinkInput.class,
      responseType = ai.stigmer.agentic.vault.v1.ConnectLink.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CreateConnectLinkInput,
      ai.stigmer.agentic.vault.v1.ConnectLink> getCreateConnectLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CreateConnectLinkInput, ai.stigmer.agentic.vault.v1.ConnectLink> getCreateConnectLinkMethod;
    if ((getCreateConnectLinkMethod = VaultCommandControllerGrpc.getCreateConnectLinkMethod) == null) {
      synchronized (VaultCommandControllerGrpc.class) {
        if ((getCreateConnectLinkMethod = VaultCommandControllerGrpc.getCreateConnectLinkMethod) == null) {
          VaultCommandControllerGrpc.getCreateConnectLinkMethod = getCreateConnectLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.CreateConnectLinkInput, ai.stigmer.agentic.vault.v1.ConnectLink>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createConnectLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.CreateConnectLinkInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ConnectLink.getDefaultInstance()))
              .setSchemaDescriptor(new VaultCommandControllerMethodDescriptorSupplier("createConnectLink"))
              .build();
        }
      }
    }
    return getCreateConnectLinkMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static VaultCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerStub>() {
        @java.lang.Override
        public VaultCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultCommandControllerStub(channel, callOptions);
        }
      };
    return VaultCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static VaultCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public VaultCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return VaultCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static VaultCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerBlockingStub>() {
        @java.lang.Override
        public VaultCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return VaultCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static VaultCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultCommandControllerFutureStub>() {
        @java.lang.Override
        public VaultCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultCommandControllerFutureStub(channel, callOptions);
        }
      };
    return VaultCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a shared vault in an organization.
     * The vault belongs to the organization and starts empty. It starts
     * private, so only the organization's admins may use it until it is
     * shared, unless it is created with organization visibility
     * (metadata.visibility), which shares it with every member at once.
     * </pre>
     */
    default void create(ai.stigmer.agentic.vault.v1.Vault request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a vault's name, description and external id.
     * Entries are kept as stored: change them with setSecrets, removeSecrets,
     * setConnection and removeConnections.
     * </pre>
     */
    default void update(ai.stigmer.agentic.vault.v1.Vault request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a shared vault.
     * Setting org lets every member of the organization use the vault in
     * their runs. My vault is always private.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a vault and every value it holds.
     * Sessions, schedules, shares, channels and platform clients that name the
     * vault are refused at their next run, naming it.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Save secrets in a vault, replacing any saved under the same names.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    default void setSecrets(ai.stigmer.agentic.vault.v1.SetVaultSecretsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetSecretsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove secrets from a vault by name.
     * </pre>
     */
    default void removeSecrets(ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRemoveSecretsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Save a login in a vault at the address of the tool or Git host it is
     * for, replacing any saved at the same address.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    default void setConnection(ai.stigmer.agentic.vault.v1.SetVaultConnectionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetConnectionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove logins from a vault by address.
     * </pre>
     */
    default void removeConnections(ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRemoveConnectionsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start a sign-in at an address, to save the login in a vault.
     * Answers the login page to send the person to. When they have signed in,
     * the page they return to calls completeSignIn with what the login page
     * handed back. The sign-in must be completed within ten minutes.
     * The login fills every HTTP tool whose URL is the address, and a Git
     * host's login serves clones from that host.
     * </pre>
     */
    default void startSignIn(ai.stigmer.agentic.vault.v1.StartSignInInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartSignInOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getStartSignInMethod(), responseObserver);
    }

    /**
     * <pre>
     * Finish a sign-in: exchange the code the login page handed back and save
     * the login in the vault the sign-in was started for, replacing any login
     * saved at the address.
     * Only the person who started the sign-in may finish it.
     * </pre>
     */
    default void completeSignIn(ai.stigmer.agentic.vault.v1.CompleteSignInInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteSignInOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCompleteSignInMethod(), responseObserver);
    }

    /**
     * <pre>
     * Make a Connect link: a one-time page where someone without a Stigmer
     * account signs in at an address, and the login is saved into a shared
     * vault.
     * An integrator makes one for each customer's vault and sends the
     * customer to its url. The customer sees one Stigmer page with a
     * Continue button, then the login page, then returns to return_url.
     * Refused for My vault, and for an address the organization has no
     * approved login app of its own for: a link signs in only through the
     * organization's app (its name on the vendor's consent page), never
     * through Stigmer's own apps or Stigmer's client at a login server.
     * </pre>
     */
    default void createConnectLink(ai.stigmer.agentic.vault.v1.CreateConnectLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLink> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateConnectLinkMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service VaultCommandController.
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public static abstract class VaultCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return VaultCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service VaultCommandController.
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public static final class VaultCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<VaultCommandControllerStub> {
    private VaultCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a shared vault in an organization.
     * The vault belongs to the organization and starts empty. It starts
     * private, so only the organization's admins may use it until it is
     * shared, unless it is created with organization visibility
     * (metadata.visibility), which shares it with every member at once.
     * </pre>
     */
    public void create(ai.stigmer.agentic.vault.v1.Vault request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a vault's name, description and external id.
     * Entries are kept as stored: change them with setSecrets, removeSecrets,
     * setConnection and removeConnections.
     * </pre>
     */
    public void update(ai.stigmer.agentic.vault.v1.Vault request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a shared vault.
     * Setting org lets every member of the organization use the vault in
     * their runs. My vault is always private.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a vault and every value it holds.
     * Sessions, schedules, shares, channels and platform clients that name the
     * vault are refused at their next run, naming it.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Save secrets in a vault, replacing any saved under the same names.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public void setSecrets(ai.stigmer.agentic.vault.v1.SetVaultSecretsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetSecretsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove secrets from a vault by name.
     * </pre>
     */
    public void removeSecrets(ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRemoveSecretsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Save a login in a vault at the address of the tool or Git host it is
     * for, replacing any saved at the same address.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public void setConnection(ai.stigmer.agentic.vault.v1.SetVaultConnectionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetConnectionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove logins from a vault by address.
     * </pre>
     */
    public void removeConnections(ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRemoveConnectionsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start a sign-in at an address, to save the login in a vault.
     * Answers the login page to send the person to. When they have signed in,
     * the page they return to calls completeSignIn with what the login page
     * handed back. The sign-in must be completed within ten minutes.
     * The login fills every HTTP tool whose URL is the address, and a Git
     * host's login serves clones from that host.
     * </pre>
     */
    public void startSignIn(ai.stigmer.agentic.vault.v1.StartSignInInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartSignInOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getStartSignInMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Finish a sign-in: exchange the code the login page handed back and save
     * the login in the vault the sign-in was started for, replacing any login
     * saved at the address.
     * Only the person who started the sign-in may finish it.
     * </pre>
     */
    public void completeSignIn(ai.stigmer.agentic.vault.v1.CompleteSignInInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteSignInOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCompleteSignInMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Make a Connect link: a one-time page where someone without a Stigmer
     * account signs in at an address, and the login is saved into a shared
     * vault.
     * An integrator makes one for each customer's vault and sends the
     * customer to its url. The customer sees one Stigmer page with a
     * Continue button, then the login page, then returns to return_url.
     * Refused for My vault, and for an address the organization has no
     * approved login app of its own for: a link signs in only through the
     * organization's app (its name on the vendor's consent page), never
     * through Stigmer's own apps or Stigmer's client at a login server.
     * </pre>
     */
    public void createConnectLink(ai.stigmer.agentic.vault.v1.CreateConnectLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLink> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateConnectLinkMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service VaultCommandController.
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public static final class VaultCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<VaultCommandControllerBlockingV2Stub> {
    private VaultCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a shared vault in an organization.
     * The vault belongs to the organization and starts empty. It starts
     * private, so only the organization's admins may use it until it is
     * shared, unless it is created with organization visibility
     * (metadata.visibility), which shares it with every member at once.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault create(ai.stigmer.agentic.vault.v1.Vault request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a vault's name, description and external id.
     * Entries are kept as stored: change them with setSecrets, removeSecrets,
     * setConnection and removeConnections.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault update(ai.stigmer.agentic.vault.v1.Vault request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a shared vault.
     * Setting org lets every member of the organization use the vault in
     * their runs. My vault is always private.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a vault and every value it holds.
     * Sessions, schedules, shares, channels and platform clients that name the
     * vault are refused at their next run, naming it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Save secrets in a vault, replacing any saved under the same names.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault setSecrets(ai.stigmer.agentic.vault.v1.SetVaultSecretsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetSecretsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove secrets from a vault by name.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault removeSecrets(ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRemoveSecretsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Save a login in a vault at the address of the tool or Git host it is
     * for, replacing any saved at the same address.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault setConnection(ai.stigmer.agentic.vault.v1.SetVaultConnectionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetConnectionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove logins from a vault by address.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault removeConnections(ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRemoveConnectionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a sign-in at an address, to save the login in a vault.
     * Answers the login page to send the person to. When they have signed in,
     * the page they return to calls completeSignIn with what the login page
     * handed back. The sign-in must be completed within ten minutes.
     * The login fills every HTTP tool whose URL is the address, and a Git
     * host's login serves clones from that host.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.StartSignInOutput startSignIn(ai.stigmer.agentic.vault.v1.StartSignInInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getStartSignInMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Finish a sign-in: exchange the code the login page handed back and save
     * the login in the vault the sign-in was started for, replacing any login
     * saved at the address.
     * Only the person who started the sign-in may finish it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.CompleteSignInOutput completeSignIn(ai.stigmer.agentic.vault.v1.CompleteSignInInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCompleteSignInMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Make a Connect link: a one-time page where someone without a Stigmer
     * account signs in at an address, and the login is saved into a shared
     * vault.
     * An integrator makes one for each customer's vault and sends the
     * customer to its url. The customer sees one Stigmer page with a
     * Continue button, then the login page, then returns to return_url.
     * Refused for My vault, and for an address the organization has no
     * approved login app of its own for: a link signs in only through the
     * organization's app (its name on the vendor's consent page), never
     * through Stigmer's own apps or Stigmer's client at a login server.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ConnectLink createConnectLink(ai.stigmer.agentic.vault.v1.CreateConnectLinkInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateConnectLinkMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service VaultCommandController.
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public static final class VaultCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<VaultCommandControllerBlockingStub> {
    private VaultCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a shared vault in an organization.
     * The vault belongs to the organization and starts empty. It starts
     * private, so only the organization's admins may use it until it is
     * shared, unless it is created with organization visibility
     * (metadata.visibility), which shares it with every member at once.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault create(ai.stigmer.agentic.vault.v1.Vault request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a vault's name, description and external id.
     * Entries are kept as stored: change them with setSecrets, removeSecrets,
     * setConnection and removeConnections.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault update(ai.stigmer.agentic.vault.v1.Vault request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a shared vault.
     * Setting org lets every member of the organization use the vault in
     * their runs. My vault is always private.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a vault and every value it holds.
     * Sessions, schedules, shares, channels and platform clients that name the
     * vault are refused at their next run, naming it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Save secrets in a vault, replacing any saved under the same names.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault setSecrets(ai.stigmer.agentic.vault.v1.SetVaultSecretsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetSecretsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove secrets from a vault by name.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault removeSecrets(ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRemoveSecretsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Save a login in a vault at the address of the tool or Git host it is
     * for, replacing any saved at the same address.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault setConnection(ai.stigmer.agentic.vault.v1.SetVaultConnectionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetConnectionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove logins from a vault by address.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault removeConnections(ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRemoveConnectionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a sign-in at an address, to save the login in a vault.
     * Answers the login page to send the person to. When they have signed in,
     * the page they return to calls completeSignIn with what the login page
     * handed back. The sign-in must be completed within ten minutes.
     * The login fills every HTTP tool whose URL is the address, and a Git
     * host's login serves clones from that host.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.StartSignInOutput startSignIn(ai.stigmer.agentic.vault.v1.StartSignInInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getStartSignInMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Finish a sign-in: exchange the code the login page handed back and save
     * the login in the vault the sign-in was started for, replacing any login
     * saved at the address.
     * Only the person who started the sign-in may finish it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.CompleteSignInOutput completeSignIn(ai.stigmer.agentic.vault.v1.CompleteSignInInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCompleteSignInMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Make a Connect link: a one-time page where someone without a Stigmer
     * account signs in at an address, and the login is saved into a shared
     * vault.
     * An integrator makes one for each customer's vault and sends the
     * customer to its url. The customer sees one Stigmer page with a
     * Continue button, then the login page, then returns to return_url.
     * Refused for My vault, and for an address the organization has no
     * approved login app of its own for: a link signs in only through the
     * organization's app (its name on the vendor's consent page), never
     * through Stigmer's own apps or Stigmer's client at a login server.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ConnectLink createConnectLink(ai.stigmer.agentic.vault.v1.CreateConnectLinkInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateConnectLinkMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service VaultCommandController.
   * <pre>
   * VaultCommandController handles write operations for vaults.
   * </pre>
   */
  public static final class VaultCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<VaultCommandControllerFutureStub> {
    private VaultCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a shared vault in an organization.
     * The vault belongs to the organization and starts empty. It starts
     * private, so only the organization's admins may use it until it is
     * shared, unless it is created with organization visibility
     * (metadata.visibility), which shares it with every member at once.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> create(
        ai.stigmer.agentic.vault.v1.Vault request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a vault's name, description and external id.
     * Entries are kept as stored: change them with setSecrets, removeSecrets,
     * setConnection and removeConnections.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> update(
        ai.stigmer.agentic.vault.v1.Vault request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of a shared vault.
     * Setting org lets every member of the organization use the vault in
     * their runs. My vault is always private.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a vault and every value it holds.
     * Sessions, schedules, shares, channels and platform clients that name the
     * vault are refused at their next run, naming it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Save secrets in a vault, replacing any saved under the same names.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> setSecrets(
        ai.stigmer.agentic.vault.v1.SetVaultSecretsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetSecretsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove secrets from a vault by name.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> removeSecrets(
        ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRemoveSecretsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Save a login in a vault at the address of the tool or Git host it is
     * for, replacing any saved at the same address.
     * Naming the caller's own My vault creates it on its first write.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> setConnection(
        ai.stigmer.agentic.vault.v1.SetVaultConnectionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetConnectionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove logins from a vault by address.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> removeConnections(
        ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRemoveConnectionsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start a sign-in at an address, to save the login in a vault.
     * Answers the login page to send the person to. When they have signed in,
     * the page they return to calls completeSignIn with what the login page
     * handed back. The sign-in must be completed within ten minutes.
     * The login fills every HTTP tool whose URL is the address, and a Git
     * host's login serves clones from that host.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.StartSignInOutput> startSignIn(
        ai.stigmer.agentic.vault.v1.StartSignInInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getStartSignInMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Finish a sign-in: exchange the code the login page handed back and save
     * the login in the vault the sign-in was started for, replacing any login
     * saved at the address.
     * Only the person who started the sign-in may finish it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.CompleteSignInOutput> completeSignIn(
        ai.stigmer.agentic.vault.v1.CompleteSignInInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCompleteSignInMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Make a Connect link: a one-time page where someone without a Stigmer
     * account signs in at an address, and the login is saved into a shared
     * vault.
     * An integrator makes one for each customer's vault and sends the
     * customer to its url. The customer sees one Stigmer page with a
     * Continue button, then the login page, then returns to return_url.
     * Refused for My vault, and for an address the organization has no
     * approved login app of its own for: a link signs in only through the
     * organization's app (its name on the vendor's consent page), never
     * through Stigmer's own apps or Stigmer's client at a login server.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.ConnectLink> createConnectLink(
        ai.stigmer.agentic.vault.v1.CreateConnectLinkInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateConnectLinkMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_VISIBILITY = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_SET_SECRETS = 4;
  private static final int METHODID_REMOVE_SECRETS = 5;
  private static final int METHODID_SET_CONNECTION = 6;
  private static final int METHODID_REMOVE_CONNECTIONS = 7;
  private static final int METHODID_START_SIGN_IN = 8;
  private static final int METHODID_COMPLETE_SIGN_IN = 9;
  private static final int METHODID_CREATE_CONNECT_LINK = 10;

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
          serviceImpl.create((ai.stigmer.agentic.vault.v1.Vault) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.vault.v1.Vault) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_SET_SECRETS:
          serviceImpl.setSecrets((ai.stigmer.agentic.vault.v1.SetVaultSecretsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_REMOVE_SECRETS:
          serviceImpl.removeSecrets((ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_SET_CONNECTION:
          serviceImpl.setConnection((ai.stigmer.agentic.vault.v1.SetVaultConnectionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_REMOVE_CONNECTIONS:
          serviceImpl.removeConnections((ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_START_SIGN_IN:
          serviceImpl.startSignIn((ai.stigmer.agentic.vault.v1.StartSignInInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartSignInOutput>) responseObserver);
          break;
        case METHODID_COMPLETE_SIGN_IN:
          serviceImpl.completeSignIn((ai.stigmer.agentic.vault.v1.CompleteSignInInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteSignInOutput>) responseObserver);
          break;
        case METHODID_CREATE_CONNECT_LINK:
          serviceImpl.createConnectLink((ai.stigmer.agentic.vault.v1.CreateConnectLinkInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLink>) responseObserver);
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
              ai.stigmer.agentic.vault.v1.Vault,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.Vault,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_DELETE)))
        .addMethod(
          getSetSecretsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.SetVaultSecretsInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_SET_SECRETS)))
        .addMethod(
          getRemoveSecretsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.RemoveVaultSecretsInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_REMOVE_SECRETS)))
        .addMethod(
          getSetConnectionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.SetVaultConnectionInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_SET_CONNECTION)))
        .addMethod(
          getRemoveConnectionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.RemoveVaultConnectionsInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_REMOVE_CONNECTIONS)))
        .addMethod(
          getStartSignInMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.StartSignInInput,
              ai.stigmer.agentic.vault.v1.StartSignInOutput>(
                service, METHODID_START_SIGN_IN)))
        .addMethod(
          getCompleteSignInMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.CompleteSignInInput,
              ai.stigmer.agentic.vault.v1.CompleteSignInOutput>(
                service, METHODID_COMPLETE_SIGN_IN)))
        .addMethod(
          getCreateConnectLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.CreateConnectLinkInput,
              ai.stigmer.agentic.vault.v1.ConnectLink>(
                service, METHODID_CREATE_CONNECT_LINK)))
        .build();
  }

  private static abstract class VaultCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    VaultCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.vault.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("VaultCommandController");
    }
  }

  private static final class VaultCommandControllerFileDescriptorSupplier
      extends VaultCommandControllerBaseDescriptorSupplier {
    VaultCommandControllerFileDescriptorSupplier() {}
  }

  private static final class VaultCommandControllerMethodDescriptorSupplier
      extends VaultCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    VaultCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (VaultCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new VaultCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSetSecretsMethod())
              .addMethod(getRemoveSecretsMethod())
              .addMethod(getSetConnectionMethod())
              .addMethod(getRemoveConnectionsMethod())
              .addMethod(getStartSignInMethod())
              .addMethod(getCompleteSignInMethod())
              .addMethod(getCreateConnectLinkMethod())
              .build();
        }
      }
    }
    return result;
  }
}
