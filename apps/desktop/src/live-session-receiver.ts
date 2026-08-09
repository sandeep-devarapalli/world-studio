import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { LiveReceiverState, LiveSessionSnapshot } from "@world-studio/world-core";
import {
  LiveContractError,
  assertLiveAssetRole,
  parseLiveJson,
  validSessionId,
  validateLiveFinalize,
  validateLiveFrame,
  validateLiveSessionDeclaration,
  type LiveAck,
  type LiveAssetRole
} from "./live-session-contract.js";
import {
  LiveSessionStore,
  type LiveFramePreviewBytes,
  type LiveStoreSnapshot
} from "./live-session-store.js";
import {
  LIVE_AUTH_ERROR_SCHEMA,
  type LiveAuthReceipt
} from "./live-auth-contract.js";

const apiRoot = "/api/capture-splat/live/v0.1";
const defaultHost = "127.0.0.1";
const defaultPort = 43127;
const defaultMaxJsonBytes = 1024 * 1024;

export interface LiveSessionReceiverOptions {
  root: string;
  host?: string;
  port?: number;
  maxJsonBytes?: number;
  maxAssetBytes?: number;
}

export interface LiveRequestContext {
  expectedBodySha256?: string;
  authReceipt?: LiveAuthReceipt;
  onSessionAuthorized?: () => Promise<void>;
}

export type LiveSessionUpdateListener = (snapshot: LiveSessionSnapshot) => void;

export class LiveSessionReceiver {
  readonly store: LiveSessionStore;
  readonly host: string;
  readonly requestedPort: number;
  readonly maxJsonBytes: number;
  private server: Server | null = null;
  private actualPort: number | null = null;
  private receiverState: LiveReceiverState = "stopped";
  private activeSessionId: string | null = null;
  private lastError: string | undefined;
  private readonly listeners = new Set<LiveSessionUpdateListener>();
  private readonly socketSessions = new Map<Socket, Set<string>>();

  constructor(options: LiveSessionReceiverOptions) {
    const envHost = process.env.WORLD_STUDIO_LIVE_HOST;
    const envPort = process.env.WORLD_STUDIO_LIVE_PORT;
    this.host = options.host ?? envHost ?? defaultHost;
    if (this.host !== "127.0.0.1" && this.host !== "::1") {
      throw new LiveContractError("The Phase 1 receiver may listen only on loopback.");
    }
    this.requestedPort = options.port ?? parsePort(envPort) ?? defaultPort;
    if (!Number.isSafeInteger(this.requestedPort) || this.requestedPort < 0 || this.requestedPort > 65_535) {
      throw new LiveContractError("Receiver port must be an integer from 0 through 65535.");
    }
    this.maxJsonBytes = options.maxJsonBytes ?? defaultMaxJsonBytes;
    if (!Number.isSafeInteger(this.maxJsonBytes) || this.maxJsonBytes < 1) {
      throw new LiveContractError("maxJsonBytes must be a positive integer.");
    }
    this.store = new LiveSessionStore(options.root, { maxAssetBytes: options.maxAssetBytes });
  }

