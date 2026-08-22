export const reducedColliderUnknownClassification = 255;

const maxHeaderBytes = 4096;
const maxColliderBytes = 64 * 1024 * 1024;
const maxVertexCount = 1_000_000;
const maxFaceCount = 60_000;
const vertexStride = 24;
const faceStride = 19;
const headerTerminator = new TextEncoder().encode("end_header\n");

export interface ReducedColliderPlyParseOptions {
  expectedBytes: number;
  expectedVertices: number;
  expectedFaces: number;
  sourceFaceCount: number;
}

export interface ParsedReducedCollider {
  vertices: Float64Array;
  indices: Uint32Array;
  semanticClassifications: Uint8Array;
  semanticSupport: Uint8Array;
  sourceFaceIndices: Uint32Array;
  semanticCounts: Readonly<Record<string, number>>;
  unknownFaceCount: number;
}

export function encodeReducedColliderPly(mesh: ParsedReducedCollider): Uint8Array<ArrayBuffer> {
  const vertexCount = mesh.vertices.length / 3;
  const faceCount = mesh.indices.length / 3;
  if (!Number.isInteger(vertexCount) || !Number.isInteger(faceCount) || mesh.semanticClassifications.length !== faceCount || mesh.semanticSupport.length !== faceCount || mesh.sourceFaceIndices.length !== faceCount) {
    throw new Error("Reduced collider metadata is not face-aligned");
  }
  const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment Capture Splat source-mapped reduced collider; no physics authority\nelement vertex ${vertexCount}\nproperty double x\nproperty double y\nproperty double z\nelement face ${faceCount}\nproperty list uchar uint vertex_indices\nproperty uchar semantic_classification\nproperty uchar semantic_support\nproperty uint source_face_index\nend_header\n`);
  const output = new Uint8Array(header.length + mesh.vertices.length * 8 + faceCount * faceStride);
  output.set(header);
  const view = new DataView(output.buffer);
  let offset = header.length;
  for (const value of mesh.vertices) { view.setFloat64(offset, value, true); offset += 8; }
  for (let face = 0; face < faceCount; face += 1) {
    view.setUint8(offset, 3); offset += 1;
    for (let corner = 0; corner < 3; corner += 1) { view.setUint32(offset, mesh.indices[face * 3 + corner]!, true); offset += 4; }
    view.setUint8(offset, mesh.semanticClassifications[face]!); offset += 1;
    view.setUint8(offset, mesh.semanticSupport[face]!); offset += 1;
    view.setUint32(offset, mesh.sourceFaceIndices[face]!, true); offset += 4;
  }
  return output;
}

export class ReducedColliderPlyStreamParser {
  private header = new Uint8Array();
  private carry = new Uint8Array();
  private bytesSeen = 0;
  private vertexIndex = 0;
  private faceIndex = 0;
  private vertices?: Float64Array;
  private indices?: Uint32Array;
  private semanticClassifications?: Uint8Array;
  private semanticSupport?: Uint8Array;
  private sourceFaceIndices?: Uint32Array;

  constructor(private readonly options: ReducedColliderPlyParseOptions) {
    if (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes <= 0 || options.expectedBytes > maxColliderBytes) {
      throw new Error("Reduced collider byte count is outside the bounded parser domain");
    }
    if (!Number.isSafeInteger(options.expectedVertices) || options.expectedVertices <= 0 || options.expectedVertices > maxVertexCount) {
      throw new Error("Reduced collider vertex count is outside the bounded parser domain");
    }
    if (!Number.isSafeInteger(options.expectedFaces) || options.expectedFaces <= 0 || options.expectedFaces > maxFaceCount) {
      throw new Error("Reduced collider face count is outside the bounded parser domain");
    }
    if (!Number.isSafeInteger(options.sourceFaceCount) || options.sourceFaceCount <= 0 || options.sourceFaceCount > 0xffff_ffff) {
      throw new Error("Reduced collider source face count is invalid");
    }
  }

  push(chunk: Uint8Array): void {
    if (!chunk.byteLength) return;
    this.bytesSeen += chunk.byteLength;
    if (this.bytesSeen > this.options.expectedBytes || this.bytesSeen > maxColliderBytes) {
      throw new Error("Reduced collider exceeds its declared byte count");
    }
    if (!this.vertices) {
      this.header = concatenate(this.header, chunk);
      const end = indexOfBytes(this.header, headerTerminator);
      if (end < 0) {
        if (this.header.byteLength > maxHeaderBytes) throw new Error("Reduced collider PLY header is too large");
        return;
      }
      const headerLength = end + headerTerminator.byteLength;
      this.initialize(this.header.subarray(0, headerLength), headerLength);
      const body = this.header.subarray(headerLength);
      this.header = new Uint8Array();
      this.consumeBody(body);
      return;
    }
    this.consumeBody(chunk);
  }

  finish(): ParsedReducedCollider {
    if (!this.vertices || !this.indices || !this.semanticClassifications || !this.semanticSupport || !this.sourceFaceIndices) {
      throw new Error("Reduced collider PLY header is incomplete");
    }
    if (this.bytesSeen !== this.options.expectedBytes || this.vertexIndex !== this.options.expectedVertices || this.faceIndex !== this.options.expectedFaces) {
      throw new Error("Reduced collider PLY body ended before its declared records");
    }
    if (this.carry.byteLength) throw new Error("Reduced collider PLY contains trailing data");
    const semanticCounts: Record<string, number> = {};
    let unknownFaceCount = 0;
    for (const classification of this.semanticClassifications) {
      const name = semanticName(classification);
      semanticCounts[name] = (semanticCounts[name] ?? 0) + 1;
      if (classification === reducedColliderUnknownClassification) unknownFaceCount += 1;
    }
    return {
      vertices: this.vertices,
      indices: this.indices,
      semanticClassifications: this.semanticClassifications,
      semanticSupport: this.semanticSupport,
      sourceFaceIndices: this.sourceFaceIndices,
      semanticCounts,
      unknownFaceCount
    };
  }

  private initialize(headerBytes: Uint8Array, headerLength: number): void {
    let header: string;
    try {
      header = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(headerBytes);
    } catch {
      throw new Error("Reduced collider PLY header is not strict UTF-8");
    }
    const match = /^ply\nformat binary_little_endian 1\.0\ncomment Capture Splat source-mapped reduced collider; no physics authority\nelement vertex (\d+)\nproperty double x\nproperty double y\nproperty double z\nelement face (\d+)\nproperty list uchar uint vertex_indices\nproperty uchar semantic_classification\nproperty uchar semantic_support\nproperty uint source_face_index\nend_header\n$/.exec(header);
    if (!match || Number(match[1]) !== this.options.expectedVertices || Number(match[2]) !== this.options.expectedFaces) {
      throw new Error("Reduced collider PLY schema or declared counts are invalid");
    }
    const expectedLength = headerLength + this.options.expectedVertices * vertexStride + this.options.expectedFaces * faceStride;
    if (expectedLength !== this.options.expectedBytes) throw new Error("Reduced collider PLY byte layout does not match its declaration");
    this.vertices = new Float64Array(this.options.expectedVertices * 3);
    this.indices = new Uint32Array(this.options.expectedFaces * 3);
    this.semanticClassifications = new Uint8Array(this.options.expectedFaces);
    this.semanticSupport = new Uint8Array(this.options.expectedFaces);
    this.sourceFaceIndices = new Uint32Array(this.options.expectedFaces);
  }

  private consumeBody(chunk: Uint8Array): void {
    const body = this.carry.byteLength ? concatenate(this.carry, chunk) : chunk;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let offset = 0;
    while (this.vertexIndex < this.options.expectedVertices && body.byteLength - offset >= vertexStride) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat64(offset + axis * 8, true);
        if (!Number.isFinite(value)) throw new Error("Reduced collider contains a non-finite vertex");
        this.vertices![this.vertexIndex * 3 + axis] = value;
      }
      this.vertexIndex += 1;
      offset += vertexStride;
    }
    while (this.vertexIndex === this.options.expectedVertices && this.faceIndex < this.options.expectedFaces && body.byteLength - offset >= faceStride) {
      if (view.getUint8(offset) !== 3) throw new Error("Reduced collider contains a non-triangle face");
      const faceOffset = this.faceIndex * 3;
      for (let corner = 0; corner < 3; corner += 1) {
        const index = view.getUint32(offset + 1 + corner * 4, true);
        if (index >= this.options.expectedVertices) throw new Error("Reduced collider contains an out-of-range vertex index");
        this.indices![faceOffset + corner] = index;
      }
      const classification = view.getUint8(offset + 13);
      const support = view.getUint8(offset + 14);
      const sourceFaceIndex = view.getUint32(offset + 15, true);
      if (!isSupportedClassification(classification)) throw new Error("Reduced collider contains an unsupported semantic classification");
      if (support > 4 || (classification !== reducedColliderUnknownClassification && support !== 4)) {
        throw new Error("Reduced collider semantic support is inconsistent with its classification");
      }
      if (sourceFaceIndex >= this.options.sourceFaceCount) throw new Error("Reduced collider source face index is out of range");
      this.assertNonDegenerate(faceOffset);
      this.semanticClassifications![this.faceIndex] = classification;
      this.semanticSupport![this.faceIndex] = support;
      this.sourceFaceIndices![this.faceIndex] = sourceFaceIndex;
      this.faceIndex += 1;
      offset += faceStride;
    }
    this.carry = body.slice(offset);
    if (this.vertexIndex === this.options.expectedVertices && this.faceIndex === this.options.expectedFaces && this.carry.byteLength) {
      throw new Error("Reduced collider PLY contains trailing data");
    }
  }

  private assertNonDegenerate(faceOffset: number): void {
    const vertices = this.vertices!;
    const indices = this.indices!;
    const a = indices[faceOffset]! * 3;
    const b = indices[faceOffset + 1]! * 3;
    const c = indices[faceOffset + 2]! * 3;
    const abx = vertices[b]! - vertices[a]!;
    const aby = vertices[b + 1]! - vertices[a + 1]!;
    const abz = vertices[b + 2]! - vertices[a + 2]!;
    const acx = vertices[c]! - vertices[a]!;
    const acy = vertices[c + 1]! - vertices[a + 1]!;
    const acz = vertices[c + 2]! - vertices[a + 2]!;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (!Number.isFinite(crossX) || !Number.isFinite(crossY) || !Number.isFinite(crossZ) || Math.hypot(crossX, crossY, crossZ) <= 2e-12) {
      throw new Error("Reduced collider contains a non-finite or degenerate face");
    }
  }
}

function isSupportedClassification(value: number): boolean {
  return (value >= 1 && value <= 7) || value === reducedColliderUnknownClassification;
}

function semanticName(value: number): string {
  return ["none", "wall", "floor", "ceiling", "table", "seat", "window", "door"][value] ?? "unknown";
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left);
  output.set(right, left.byteLength);
  return output;
}

function indexOfBytes(source: Uint8Array, needle: Uint8Array): number {
  for (let start = 0; start <= source.byteLength - needle.byteLength; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (source[start + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}
