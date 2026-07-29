export const LIVE_SESSION_SCHEMA = "capture_splat.live_session.v0.1" as const;
export const LIVE_FRAME_SCHEMA = "capture_splat.live_frame.v0.1" as const;
export const LIVE_ACK_SCHEMA = "capture_splat.live_ack.v0.1" as const;
export const LIVE_FINALIZE_SCHEMA = "capture_splat.live_finalize.v0.1" as const;

export type LiveAssetRole =
  | "source"
  | "depth"
  | "confidence"
  | "mask-person"
  | "mask-valid"
  | "mask-object";

export interface LiveAssetReference {
  path: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  width?: number;
  height?: number;
}

export interface LiveSourceFrameReference extends LiveAssetReference {
  width: number;
  height: number;
}

export interface LiveMaskReference extends LiveAssetReference {
  kind: "person" | "valid" | "object";
}

export interface LiveSession {
  schema: typeof LIVE_SESSION_SCHEMA;
  session_id: string;
  created_at: string;
  source_manifest: {
    path: string;
    sha256: string;
    size_bytes: number;
    schema: string;
  };
  expected_frame_count?: number;
  coordinate_system: {
    id: string;
    units: "meters" | "unknown";
    handedness: "right";
    world_up: "+Y";
    camera_forward: "-Z";
    matrix_layout: "row-major";
    vector_convention: "column-vector";
  };
  authority: "proposal_only";
}

export interface LiveFrame {
  schema: typeof LIVE_FRAME_SCHEMA;
  session_id: string;
  sequence_id: number;
  timestamp: {
    value: number;
    clock_domain: "arkit_session" | "media" | "monotonic" | "unknown";
  };
  source_frame: LiveSourceFrameReference;
  intrinsics: {
    model: "pinhole";
    fl_x: number;
    fl_y: number;
    cx: number;
    cy: number;
    calibration_width: number;
    calibration_height: number;
    applies_to: "source_frame" | "depth" | "confidence" | "unknown";
  };
  camera_to_world: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
  ];
  coordinate_frame: string;
  tracking: {
    state: string;
  };
  quality: {
    accepted: boolean;
    reason?: string;
    score?: number;
    blur_score?: number;
    exposure_mean?: number;
    exposure_delta?: number;
    clipped_highlight_fraction?: number;
    near_clipped_highlight_fraction?: number;
    clipped_shadow_fraction?: number;
    feature_grid_coverage?: number;
    parallax_meters?: number;
    angular_velocity_deg_s?: number;
    translation_speed_m_s?: number;
    colmap_overlap_score?: number;
    valid_depth_ratio?: number;
    feature_point_count?: number;
  };
  assets?: {
    depth?: LiveAssetReference;
    confidence?: LiveAssetReference;
    masks?: LiveMaskReference[];
  };
}

export interface LiveMissingRange {
  start: number;
  end: number;
}

export interface LiveAck {
  schema: typeof LIVE_ACK_SCHEMA;
  session_id: string;
  operation: "session" | "frame" | "asset" | "resume" | "finalize";
  status: "accepted" | "duplicate" | "incomplete" | "finalized";
  sequence_id?: number;
  asset_role?: LiveAssetRole;
  received_count: number;
  contiguous_count: number;
  pending_count: number;
  expected_frame_count: number | null;
  next_expected_sequence_id: number;
  missing_ranges: LiveMissingRange[];
  finalized: boolean;
  message?: string;
}

export interface LiveFinalizeRequest {
  schema: typeof LIVE_FINALIZE_SCHEMA;
  session_id: string;
  final_sequence_id: number;
}

export interface DeclaredLiveAsset {
  role: LiveAssetRole;
  reference: LiveAssetReference;
}

export class LiveContractError extends Error {
  readonly code: "bad_request" | "conflict" | "not_found" | "sealed" | "corrupt";
  readonly statusCode: number;

  constructor(
    message: string,
    code: LiveContractError["code"] = "bad_request",
    statusCode = code === "not_found" ? 404 : code === "bad_request" ? 400 : 409
  ) {
    super(message);
    this.name = "LiveContractError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const rfc3339DateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseLiveJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LiveContractError("Request body must be complete, strict JSON.");
  }
}