  async start(): Promise<LiveSessionSnapshot> {
    if (this.server) return this.status();
    await this.store.initialize();
    const server = createServer((request, response) => {
      void this.dispatch(request, response);
    });
    server.on("connection", (socket) => {
      this.registerSocket(socket);
    });
    server.on("clientError", (_error, socket) => {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.requestedPort, this.host);
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new LiveContractError("Receiver did not expose a TCP port.", "corrupt");
    this.actualPort = address.port;
    this.receiverState = "listening";
    this.lastError = undefined;
    return this.emitCurrent();
  }

  async stop(): Promise<LiveSessionSnapshot> {
    const server = this.server;
    this.receiverState = "stopped";
    if (server) {
      this.server = null;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    this.actualPort = null;
    this.socketSessions.clear();
    return this.emitCurrent();
  }

  async status(): Promise<LiveSessionSnapshot> {
    return this.buildSnapshot();
  }

  subscribe(listener: LiveSessionUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async markTransportInterrupted(): Promise<LiveSessionSnapshot> {
    if (
      this.activeSessionId
      && this.receiverState !== "finalized"
      && this.receiverState !== "stopped"
      && this.receiverState !== "interrupted"
    ) {
      this.receiverState = "interrupted";
    }
    return this.emitCurrent();
  }

  async readFramePreview(
    sessionId: string,
    sequenceId: number,
    role: LiveAssetRole = "source",
    maxBytes?: number
  ): Promise<LiveFramePreviewBytes | null> {
    return this.store.readFramePreview(sessionId, sequenceId, role, maxBytes);
  }

  async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    context: LiveRequestContext = {}
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", this.host === "::1" ? "http://[::1]" : `http://${this.host}`);
      const pathParts = decodePath(url.pathname);
      if (request.method === "GET" && url.pathname === `${apiRoot}/health`) {
        sendJson(response, 200, {
          schema: "capture_splat.live_receiver_health.v0.1",
          ok: true,
          receiver: await this.buildSnapshot()
        });
        return;
      }
      if (request.method === "GET" && url.pathname === `${apiRoot}/status`) {
        sendJson(response, 200, await this.buildSnapshot());
        return;
      }
      if (pathParts[0] !== "sessions" || !pathParts[1]) {
        throw new RouteError(404, "Endpoint not found.");
      }
      const sessionId = validSessionId(pathParts[1]);
      this.trackSocket(request.socket, sessionId);
      if (pathParts.length === 2 && request.method === "PUT") {
        const session = validateLiveSessionDeclaration(
          await readJsonRequest(request, this.maxJsonBytes, context.expectedBodySha256)
        );
        if (session.session_id !== sessionId) throw new LiveContractError("Route and session body IDs differ.", "conflict");
        const ack = await this.store.putSession(session, context.authReceipt);
        await context.onSessionAuthorized?.();
        await this.activate(
          sessionId,
          ack.finalized
            ? "finalized"
            : ack.status === "duplicate" && ack.received_count > 0
              ? "resuming"
              : "receiving"
        );
        sendJson(response, 200, ack);
        return;
      }
      if (pathParts.length === 2 && request.method === "GET") {
        const ack = await this.store.resume(sessionId, context.authReceipt);
        await context.onSessionAuthorized?.();
        if (ack.finalized) {
          await this.activate(sessionId, "finalized");
        } else if (this.receiverState === "interrupted" || this.activeSessionId !== sessionId) {
          await this.activate(sessionId, "resuming");
        }
        sendJson(response, 200, ack);
        return;
      }
      if (pathParts.length === 2) throw new RouteError(405, "Method not allowed for endpoint.");
      if (pathParts.length === 3 && pathParts[2] === "finalize") {
        if (request.method !== "POST") throw new RouteError(405, "Method not allowed for endpoint.");
        const finalize = validateLiveFinalize(await readJsonRequest(request, this.maxJsonBytes, context.expectedBodySha256));
        if (finalize.session_id !== sessionId) throw new LiveContractError("Route and finalization body IDs differ.", "conflict");
        const ack = await this.store.finalize(finalize, context.authReceipt);
        await context.onSessionAuthorized?.();
        await this.activate(sessionId, "finalized");
        sendJson(response, 200, ack);
        return;
      }
      if (pathParts[2] !== "frames" || !pathParts[3]) throw new RouteError(404, "Endpoint not found.");
      const sequenceId = parseSequenceId(pathParts[3]);
      if (pathParts.length === 4 && request.method === "PUT") {
        const frame = validateLiveFrame(await readJsonRequest(request, this.maxJsonBytes, context.expectedBodySha256));
        if (frame.session_id !== sessionId || frame.sequence_id !== sequenceId) {
          throw new LiveContractError("Route and frame metadata identity differ.", "conflict");
        }
        const ack = await this.store.putFrame(frame, context.authReceipt);
        await context.onSessionAuthorized?.();
        await this.activate(sessionId, "receiving");
        sendJson(response, ack.status === "incomplete" ? 202 : 200, ack);
        return;
      }
      if (pathParts.length === 6 && pathParts[4] === "assets" && request.method === "PUT") {
        const role = assertLiveAssetRole(pathParts[5] ?? "");
        const ack = await this.store.putAsset(
          sessionId,
          sequenceId,
          role,
          request,
          context.expectedBodySha256,
          context.authReceipt
        );
        await context.onSessionAuthorized?.();
        await this.activate(sessionId, "receiving");
        sendJson(response, ack.status === "incomplete" ? 202 : 200, ack);
        return;
      }
      throw new RouteError(405, "Method not allowed for endpoint.");
    } catch (error) {
      const statusCode = error instanceof RouteError
        ? error.statusCode
        : error instanceof LiveContractError
          ? error.statusCode
          : 500;
      const message = error instanceof Error ? error.message : "Unknown receiver error.";
      this.lastError = statusCode >= 500 ? message : undefined;
      if (!response.headersSent) {
        if (error instanceof LiveContractError && error.code === "auth_body") {
          sendJson(response, statusCode, {
            schema: LIVE_AUTH_ERROR_SCHEMA,
            code: "body_digest_mismatch",
            retryable: true
          });
        } else {
          sendJson(response, statusCode, {
            schema: "capture_splat.live_error.v0.1",
            error: error instanceof LiveContractError
              ? error.code
              : error instanceof RouteError
                ? error.statusCode === 404 ? "not_found" : "method_not_allowed"
                : "internal_error",
            message
          });
        }
      } else {
        response.destroy();
      }
      if (statusCode >= 500) await this.emitCurrent();
    }
  }

  private trackSocket(socket: Socket, sessionId: string): void {
    const sessions = this.registerSocket(socket);
    sessions.add(sessionId);
  }

  private registerSocket(socket: Socket): Set<string> {
    const existing = this.socketSessions.get(socket);
    if (existing) return existing;
    const sessions = new Set<string>();
    this.socketSessions.set(socket, sessions);
    socket.once("close", () => {
      const closedSessions = this.socketSessions.get(socket);
      if (!closedSessions) return;
      this.socketSessions.delete(socket);
      if (
        this.receiverState !== "stopped"
        && this.receiverState !== "finalized"
        && this.activeSessionId
        && closedSessions.has(this.activeSessionId)
        && ![...this.socketSessions.values()].some(
          (otherSessions) => otherSessions.has(this.activeSessionId!)
        )
      ) {
        this.receiverState = "interrupted";
        void this.emitCurrent();
      }
    });
    return sessions;
  }

  private async activate(sessionId: string, state: LiveReceiverState): Promise<void> {
    this.activeSessionId = sessionId;
    this.receiverState = state;
    this.lastError = undefined;
    await this.emitCurrent();
  }

  private async emitCurrent(): Promise<LiveSessionSnapshot> {
    const snapshot = await this.buildSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A stale renderer subscription must not change a durable transport ACK.
      }
    }
    return snapshot;
  }

  private async buildSnapshot(): Promise<LiveSessionSnapshot> {
    const listening = this.actualPort === null ? null : { host: this.host, port: this.actualPort };
    if (!this.activeSessionId) {
      return emptySnapshot(this.receiverState, listening, this.lastError);
    }
    try {
      const stored = await this.store.snapshot(this.activeSessionId);
      return snapshotFromStore(this.receiverState, listening, stored, this.lastError);
    } catch (error) {
      if (error instanceof LiveContractError && error.code === "not_found") {
        return emptySnapshot(this.receiverState, listening, this.lastError);
      }
      throw error;
    }
  }
}

