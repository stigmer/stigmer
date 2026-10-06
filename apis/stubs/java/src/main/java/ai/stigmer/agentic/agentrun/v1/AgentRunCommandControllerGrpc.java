package ai.stigmer.agentic.agentrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentRunCommandController handles write operations for agent runs.
 * Follows the standard pattern: create, update, delete (no granular field updates).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentRunCommandControllerGrpc {

  private AgentRunCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentrun.v1.AgentRunCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun, ai.stigmer.agentic.agentrun.v1.AgentRun> getCreateMethod;
    if ((getCreateMethod = AgentRunCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentRunCommandControllerGrpc.getCreateMethod) == null) {
          AgentRunCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.AgentRun, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRun, ai.stigmer.agentic.agentrun.v1.AgentRun> getUpdateMethod;
    if ((getUpdateMethod = AgentRunCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentRunCommandControllerGrpc.getUpdateMethod) == null) {
          AgentRunCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.AgentRun, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput,
      ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput,
      ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput, ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = AgentRunCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = AgentRunCommandControllerGrpc.getUpdateStatusMethod) == null) {
          AgentRunCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput, ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.agentrun.v1.AgentRun> getDeleteMethod;
    if ((getDeleteMethod = AgentRunCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentRunCommandControllerGrpc.getDeleteMethod) == null) {
          AgentRunCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = AgentRunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = AgentRunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          AgentRunCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitFileDecisionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitFileDecision",
      requestType = ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitFileDecisionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getSubmitFileDecisionMethod;
    if ((getSubmitFileDecisionMethod = AgentRunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getSubmitFileDecisionMethod = AgentRunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
          AgentRunCommandControllerGrpc.getSubmitFileDecisionMethod = getSubmitFileDecisionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitFileDecision"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("submitFileDecision"))
              .build();
        }
      }
    }
    return getSubmitFileDecisionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getCancelMethod;
    if ((getCancelMethod = AgentRunCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getCancelMethod = AgentRunCommandControllerGrpc.getCancelMethod) == null) {
          AgentRunCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getTerminateMethod;
    if ((getTerminateMethod = AgentRunCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getTerminateMethod = AgentRunCommandControllerGrpc.getTerminateMethod) == null) {
          AgentRunCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getRecoverMethod;
    if ((getRecoverMethod = AgentRunCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getRecoverMethod = AgentRunCommandControllerGrpc.getRecoverMethod) == null) {
          AgentRunCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getPauseMethod;
    if ((getPauseMethod = AgentRunCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getPauseMethod = AgentRunCommandControllerGrpc.getPauseMethod) == null) {
          AgentRunCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun> getResumeMethod;
    if ((getResumeMethod = AgentRunCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getResumeMethod = AgentRunCommandControllerGrpc.getResumeMethod) == null) {
          AgentRunCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> getUploadAttachmentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "uploadAttachment",
      requestType = ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> getUploadAttachmentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest, ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> getUploadAttachmentMethod;
    if ((getUploadAttachmentMethod = AgentRunCommandControllerGrpc.getUploadAttachmentMethod) == null) {
      synchronized (AgentRunCommandControllerGrpc.class) {
        if ((getUploadAttachmentMethod = AgentRunCommandControllerGrpc.getUploadAttachmentMethod) == null) {
          AgentRunCommandControllerGrpc.getUploadAttachmentMethod = getUploadAttachmentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest, ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "uploadAttachment"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunCommandControllerMethodDescriptorSupplier("uploadAttachment"))
              .build();
        }
      }
    }
    return getUploadAttachmentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentRunCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerStub>() {
        @java.lang.Override
        public AgentRunCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunCommandControllerStub(channel, callOptions);
        }
      };
    return AgentRunCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentRunCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentRunCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentRunCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentRunCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentRunCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentRunCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentRunCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentRunCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentRunCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new agent run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentrun.v1.AgentRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an agent run.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentrun.v1.AgentRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an agent run's status.
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent run by ID.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the execution CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
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
     * - Execution must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the execution
     * </pre>
     */
    default void submitFileDecision(ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitFileDecisionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running agent run gracefully.
     * Sends a cancellation signal to the agent run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate an agent run immediately.
     * Force-stops the agent run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed agent run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    default void recover(ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running agent run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    default void pause(ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused agent run.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    default void resume(ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent run.
     * Pre-uploads files to artifact storage before creating an run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    default void uploadAttachment(ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUploadAttachmentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentRunCommandController.
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static abstract class AgentRunCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentRunCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentRunCommandController.
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentRunCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentRunCommandControllerStub> {
    private AgentRunCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentrun.v1.AgentRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an agent run.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentrun.v1.AgentRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an agent run's status.
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent run by ID.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the execution CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
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
     * - Execution must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the execution
     * </pre>
     */
    public void submitFileDecision(ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running agent run gracefully.
     * Sends a cancellation signal to the agent run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate an agent run immediately.
     * Force-stops the agent run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed agent run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public void recover(ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running agent run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public void pause(ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused agent run.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public void resume(ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent run.
     * Pre-uploads files to artifact storage before creating an run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public void uploadAttachment(ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUploadAttachmentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentRunCommandController.
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentRunCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunCommandControllerBlockingV2Stub> {
    private AgentRunCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun create(ai.stigmer.agentic.agentrun.v1.AgentRun request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun update(ai.stigmer.agentic.agentrun.v1.AgentRun request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent run's status.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the execution CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun submitApproval(ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput request) throws io.grpc.StatusException {
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
     * - Execution must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the execution
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun submitFileDecision(ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running agent run gracefully.
     * Sends a cancellation signal to the agent run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun cancel(ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate an agent run immediately.
     * Force-stops the agent run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun terminate(ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed agent run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun recover(ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running agent run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun pause(ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused agent run.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun resume(ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent run.
     * Pre-uploads files to artifact storage before creating an run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentRunCommandController.
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentRunCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunCommandControllerBlockingStub> {
    private AgentRunCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun create(ai.stigmer.agentic.agentrun.v1.AgentRun request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun update(ai.stigmer.agentic.agentrun.v1.AgentRun request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent run's status.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the execution CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun submitApproval(ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput request) {
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
     * - Execution must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the execution
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun submitFileDecision(ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running agent run gracefully.
     * Sends a cancellation signal to the agent run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun cancel(ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate an agent run immediately.
     * Force-stops the agent run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun terminate(ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed agent run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun recover(ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running agent run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun pause(ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused agent run.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun resume(ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent run.
     * Pre-uploads files to artifact storage before creating an run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentRunCommandController.
   * <pre>
   * AgentRunCommandController handles write operations for agent runs.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentRunCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentRunCommandControllerFutureStub> {
    private AgentRunCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent run: a turn in an existing session,
     * or the first turn of a new one created from session_spec.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> create(
        ai.stigmer.agentic.agentrun.v1.AgentRun request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an agent run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> update(
        ai.stigmer.agentic.agentrun.v1.AgentRun request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an agent run's status.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse> updateStatus(
        ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent run by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in RUN_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Tool is denied and the user's objection is fed back to the LLM;
     *   the execution CONTINUES (see APPROVAL_ACTION_REJECT in enum.proto — to
     *   stop the whole run, use cancel/terminate)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> submitApproval(
        ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput request) {
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
     * - Execution must exist and be non-terminal
     * - change_set_id must match a status.file_change_sets[].id; for FILE scope,
     *   file_change_id must match a CapturedFileChange.id within it
     * - expected_digest must match the target's current digest
     * - User must have can_edit permission on the execution
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> submitFileDecision(
        ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running agent run gracefully.
     * Sends a cancellation signal to the agent run. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> cancel(
        ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate an agent run immediately.
     * Force-stops the agent run without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> terminate(
        ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed agent run.
     * Retries the failed run. Completed work is preserved - successful tool
     * calls are NOT re-executed.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> recover(
        ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running agent run.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> pause(
        ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused agent run.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> resume(
        ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent run.
     * Pre-uploads files to artifact storage before creating an run.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse> uploadAttachment(
        ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest request) {
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
          serviceImpl.create((ai.stigmer.agentic.agentrun.v1.AgentRun) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentrun.v1.AgentRun) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_SUBMIT_FILE_DECISION:
          serviceImpl.submitFileDecision((ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_UPLOAD_ATTACHMENT:
          serviceImpl.uploadAttachment((ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse>) responseObserver);
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
              ai.stigmer.agentic.agentrun.v1.AgentRun,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.AgentRun,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.AgentRunUpdateStatusInput,
              ai.stigmer.agentic.agentrun.v1.UpdateStatusResponse>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_DELETE)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.SubmitApprovalInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getSubmitFileDecisionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.SubmitFileDecisionInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_SUBMIT_FILE_DECISION)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.CancelAgentRunInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.TerminateAgentRunInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.RecoverAgentRunInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.PauseAgentRunInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.ResumeAgentRunInput,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_RESUME)))
        .addMethod(
          getUploadAttachmentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.UploadAttachmentRequest,
              ai.stigmer.agentic.agentrun.v1.UploadAttachmentResponse>(
                service, METHODID_UPLOAD_ATTACHMENT)))
        .build();
  }

  private static abstract class AgentRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentRunCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentrun.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentRunCommandController");
    }
  }

  private static final class AgentRunCommandControllerFileDescriptorSupplier
      extends AgentRunCommandControllerBaseDescriptorSupplier {
    AgentRunCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentRunCommandControllerMethodDescriptorSupplier
      extends AgentRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentRunCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentRunCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentRunCommandControllerFileDescriptorSupplier())
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