export function validateLiveSession(value: unknown): LiveSession {
  const session = record(value, "session");
  exactKeys(session, [
    "schema",
    "session_id",
    "created_at",
    "source_manifest",
    "expected_frame_count",
    "coordinate_system",
    "authority"
  ], "session");
  literal(session.schema, LIVE_SESSION_SCHEMA, "session.schema");
  const sessionId = validSessionId(session.session_id);
  const createdAt = requiredString(session.created_at, "session.created_at");
  if (!rfc3339DateTimePattern.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new LiveContractError("session.created_at must be an RFC 3339 timestamp.");
  }
  const sourceManifest = record(session.source_manifest, "session.source_manifest");
  exactKeys(sourceManifest, ["path", "sha256", "size_bytes", "schema"], "session.source_manifest");
  const coordinateSystem = record(session.coordinate_system, "session.coordinate_system");
  exactKeys(coordinateSystem, [
    "id",
    "units",
    "handedness",
    "world_up",
    "camera_forward",
    "matrix_layout",
    "vector_convention"
  ], "session.coordinate_system");
  const expectedFrameCount = session.expected_frame_count === undefined
    ? undefined
    : positiveInteger(session.expected_frame_count, "session.expected_frame_count");
  literal(session.authority, "proposal_only", "session.authority");
  literalOneOf(coordinateSystem.units, ["meters", "unknown"], "session.coordinate_system.units");
  literal(coordinateSystem.handedness, "right", "session.coordinate_system.handedness");
  literal(coordinateSystem.world_up, "+Y", "session.coordinate_system.world_up");
  literal(coordinateSystem.camera_forward, "-Z", "session.coordinate_system.camera_forward");
  literal(coordinateSystem.matrix_layout, "row-major", "session.coordinate_system.matrix_layout");
  literal(coordinateSystem.vector_convention, "column-vector", "session.coordinate_system.vector_convention");
  return {
    schema: LIVE_SESSION_SCHEMA,
    session_id: sessionId,
    created_at: createdAt,
    source_manifest: {
      path: safeRelativePath(sourceManifest.path, "session.source_manifest.path"),
      sha256: validSha256(sourceManifest.sha256, "session.source_manifest.sha256"),
      size_bytes: positiveInteger(sourceManifest.size_bytes, "session.source_manifest.size_bytes"),
      schema: requiredString(sourceManifest.schema, "session.source_manifest.schema")
    },
    ...(expectedFrameCount === undefined ? {} : { expected_frame_count: expectedFrameCount }),
    coordinate_system: {
      id: requiredString(coordinateSystem.id, "session.coordinate_system.id"),
      units: coordinateSystem.units as "meters" | "unknown",
      handedness: "right",
      world_up: "+Y",
      camera_forward: "-Z",
      matrix_layout: "row-major",
      vector_convention: "column-vector"
    },
    authority: "proposal_only"
  };
}

