import {
  type AbstractMesh,
  type AnimationGroup,
  ImportMeshAsync,
  type Scene,
  Sound,
} from "@babylonjs/core";

export interface LoadedMesh {
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  root: AbstractMesh | undefined;
}

export class AssetManager {
  private static instance: AssetManager;
  private sounds: Map<string, Sound> = new Map();

  private constructor() {}

  public static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager();
    }
    return AssetManager.instance;
  }

  public async loadMesh(path: string, scene: Scene): Promise<LoadedMesh> {
    const result = await ImportMeshAsync(path, scene);
    return {
      meshes: result.meshes,
      animationGroups: result.animationGroups,
      root: result.meshes[0],
    };
  }

  public loadSound(
    name: string,
    path: string,
    scene: Scene,
    options?: { loop?: boolean; autoplay?: boolean; volume?: number }
  ): Sound {
    const sound = new Sound(name, path, scene, null, options);
    this.sounds.set(name, sound);
    return sound;
  }

  public getSound(name: string): Sound | undefined {
    return this.sounds.get(name);
  }

  public stopAllSounds(): void {
    this.sounds.forEach((s) => s.stop());
  }
}
