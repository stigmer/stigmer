// Raw leading-comment lookup over SourceCodeInfo.
//
// The retired Go extractor read comments through protoreflect's per-element
// source info; the committed schemas therefore contain the RAW
// leading_comments text (one leading space per line preserved, outer
// whitespace trimmed later by internalcomment.stripText). protobuf-es
// deliberately does not surface raw comments on descriptors, so this module
// indexes each file's SourceCodeInfo by location path and computes the
// standard descriptor paths (FileDescriptorProto field numbers) for the
// elements the extractor documents: messages, fields, enums, enum values,
// and service methods.

import type {
  DescEnum,
  DescEnumValue,
  DescField,
  DescFile,
  DescMessage,
  DescMethod,
} from "@bufbuild/protobuf";

// FileDescriptorProto / DescriptorProto field numbers used in
// SourceCodeInfo paths.
const FILE_MESSAGE = 4;
const FILE_ENUM = 5;
const FILE_SERVICE = 6;
const MESSAGE_FIELD = 2;
const MESSAGE_NESTED = 3;
const MESSAGE_ENUM = 4;
const ENUM_VALUE = 2;
const SERVICE_METHOD = 2;

export class CommentIndex {
  private readonly byFile = new Map<string, Map<string, string>>();

  /** Returns the raw leading comment for a message, or "". */
  message(msg: DescMessage): string {
    return this.lookup(msg.file, messagePath(msg));
  }

  /** Returns the raw leading comment for a field, or "". */
  field(field: DescField): string {
    const path = messagePath(field.parent);
    path.push(MESSAGE_FIELD, field.parent.proto.field.indexOf(field.proto));
    return this.lookup(field.parent.file, path);
  }

  /** Returns the raw leading comment for an enum, or "". */
  enum(desc: DescEnum): string {
    return this.lookup(desc.file, enumPath(desc));
  }

  /** Returns the raw leading comment for an enum value, or "". */
  enumValue(value: DescEnumValue): string {
    const path = enumPath(value.parent);
    path.push(ENUM_VALUE, value.parent.proto.value.indexOf(value.proto));
    return this.lookup(value.parent.file, path);
  }

  /** Returns the raw leading comment for a service method, or "". */
  method(method: DescMethod): string {
    const file = method.parent.file;
    const path = [
      FILE_SERVICE,
      file.proto.service.indexOf(method.parent.proto),
      SERVICE_METHOD,
      method.parent.proto.method.indexOf(method.proto),
    ];
    return this.lookup(file, path);
  }

  private lookup(file: DescFile, path: number[]): string {
    let index = this.byFile.get(file.proto.name);
    if (index === undefined) {
      index = buildIndex(file);
      this.byFile.set(file.proto.name, index);
    }
    return index.get(path.join(",")) ?? "";
  }
}

function buildIndex(file: DescFile): Map<string, string> {
  const index = new Map<string, string>();
  const info = file.proto.sourceCodeInfo;
  if (info === undefined) return index;
  for (const location of info.location) {
    if (location.leadingComments !== undefined) {
      index.set(location.path.join(","), location.leadingComments);
    }
  }
  return index;
}

function messagePath(msg: DescMessage): number[] {
  if (msg.parent === undefined) {
    return [FILE_MESSAGE, msg.file.proto.messageType.indexOf(msg.proto)];
  }
  const path = messagePath(msg.parent);
  path.push(MESSAGE_NESTED, msg.parent.proto.nestedType.indexOf(msg.proto));
  return path;
}

function enumPath(desc: DescEnum): number[] {
  if (desc.parent === undefined) {
    return [FILE_ENUM, desc.file.proto.enumType.indexOf(desc.proto)];
  }
  const path = messagePath(desc.parent);
  path.push(MESSAGE_ENUM, desc.parent.proto.enumType.indexOf(desc.proto));
  return path;
}