export function validateLiveFrame(value: unknown): LiveFrame {
  const frame = record(value, "frame");
  exactKeys(frame, [
    "schema",
    "session_id",
    "sequence_id",
    "timestamp",
    "source_frame",
    "intrinsics",
    "camera_to_world",
    "coordinate_frame",
    "tracking",
    "quality",
    "assets"
  ], "frame");
  literal(frame.schema, LIVE_FRAME_SCHEMA, "frame.schema");
  const timestamp = record(frame.timestamp, "frame.timestamp");
  exactKeys(timestamp, ["value", "clock_domain"], "frame.timestamp");
  literalOneOf(timestamp.clock_domain, ["arkit_session", "media", "monotonic", "unknown"], "frame.timestamp.clock_domain");
  const sourceFrame = validateAssetReference(frame.source_frame, "frame.source_frame", true);
  const intrinsics = record(frame.intrinsics, "frame.intrinsics");
  exactKeys(intrinsics, [
    "model",
    "fl_x",
    "fl_y",
    "cx",
    "cy",
    "calibration_width",
    "calibration_height",
    "applies_to"
  ], "frame.intrinsics");
  literal(intrinsics.model, "pinhole", "frame.intrinsics.model");
  literalOneOf(intrinsics.applies_to, ["source_frame", "depth", "confidence", "unknown"], "frame.intrinsics.applies_to");
  const matrix = finiteTuple(frame.camera_to_world, 16, "frame.camera_to_world");
  const tracking = record(frame.tracking, "frame.tracking");
  exactKeys(tracking, ["state"], "frame.tracking");
  const quality = validateQuality(frame.quality);
  const assets = frame.assets === undefined ? undefined : validateAssets(frame.assets);
  return {
    schema: LIVE_FRAME_SCHEMA,
    session_id: validSessionId(frame.session_id),
    sequence_id: positiveInteger(frame.sequence_id, "frame.sequence_id"),
    timestamp: {
      value: nonNegativeFinite(timestamp.value, "frame.timestamp.value"),
      clock_domain: timestamp.clock_domain as LiveFrame["timestamp"]["clock_domain"]
    },
    source_frame: sourceFrame as LiveSourceFrameReference,
    intrinsics: {
      model: "pinhole",
      fl_x: positiveFinite(intrinsics.fl_x, "frame.intrinsics.fl_x"),
      fl_y: positiveFinite(intrinsics.fl_y, "frame.intrinsics.fl_y"),
      cx: finiteNumber(intrinsics.cx, "frame.intrinsics.cx"),
      cy: finiteNumber(intrinsics.cy, "frame.intrinsics.cy"),
      calibration_width: positiveInteger(intrinsics.calibration_width, "frame.intrinsics.calibration_width"),
      calibration_height: positiveInteger(intrinsics.calibration_height, "frame.intrinsics.calibration_height"),
      applies_to: intrinsics.applies_to as LiveFrame["intrinsics"]["applies_to"]
    },
    camera_to_world: matrix as LiveFrame["camera_to_world"],
    coordinate_frame: requiredString(frame.coordinate_frame, "frame.coordinate_frame"),
    tracking: { state: requiredString(tracking.state, "frame.tracking.state") },
    quality,
    ...(assets ? { assets } : {})
  };
}

export function validateLiveFinalize(value: unknown): LiveFinalizeRequest {
  const finalize = record(value, "finalize");
  exactKeys(finalize, ["schema", "session_id", "final_sequence_id"], "finalize");
  literal(finalize.schema, LIVE_FINALIZE_SCHEMA, "finalize.schema");
  return {
    schema: LIVE_FINALIZE_SCHEMA,
    session_id: validSessionId(finalize.session_id),
    final_sequence_id: positiveInteger(finalize.final_sequence_id, "finalize.final_sequence_id")
  };
}

export function validateLiveAck(value: unknown): LiveAck {
  const ack = record(value, "ack");
  exactKeys(ack, [
    "schema",
    "session_id",
    "operation",
    "status",
    "sequence_id",
    "asset_role",
    "received_count",
    "contiguous_count",
    "pending_count",
    "expected_frame_count",
    "next_expected_sequence_id",
    "missing_ranges",
    "finalized",
    "message"
  ], "ack");
  literal(ack.schema, LIVE_ACK_SCHEMA, "ack.schema");
  literalOneOf(ack.operation, ["session", "frame", "asset", "resume", "finalize"], "ack.operation");
  literalOneOf(ack.status, ["accepted", "duplicate", "incomplete", "finalized"], "ack.status");
  if (ack.expected_frame_count !== null) {
    positiveInteger(ack.expected_frame_count, "ack.expected_frame_count");
  }
  if (!Array.isArray(ack.missing_ranges)) {
    throw new LiveContractError("ack.missing_ranges must be an array.");
  }
  let previousEnd = 0;
  const missingRanges = ack.missing_ranges.map((value, index) => {
    const range = record(value, `ack.missing_ranges[${index}]`);
    exactKeys(range, ["start", "end"], `ack.missing_ranges[${index}]`);
    const start = positiveInteger(range.start, `ack.missing_ranges[${index}].start`);
    const end = positiveInteger(range.end, `ack.missing_ranges[${index}].end`);
    if (end < start) throw new LiveContractError(`ack.missing_ranges[${index}].end must be at least start.`);
    if (start <= previousEnd) throw new LiveContractError("ack.missing_ranges must be sorted and disjoint.");
    previousEnd = end;
    return { start, end };
  });
  if (typeof ack.finalized !== "boolean") throw new LiveContractError("ack.finalized must be boolean.");
  const sequenceId = ack.sequence_id === undefined ? undefined : positiveInteger(ack.sequence_id, "ack.sequence_id");
  const assetRole = ack.asset_role === undefined
    ? undefined
    : assertLiveAssetRole(requiredString(ack.asset_role, "ack.asset_role"));
  const message = ack.message === undefined ? undefined : requiredString(ack.message, "ack.message");
  return {
    schema: LIVE_ACK_SCHEMA,
    session_id: validSessionId(ack.session_id),
    operation: ack.operation as LiveAck["operation"],
    status: ack.status as LiveAck["status"],
    ...(sequenceId === undefined ? {} : { sequence_id: sequenceId }),
    ...(assetRole === undefined ? {} : { asset_role: assetRole }),
    received_count: nonNegativeInteger(ack.received_count, "ack.received_count"),
    contiguous_count: nonNegativeInteger(ack.contiguous_count, "ack.contiguous_count"),
    pending_count: nonNegativeInteger(ack.pending_count, "ack.pending_count"),
    expected_frame_count: ack.expected_frame_count as number | null,
    next_expected_sequence_id: positiveInteger(ack.next_expected_sequence_id, "ack.next_expected_sequence_id"),
    missing_ranges: missingRanges,
    finalized: ack.finalized,
    ...(message === undefined ? {} : { message })
  };
}

