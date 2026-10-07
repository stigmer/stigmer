package ai.stigmer.agentic.run.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunCommandController handles write operations for runs.
 * Follows the standard pattern: create, update, delete (no granular field updates).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunCommandControllerGrpc {

  private RunCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.run.v1.RunCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run,
      ai.stigmer.agentic.run.v1.Run> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.run.v1.Run.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run,
      ai.stigmer.agentic.run.v1.Run> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run, ai.stigmer.agentic.run.v1.Run> getCreateMethod;
    if ((getCreateMethod = RunCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getCreateMethod = RunCommandControllerGrpc.getCreateMethod) == null) {
          RunCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.Run, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run,
      ai.stigmer.agentic.run.v1.Run> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.run.v1.Run.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run,
      ai.stigmer.agentic.run.v1.Run> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.Run, ai.stigmer.agentic.run.v1.Run> getUpdateMethod;
    if ((getUpdateMethod = RunCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getUpdateMethod = RunCommandControllerGrpc.getUpdateMethod) == null) {
          RunCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.Run, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunUpdateStatusInput,
      ai.stigmer.agentic.run.v1.UpdateStatusResponse> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.run.v1.RunUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.run.v1.UpdateStatusResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunUpdateStatusInput,
      ai.stigmer.agentic.run.v1.UpdateStatusResponse> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunUpdateStatusInput, ai.stigmer.agentic.run.v1.UpdateStatusResponse> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = RunCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = RunCommandControllerGrpc.getUpdateStatusMethod) == null) {
          RunCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.RunUpdateStatusInput, ai.stigmer.agentic.run.v1.UpdateStatusResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.UpdateStatusResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.run.v1.Run> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.run.v1.Run> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.run.v1.Run> getDeleteMethod;
    if ((getDeleteMethod = RunCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getDeleteMethod = RunCommandControllerGrpc.getDeleteMethod) == null) {
          RunCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitApprovalInput,
      ai.stigmer.agentic.run.v1.Run> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.run.v1.SubmitApprovalInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitApprovalInput,
      ai.stigmer.agentic.run.v1.Run> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitApprovalInput, ai.stigmer.agentic.run.v1.Run> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = RunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = RunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          RunCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.SubmitApprovalInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.SubmitApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitFileDecisionInput,
      ai.stigmer.agentic.run.v1.Run> getSubmitFileDecisionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitFileDecision",
      requestType = ai.stigmer.agentic.run.v1.SubmitFileDecisionInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitFileDecisionInput,
      ai.stigmer.agentic.run.v1.Run> getSubmitFileDecisionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.SubmitFileDecisionInput, ai.stigmer.agentic.run.v1.Run> getSubmitFileDecisionMethod;
    if ((getSubmitFileDecisionMethod = RunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getSubmitFileDecisionMethod = RunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
          RunCommandControllerGrpc.getSubmitFileDecisionMethod = getSubmitFileDecisionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.SubmitFileDecisionInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitFileDecision"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.SubmitFileDecisionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("submitFileDecision"))
              .build();
        }
      }
    }
    return getSubmitFileDecisionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.CancelRunInput,
      ai.stigmer.agentic.run.v1.Run> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.run.v1.CancelRunInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.CancelRunInput,
      ai.stigmer.agentic.run.v1.Run> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.CancelRunInput, ai.stigmer.agentic.run.v1.Run> getCancelMethod;
    if ((getCancelMethod = RunCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getCancelMethod = RunCommandControllerGrpc.getCancelMethod) == null) {
          RunCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.CancelRunInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.CancelRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.TerminateRunInput,
      ai.stigmer.agentic.run.v1.Run> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.run.v1.TerminateRunInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.TerminateRunInput,
      ai.stigmer.agentic.run.v1.Run> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.TerminateRunInput, ai.stigmer.agentic.run.v1.Run> getTerminateMethod;
    if ((getTerminateMethod = RunCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getTerminateMethod = RunCommandControllerGrpc.getTerminateMethod) == null) {
          RunCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.TerminateRunInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.TerminateRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RecoverRunInput,
      ai.stigmer.agentic.run.v1.Run> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.run.v1.RecoverRunInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RecoverRunInput,
      ai.stigmer.agentic.run.v1.Run> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RecoverRunInput, ai.stigmer.agentic.run.v1.Run> getRecoverMethod;
    if ((getRecoverMethod = RunCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getRecoverMethod = RunCommandControllerGrpc.getRecoverMethod) == null) {
          RunCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.RecoverRunInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RecoverRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.PauseRunInput,
      ai.stigmer.agentic.run.v1.Run> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.run.v1.PauseRunInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.PauseRunInput,
      ai.stigmer.agentic.run.v1.Run> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.PauseRunInput, ai.stigmer.agentic.run.v1.Run> getPauseMethod;
    if ((getPauseMethod = RunCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getPauseMethod = RunCommandControllerGrpc.getPauseMethod) == null) {
          RunCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.PauseRunInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.PauseRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ResumeRunInput,
      ai.stigmer.agentic.run.v1.Run> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.run.v1.ResumeRunInput.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ResumeRunInput,
      ai.stigmer.agentic.run.v1.Run> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ResumeRunInput, ai.stigmer.agentic.run.v1.Run> getResumeMethod;
    if ((getResumeMethod = RunCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getResumeMethod = RunCommandControllerGrpc.getResumeMethod) == null) {
          RunCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.ResumeRunInput, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.ResumeRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.run.v1.UploadAttachmentResponse> getUploadAttachmentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "uploadAttachment",
      requestType = ai.stigmer.agentic.run.v1.UploadAttachmentRequest.class,
      responseType = ai.stigmer.agentic.run.v1.UploadAttachmentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.run.v1.UploadAttachmentResponse> getUploadAttachmentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.UploadAttachmentRequest, ai.stigmer.agentic.run.v1.UploadAttachmentResponse> getUploadAttachmentMethod;
    if ((getUploadAttachmentMethod = RunCommandControllerGrpc.getUploadAttachmentMethod) == null) {
      synchronized (RunCommandControllerGrpc.class) {
        if ((getUploadAttachmentMethod = RunCommandControllerGrpc.getUploadAttachmentMethod) == null) {
          RunCommandControllerGrpc.getUploadAttachmentMethod = getUploadAttachmentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.UploadAttachmentRequest, ai.stigmer.agentic.run.v1.UploadAttachmentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "uploadAttachment"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.UploadAttachmentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.UploadAttachmentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunCommandControllerMethodDescriptorSupplier("uploadAttachment"))
              .build();
        }
      }
    }
    return getUploadAttachmentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerStub>() {
        @java.lang.Override
        public RunCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunCommandControllerStub(channel, callOptions);
        }
      };
    return RunCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerBlockingStub>() {
        @java.lang.Override
        public RunCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return RunCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunCommandControllerFutureStub>() {
        @java.lang.Override
        public RunCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunCommandControllerFutureStub(channel, callOptions);
        }
      };
    return RunCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    default void create(ai.stigmer.agentic.run.v1.Run request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a run.
     * </pre>
     */
    default void update(ai.stigmer.agentic.run.v1.Run request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a run's status.
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.run.v1.RunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a run by ID.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Run must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the run
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, run resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, run continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the run CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.run.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision on a file change set (or a single file).
     * Records a FILE_DECIDED event in the append-only file_review stream;
     * FileChangeSet.decisions is the derived projection. The runner reconciles
     * the approved bytes — this RPC records the decision and enforces
     * that expected_digest still matches the captured content the user reviewed.
     * ## Preconditions
     * - Run must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the run
     * </pre>
     */
    default void submitFileDecision(ai.stigmer.agentic.run.v1.SubmitFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitFileDecisionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running run gracefully.
     * Sends a cancellation signal to the run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.run.v1.CancelRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate a run immediately.
     * Force-stops the run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.run.v1.TerminateRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    default void recover(ai.stigmer.agentic.run.v1.RecoverRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    default void pause(ai.stigmer.agentic.run.v1.PauseRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused run.
     * Continues the run from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    default void resume(ai.stigmer.agentic.run.v1.ResumeRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in a run.
     * Pre-uploads files to artifact storage before creating a run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    default void uploadAttachment(ai.stigmer.agentic.run.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUploadAttachmentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunCommandController.
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static abstract class RunCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunCommandController.
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class RunCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunCommandControllerStub> {
    private RunCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public void create(ai.stigmer.agentic.run.v1.Run request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a run.
     * </pre>
     */
    public void update(ai.stigmer.agentic.run.v1.Run request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a run's status.
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.run.v1.RunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a run by ID.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Run must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the run
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, run resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, run continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the run CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.run.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision on a file change set (or a single file).
     * Records a FILE_DECIDED event in the append-only file_review stream;
     * FileChangeSet.decisions is the derived projection. The runner reconciles
     * the approved bytes — this RPC records the decision and enforces
     * that expected_digest still matches the captured content the user reviewed.
     * ## Preconditions
     * - Run must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the run
     * </pre>
     */
    public void submitFileDecision(ai.stigmer.agentic.run.v1.SubmitFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running run gracefully.
     * Sends a cancellation signal to the run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.run.v1.CancelRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate a run immediately.
     * Force-stops the run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.run.v1.TerminateRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public void recover(ai.stigmer.agentic.run.v1.RecoverRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public void pause(ai.stigmer.agentic.run.v1.PauseRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused run.
     * Continues the run from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public void resume(ai.stigmer.agentic.run.v1.ResumeRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in a run.
     * Pre-uploads files to artifact storage before creating a run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public void uploadAttachment(ai.stigmer.agentic.run.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUploadAttachmentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunCommandController.
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class RunCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunCommandControllerBlockingV2Stub> {
    private RunCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run create(ai.stigmer.agentic.run.v1.Run request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run update(ai.stigmer.agentic.run.v1.Run request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a run's status.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.run.v1.RunUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Run must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the run
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, run resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, run continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the run CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run submitApproval(ai.stigmer.agentic.run.v1.SubmitApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision on a file change set (or a single file).
     * Records a FILE_DECIDED event in the append-only file_review stream;
     * FileChangeSet.decisions is the derived projection. The runner reconciles
     * the approved bytes — this RPC records the decision and enforces
     * that expected_digest still matches the captured content the user reviewed.
     * ## Preconditions
     * - Run must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the run
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run submitFileDecision(ai.stigmer.agentic.run.v1.SubmitFileDecisionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running run gracefully.
     * Sends a cancellation signal to the run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run cancel(ai.stigmer.agentic.run.v1.CancelRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a run immediately.
     * Force-stops the run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run terminate(ai.stigmer.agentic.run.v1.TerminateRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run recover(ai.stigmer.agentic.run.v1.RecoverRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run pause(ai.stigmer.agentic.run.v1.PauseRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused run.
     * Continues the run from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run resume(ai.stigmer.agentic.run.v1.ResumeRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in a run.
     * Pre-uploads files to artifact storage before creating a run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.run.v1.UploadAttachmentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunCommandController.
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class RunCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunCommandControllerBlockingStub> {
    private RunCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run create(ai.stigmer.agentic.run.v1.Run request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run update(ai.stigmer.agentic.run.v1.Run request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a run's status.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.run.v1.RunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Run must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the run
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, run resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, run continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the run CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run submitApproval(ai.stigmer.agentic.run.v1.SubmitApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision on a file change set (or a single file).
     * Records a FILE_DECIDED event in the append-only file_review stream;
     * FileChangeSet.decisions is the derived projection. The runner reconciles
     * the approved bytes — this RPC records the decision and enforces
     * that expected_digest still matches the captured content the user reviewed.
     * ## Preconditions
     * - Run must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the run
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run submitFileDecision(ai.stigmer.agentic.run.v1.SubmitFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running run gracefully.
     * Sends a cancellation signal to the run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run cancel(ai.stigmer.agentic.run.v1.CancelRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a run immediately.
     * Force-stops the run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run terminate(ai.stigmer.agentic.run.v1.TerminateRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run recover(ai.stigmer.agentic.run.v1.RecoverRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run pause(ai.stigmer.agentic.run.v1.PauseRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused run.
     * Continues the run from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run resume(ai.stigmer.agentic.run.v1.ResumeRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in a run.
     * Pre-uploads files to artifact storage before creating a run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.run.v1.UploadAttachmentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunCommandController.
   * <pre>
   * RunCommandController handles write operations for runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class RunCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunCommandControllerFutureStub> {
    private RunCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> create(
        ai.stigmer.agentic.run.v1.Run request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> update(
        ai.stigmer.agentic.run.v1.Run request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a run's status.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.UpdateStatusResponse> updateStatus(
        ai.stigmer.agentic.run.v1.RunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a run by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Run must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the run
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, run resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, run continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the run CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> submitApproval(
        ai.stigmer.agentic.run.v1.SubmitApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision on a file change set (or a single file).
     * Records a FILE_DECIDED event in the append-only file_review stream;
     * FileChangeSet.decisions is the derived projection. The runner reconciles
     * the approved bytes — this RPC records the decision and enforces
     * that expected_digest still matches the captured content the user reviewed.
     * ## Preconditions
     * - Run must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the run
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> submitFileDecision(
        ai.stigmer.agentic.run.v1.SubmitFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running run gracefully.
     * Sends a cancellation signal to the run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> cancel(
        ai.stigmer.agentic.run.v1.CancelRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate a run immediately.
     * Force-stops the run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> terminate(
        ai.stigmer.agentic.run.v1.TerminateRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> recover(
        ai.stigmer.agentic.run.v1.RecoverRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> pause(
        ai.stigmer.agentic.run.v1.PauseRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused run.
     * Continues the run from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> resume(
        ai.stigmer.agentic.run.v1.ResumeRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in a run.
     * Pre-uploads files to artifact storage before creating a run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.UploadAttachmentResponse> uploadAttachment(
        ai.stigmer.agentic.run.v1.UploadAttachmentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUploadAttachmentMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_STATUS = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_SUBMIT_APPROVAL = 4;
  private static final int METHODID_SUBMIT_FILE_DECISION = 5;
  private static final int METHODID_CANCEL = 6;
  private static final int METHODID_TERMINATE = 7;
  private static final int METHODID_RECOVER = 8;
  private static final int METHODID_PAUSE = 9;
  private static final int METHODID_RESUME = 10;
  private static final int METHODID_UPLOAD_ATTACHMENT = 11;

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
          serviceImpl.create((ai.stigmer.agentic.run.v1.Run) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.run.v1.Run) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.run.v1.RunUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UpdateStatusResponse>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.run.v1.SubmitApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_SUBMIT_FILE_DECISION:
          serviceImpl.submitFileDecision((ai.stigmer.agentic.run.v1.SubmitFileDecisionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.run.v1.CancelRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.run.v1.TerminateRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.run.v1.RecoverRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.run.v1.PauseRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.run.v1.ResumeRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_UPLOAD_ATTACHMENT:
          serviceImpl.uploadAttachment((ai.stigmer.agentic.run.v1.UploadAttachmentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.UploadAttachmentResponse>) responseObserver);
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
              ai.stigmer.agentic.run.v1.Run,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.Run,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.RunUpdateStatusInput,
              ai.stigmer.agentic.run.v1.UpdateStatusResponse>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_DELETE)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.SubmitApprovalInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getSubmitFileDecisionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.SubmitFileDecisionInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_SUBMIT_FILE_DECISION)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.CancelRunInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.TerminateRunInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.RecoverRunInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.PauseRunInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.ResumeRunInput,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_RESUME)))
        .addMethod(
          getUploadAttachmentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.UploadAttachmentRequest,
              ai.stigmer.agentic.run.v1.UploadAttachmentResponse>(
                service, METHODID_UPLOAD_ATTACHMENT)))
        .build();
  }

  private static abstract class RunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.run.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunCommandController");
    }
  }

  private static final class RunCommandControllerFileDescriptorSupplier
      extends RunCommandControllerBaseDescriptorSupplier {
    RunCommandControllerFileDescriptorSupplier() {}
  }

  private static final class RunCommandControllerMethodDescriptorSupplier
      extends RunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateStatusMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSubmitApprovalMethod())
              .addMethod(getSubmitFileDecisionMethod())
              .addMethod(getCancelMethod())
              .addMethod(getTerminateMethod())
              .addMethod(getRecoverMethod())
              .addMethod(getPauseMethod())
              .addMethod(getResumeMethod())
              .addMethod(getUploadAttachmentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