function snapshotFromStore(
  state: LiveReceiverState,
  listening: LiveSessionSnapshot["listening"],
  stored: LiveStoreSnapshot,
  error?: string
): LiveSessionSnapshot {
  return {
    state,
    listening,
    sessionId: stored.sessionId,
    sourceManifestId: stored.sourceManifestId,
    coordinateUnits: stored.coordinateUnits,
    expectedCount: stored.expectedCount,
    finalSequenceId: stored.finalSequenceId,
    receivedCount: stored.receivedCount,
    contiguousCount: stored.contiguousCount,
    pendingCount: stored.pendingCount,
    missingCount: stored.missingCount,
    nextExpectedSequenceId: stored.nextExpectedSequenceId,
    missingRanges: stored.missingRanges,
    frames: stored.frames,
    authority: "proposal_only",
    updatedAt: stored.updatedAt,
    ...(error ? { error } : {})
  };
}

function emptySnapshot(
  state: LiveReceiverState,
  listening: LiveSessionSnapshot["listening"],
  error?: string
): LiveSessionSnapshot {
  return {
    state,
    listening,
    sessionId: null,
    sourceManifestId: null,
    coordinateUnits: null,
    expectedCount: null,
    finalSequenceId: null,
    receivedCount: 0,
    contiguousCount: 0,
    pendingCount: 0,
    missingCount: 0,
    nextExpectedSequenceId: 1,
    missingRanges: [],
    frames: [],
    authority: "proposal_only",
    updatedAt: null,
    ...(error ? { error } : {})
  };
}