export function declaredLiveAssets(frame: LiveFrame): DeclaredLiveAsset[] {
  const assets: DeclaredLiveAsset[] = [{ role: "source", reference: frame.source_frame }];
  if (frame.assets?.depth) assets.push({ role: "depth", reference: frame.assets.depth });
  if (frame.assets?.confidence) assets.push({ role: "confidence", reference: frame.assets.confidence });
  for (const mask of frame.assets?.masks ?? []) {
    assets.push({ role: `mask-${mask.kind}`, reference: mask });
  }
  return assets;
}

export function assertLiveAssetRole(value: string): LiveAssetRole {
  if (["source", "depth", "confidence", "mask-person", "mask-valid", "mask-object"].includes(value)) {
    return value as LiveAssetRole;
  }
  throw new LiveContractError(`Unsupported asset role: ${value}.`);
}

export function safeRelativePath(value: unknown, label = "path"): string {
  const text = requiredString(value, label);
  if (
    text.startsWith("/")
    || text.includes("\\")
    || text.includes("\0")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
  ) {
    throw new LiveContractError(`${label} must be a safe POSIX-relative path.`);
  }
  const parts = text.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new LiveContractError(`${label} must be a safe POSIX-relative path.`);
  }
  return text;
}

export function validSessionId(value: unknown): string {
  const text = requiredString(value, "session_id");
  if (!sessionIdPattern.test(text) || text === "." || text === "..") {
    throw new LiveContractError("session_id contains unsupported characters.");
  }
  return text;
}

export function stableLiveJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function validateAssets(value: unknown): NonNullable<LiveFrame["assets"]> {
  const assets = record(value, "frame.assets");
  exactKeys(assets, ["depth", "confidence", "masks"], "frame.assets");
  if (!Object.keys(assets).length) throw new LiveContractError("frame.assets must declare at least one asset.");
  const depth = assets.depth === undefined ? undefined : validateAssetReference(assets.depth, "frame.assets.depth");
  const confidence = assets.confidence === undefined
    ? undefined
    : validateAssetReference(assets.confidence, "frame.assets.confidence");
  let masks: LiveMaskReference[] | undefined;
  if (assets.masks !== undefined) {
    if (!Array.isArray(assets.masks) || assets.masks.length < 1 || assets.masks.length > 3) {
      throw new LiveContractError("frame.assets.masks must contain one to three masks.");
    }
    const seen = new Set<string>();
    masks = assets.masks.map((value, index) => {
      const mask = record(value, `frame.assets.masks[${index}]`);
      exactKeys(mask, ["kind", "path", "sha256", "size_bytes", "media_type", "width", "height"], `frame.assets.masks[${index}]`);
      literalOneOf(mask.kind, ["person", "valid", "object"], `frame.assets.masks[${index}].kind`);
      if (seen.has(mask.kind as string)) throw new LiveContractError(`Duplicate ${String(mask.kind)} mask.`);
      seen.add(mask.kind as string);
      return {
        ...validateAssetReference(mask, `frame.assets.masks[${index}]`),
        kind: mask.kind as LiveMaskReference["kind"]
      };
    });
  }
  return {
    ...(depth ? { depth } : {}),
    ...(confidence ? { confidence } : {}),
    ...(masks ? { masks } : {})
  };
}

