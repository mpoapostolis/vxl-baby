import {
  type AbstractMesh,
  type AnimationGroup,
  ImportMeshAsync,
  type Scene,
} from "@babylonjs/core";

export interface LoadedMesh {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  root: AbstractMesh | undefined;
}

interface CachedAsset {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
}

export class AssetManager {
  private static instance: AssetManager;
  private readonly cache = new Map<string, CachedAsset>();
  private readonly pendingLoads = new Map<string, Promise<CachedAsset>>();

  private constructor() {}

  static getInstance(): AssetManager {
    return (AssetManager.instance ??= new AssetManager());
  }

  async loadMesh(path: string, scene: Scene, useCache = false): Promise<LoadedMesh> {
    if (!path) throw new Error("Asset path is required");

    // For cacheable assets (environments, etc.), clone from cache
    if (useCache) {
      const cached = this.cache.get(path);
      if (cached) {
        return this.cloneFromCache(cached, scene);
      }

      // Deduplicate concurrent loads
      const pending = this.pendingLoads.get(path);
      if (pending) {
        const result = await pending;
        return this.cloneFromCache(result, scene);
      }
    }

    // Load fresh
    const loadPromise = this.loadFresh(path, scene);

    if (useCache) {
      this.pendingLoads.set(path, loadPromise);
    }

    try {
      const result = await loadPromise;

      if (useCache) {
        this.cache.set(path, result);
        this.pendingLoads.delete(path);
      }

      return {
        meshes: result.meshes,
        animationGroups: result.animationGroups,
        root: result.meshes[0],
      };
    } catch (error) {
      this.pendingLoads.delete(path);
      throw error;
    }
  }

  private async loadFresh(path: string, scene: Scene): Promise<CachedAsset> {
    try {
      const result = await ImportMeshAsync(path, scene);
      return {
        meshes: result.meshes,
        animationGroups: result.animationGroups,
      };
    } catch (error) {
      console.error(`[AssetManager] Failed to load: ${path}`, error);
      throw new Error(`Asset load failed: ${path}`);
    }
  }

  private cloneFromCache(cached: CachedAsset, scene: Scene): LoadedMesh {
    const clonedMeshes = cached.meshes.map((m) => m.clone(m.name + "_clone", null)!).filter(Boolean);
    const clonedAnims = cached.animationGroups.map((ag) => ag.clone(ag.name + "_clone"));

    return {
      meshes: clonedMeshes,
      animationGroups: clonedAnims,
      root: clonedMeshes[0],
    };
  }

  preload(paths: string[], scene: Scene): Promise<void[]> {
    return Promise.all(paths.map((p) => this.loadMesh(p, scene, true).then(() => {})));
  }

  clearCache(): void {
    this.cache.clear();
    this.pendingLoads.clear();
  }
}