async function readJsonRequest(
  request: IncomingMessage,
  maxBytes: number,
  expectedBodySha256?: string
): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new LiveContractError("JSON requests require Content-Type: application/json.");
  }
  if (request.headers["content-encoding"]) throw new LiveContractError("Compressed request bodies are not accepted.");
  const declaredLength = parseContentLength(request.headers["content-length"]);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new LiveContractError("JSON request exceeds the receiver byte limit.");
  }
  const chunks: Buffer[] = [];
  const digest = expectedBodySha256 ? createHash("sha256") : null;
  let received = 0;
  try {
    for await (const value of request) {
      const chunk = Buffer.from(value);
      received += chunk.byteLength;
      if (received > maxBytes) throw new LiveContractError("JSON request exceeds the receiver byte limit.");
      digest?.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof LiveContractError) throw error;
    throw new LiveContractError(
      "Request body was truncated.",
      expectedBodySha256 ? "auth_body" : "bad_request"
    );
  }
  if (declaredLength !== undefined && received !== declaredLength) {
    throw new LiveContractError(
      "Request body was truncated.",
      expectedBodySha256 ? "auth_body" : "bad_request"
    );
  }
  if (
    expectedBodySha256
    && (!/^sha256:[0-9a-f]{64}$/.test(expectedBodySha256) || `sha256:${digest!.digest("hex")}` !== expectedBodySha256)
  ) {
    throw new LiveContractError("Authenticated body SHA-256 mismatch.", "auth_body");
  }
  return parseLiveJson(Buffer.concat(chunks).toString("utf8"));
}

function decodePath(pathname: string): string[] {
  if (!pathname.startsWith(`${apiRoot}/`)) return [];
  return pathname
    .slice(apiRoot.length + 1)
    .split("/")
    .map((part) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        throw new LiveContractError("URL path contains invalid percent encoding.");
      }
      if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
        throw new LiveContractError("URL path contains an unsafe segment.");
      }
      return decoded;
    });
}

function parseSequenceId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new LiveContractError("Frame route sequence must be a positive integer.");
  const sequenceId = Number(value);
  if (!Number.isSafeInteger(sequenceId)) throw new LiveContractError("Frame route sequence is too large.");
  return sequenceId;
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new LiveContractError("Content-Length is invalid.");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new LiveContractError("Content-Length is too large.");
  return length;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new LiveContractError("WORLD_STUDIO_LIVE_PORT is invalid.");
  return Number(value);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "RouteError";
  }
}
