import type { WorldOrientation } from "@world-studio/world-core";

interface ObjTriangle {
  a: number;
  b: number;
  c: number;
  group: string;
  material?: string;
}

export interface ParsedObjMeshLike {
  vertices: Array<[number, number, number]>;
  triangles: ObjTriangle[];
}

export interface ParsedEvidenceMeshLike extends ParsedObjMeshLike {
  sourceVertexCount: number;
  sourceFaceCount: number;
  sampledFaceCount: number;
  classificationCounts: Record<string, number>;
}

export type WalkCollisionStatus = "accepted_preview" | "held";

export interface WalkCollisionCandidateReport {
  status: WalkCollisionStatus;
  reason: string;
  authority: "local_collision_preview_not_metric_authority";
  sourceVertices: number;
  sourceTriangles: number;
  candidateVertices: number;
  candidateTriangles: number;
  removedDegenerateTriangles: number;
  truncated: boolean;
  floorComponents: number;
  wallComponents: number;
  floorAreaRatio: number;
  wallAreaRatio: number;
}

export interface WalkCollisionCandidate {
  mesh?: ParsedObjMeshLike;
  report: WalkCollisionCandidateReport;
}

export interface CaptureMeshIntegrityReport {
  vertex_count?: number;
  triangle_count?: number;
  non_finite_vertex_count?: number;
  truncated?: boolean;
  status?: string;
}

export interface WalkCollisionOptions {
  maxTriangles?: number;
}

const criticalGroups = new Set(["floor", "wall", "door", "window", "table", "seat", "ceiling", "none"]);

export function sampleEvidenceMesh(mesh: ParsedEvidenceMeshLike, maxTriangles: number): ParsedEvidenceMeshLike {
  const step = Math.max(1, Math.ceil(mesh.triangles.length / Math.max(1, maxTriangles)));
  const triangles = mesh.triangles.filter((_, index) => index % step === 0);
  return { ...mesh, triangles, sampledFaceCount: triangles.length };
}

export function buildWalkCollisionCandidate(
  source: ParsedEvidenceMeshLike,
  integrity: CaptureMeshIntegrityReport | undefined,
  options: WalkCollisionOptions = {}
): WalkCollisionCandidate {
  const maxTriangles = Math.max(500, Math.floor(options.maxTriangles ?? 60_000));
  const held = (reason: string): WalkCollisionCandidate => ({
    report: emptyReport(source, integrity, reason)
  });
  if (!integrity) return held("source_report_missing");
  if (integrity.truncated) return held("source_mesh_truncated");
  if (integrity.status && integrity.status !== "finite_mesh_written") return held("source_mesh_not_finite");
  if (integrity.non_finite_vertex_count) return held("source_report_non_finite_vertices");
  if (integrity.vertex_count !== undefined && integrity.vertex_count !== source.sourceVertexCount) return held("source_vertex_count_mismatch");
  if (integrity.triangle_count !== undefined && integrity.triangle_count !== source.sourceFaceCount) return held("source_triangle_count_mismatch");
  if (source.triangles.length !== source.sourceFaceCount) return held("source_mesh_not_fully_loaded");
  if (source.triangles.some((triangle) => !criticalGroups.has(triangle.group))) return held("source_mesh_unknown_classification");

  const cleaned = removeDegenerateTriangles(source);
  if (!cleaned.triangles.some((triangle) => triangle.group === "floor")) return held("floor_geometry_missing");
  if (!cleaned.triangles.some((triangle) => triangle.group === "wall")) return held("wall_geometry_missing");
  const sourceStats = collisionStats(cleaned);
  if (cleaned.triangles.length > maxTriangles) return held("offline_simplification_required");

  return {
    mesh: cleaned,
    report: {
      status: "accepted_preview",
      reason: "local_candidate_checks_passed",
      authority: "local_collision_preview_not_metric_authority",
      sourceVertices: source.sourceVertexCount,
      sourceTriangles: source.sourceFaceCount,
      candidateVertices: cleaned.vertices.length,
      candidateTriangles: cleaned.triangles.length,
      removedDegenerateTriangles: source.triangles.length - cleaned.triangles.length,
      truncated: false,
      floorComponents: sourceStats.components.floor,
      wallComponents: sourceStats.components.wall,
      floorAreaRatio: 1,
      wallAreaRatio: 1
    }
  };
}

export function orientCollisionMesh(mesh: ParsedObjMeshLike, orientation: WorldOrientation | undefined): ParsedObjMeshLike {
  if (!orientation) return mesh;
  return {
    vertices: mesh.vertices.map((vertex) => rotateVector(orientation.rotation, [
      vertex[0] - orientation.center[0],
      vertex[1] - orientation.center[1],
      vertex[2] - orientation.center[2]
    ])),
    triangles: mesh.triangles
  };
}

function emptyReport(source: ParsedEvidenceMeshLike, integrity: CaptureMeshIntegrityReport | undefined, reason: string): WalkCollisionCandidateReport {
  return {
    status: "held",
    reason,
    authority: "local_collision_preview_not_metric_authority",
    sourceVertices: source.sourceVertexCount,
    sourceTriangles: source.sourceFaceCount,
    candidateVertices: 0,
    candidateTriangles: 0,
    removedDegenerateTriangles: 0,
    truncated: Boolean(integrity?.truncated),
    floorComponents: 0,
    wallComponents: 0,
    floorAreaRatio: 0,
    wallAreaRatio: 0
  };
}

function removeDegenerateTriangles(mesh: ParsedObjMeshLike): ParsedObjMeshLike {
  return {
    vertices: mesh.vertices,
    triangles: mesh.triangles.filter((triangle) => triangleArea(mesh.vertices, triangle) > 1e-10)
  };
}

function collisionStats(mesh: ParsedObjMeshLike) {
  return {
    area: {
      floor: groupArea(mesh, "floor"),
      wall: groupArea(mesh, "wall")
    },
    components: {
      floor: groupComponentCount(mesh, "floor"),
      wall: groupComponentCount(mesh, "wall")
    }
  };
}

function groupArea(mesh: ParsedObjMeshLike, group: string): number {
  return mesh.triangles.filter((triangle) => triangle.group === group).reduce((sum, triangle) => sum + triangleArea(mesh.vertices, triangle), 0);
}

function triangleArea(vertices: ParsedObjMeshLike["vertices"], triangle: ObjTriangle): number {
  const a = vertices[triangle.a];
  const b = vertices[triangle.b];
  const c = vertices[triangle.c];
  if (!a || !b || !c) return 0;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
  return Math.hypot(cross[0]!, cross[1]!, cross[2]!) / 2;
}

function groupComponentCount(mesh: ParsedObjMeshLike, group: string): number {
  const triangles = mesh.triangles.filter((triangle) => triangle.group === group);
  if (!triangles.length) return 0;
  const byVertex = new Map<number, number[]>();
  triangles.forEach((triangle, index) => {
    for (const vertex of [triangle.a, triangle.b, triangle.c]) byVertex.set(vertex, [...(byVertex.get(vertex) ?? []), index]);
  });
  const seen = new Set<number>();
  let components = 0;
  for (let start = 0; start < triangles.length; start += 1) {
    if (seen.has(start)) continue;
    components += 1;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const index = queue.pop()!;
      const triangle = triangles[index]!;
      for (const vertex of [triangle.a, triangle.b, triangle.c]) {
        for (const neighbor of byVertex.get(vertex) ?? []) {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
  }
  return components;
}

function rotateVector(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