function validateAssetReference(value: unknown, label: string, requireDimensions = false): LiveAssetReference {
  const asset = record(value, label);
  exactKeys(asset, ["path", "sha256", "size_bytes", "media_type", "width", "height", ...(label.includes("masks[") ? ["kind"] : [])], label);
  const width = asset.width === undefined ? undefined : positiveInteger(asset.width, `${label}.width`);
  const height = asset.height === undefined ? undefined : positiveInteger(asset.height, `${label}.height`);
  if (requireDimensions && (width === undefined || height === undefined)) {
    throw new LiveContractError(`${label} requires width and height.`);
  }
  const mediaType = requiredString(asset.media_type, `${label}.media_type`);
  if (!mediaTypePattern.test(mediaType)) throw new LiveContractError(`${label}.media_type is invalid.`);
  return {
    path: safeRelativePath(asset.path, `${label}.path`),
    sha256: validSha256(asset.sha256, `${label}.sha256`),
    size_bytes: positiveInteger(asset.size_bytes, `${label}.size_bytes`),
    media_type: mediaType,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height })
  };
}

function validateQuality(value: unknown): LiveFrame["quality"] {
  const quality = record(value, "frame.quality");
  const numericKeys = [
    "score",
    "blur_score",
    "exposure_mean",
    "exposure_delta",
    "clipped_highlight_fraction",
    "near_clipped_highlight_fraction",
    "clipped_shadow_fraction",
    "feature_grid_coverage",
    "parallax_meters",
    "angular_velocity_deg_s",
    "translation_speed_m_s",
    "colmap_overlap_score",
    "valid_depth_ratio"
  ] as const;
  exactKeys(quality, ["accepted", "reason", ...numericKeys, "feature_point_count"], "frame.quality");
  if (typeof quality.accepted !== "boolean") throw new LiveContractError("frame.quality.accepted must be boolean.");
  const result: LiveFrame["quality"] = { accepted: quality.accepted };
  if (quality.reason !== undefined) result.reason = requiredString(quality.reason, "frame.quality.reason");
  for (const key of numericKeys) {
    if (quality[key] !== undefined) result[key] = finiteNumber(quality[key], `frame.quality.${key}`);
  }
  if (quality.feature_point_count !== undefined) {
    result.feature_point_count = nonNegativeInteger(quality.feature_point_count, "frame.quality.feature_point_count");
  }
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LiveContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedSet.has(key));
  if (extra) throw new LiveContractError(`${label}.${extra} is not allowed.`);
  const missing = allowed.filter((key) => ![
    "expected_frame_count",
    "assets",
    "sequence_id",
    "asset_role",
    "message",
    "reason",
    "width",
    "height",
    "depth",
    "confidence",
    "masks",
    ...qualityOptionalKeys
  ].includes(key))
    .find((key) => value[key] === undefined);
  if (missing) throw new LiveContractError(`${label}.${missing} is required.`);
}

const qualityOptionalKeys = [
  "score",
  "blur_score",
  "exposure_mean",
  "exposure_delta",
  "clipped_highlight_fraction",
  "near_clipped_highlight_fraction",
  "clipped_shadow_fraction",
  "feature_grid_coverage",
  "parallax_meters",
  "angular_velocity_deg_s",
  "translation_speed_m_s",
  "colmap_overlap_score",
  "valid_depth_ratio",
  "feature_point_count"
];

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length) throw new LiveContractError(`${label} must be a non-empty string.`);
  return value;
}

function literal(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new LiveContractError(`${label} must equal ${expected}.`);
}

function literalOneOf(value: unknown, expected: readonly string[], label: string): void {
  if (typeof value !== "string" || !expected.includes(value)) {
    throw new LiveContractError(`${label} must be one of ${expected.join(", ")}.`);
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new LiveContractError(`${label} must be finite.`);
  return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0) throw new LiveContractError(`${label} must be non-negative.`);
  return number;
}

function positiveFinite(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new LiveContractError(`${label} must be positive.`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) throw new LiveContractError(`${label} must be a non-negative integer.`);
  return number;
}

function positiveInteger(value: unknown, label: string): number {
  const number = nonNegativeInteger(value, label);
  if (number < 1) throw new LiveContractError(`${label} must be at least 1.`);
  return number;
}

function finiteTuple(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new LiveContractError(`${label} must contain ${length} numbers.`);
  return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
}

function validSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new LiveContractError(`${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}
