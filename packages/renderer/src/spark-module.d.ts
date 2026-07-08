declare module "@sparkjsdev/spark" {
  import type * as THREE from "three";

  export interface SparkRendererOptions {
    renderer: THREE.WebGLRenderer;
    onDirty?: () => void;
    blurAmount?: number;
    minAlpha?: number;
    maxPixelRadius?: number;
    focalAdjustment?: number;
    sortRadial?: boolean;
  }

  export class SparkRenderer extends THREE.Object3D {
    constructor(options: SparkRendererOptions);
    dispose?(): void;
  }

  export interface SplatMeshOptions {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileName?: string;
    editable?: boolean;
    raycastable?: boolean;
    maxSplats?: number;
    onLoad?: (mesh: SplatMesh) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
  }

  export class SplatMesh extends THREE.Object3D {
    initialized?: Promise<SplatMesh>;
    isInitialized?: boolean;
    numSplats?: number;
    opacity: number;
    constructor(options?: SplatMeshOptions);
    dispose(): void;
    getBoundingBox?(centersOnly?: boolean): THREE.Box3;
  }
}
