import { type Scene, type ShadowGenerator, Vector3 } from "@babylonjs/core";
import { ENTITIES } from "../config/entities";
import type { NPCConfig } from "../config/entities";
import { NPC, type NPCAnimations } from "../entities/NPC";
import { Portal } from "../entities/Portal";
import type { AssetManager } from "../managers/AssetManager";

export interface SpawnNPCOptions {
  entityKey?: string;
  asset?: string;
  position: Vector3;
  scale?: number;
  animations?: NPCAnimations;
}

const DEFAULT_NPC_CONFIG: Omit<NPCConfig, "asset"> = {
  type: "npc",
  scale: 1,
  idleAnimation: ["Idle", "idle"],
  castShadow: true,
};

export class EntityFactory {
  private readonly scene: Scene;
  private readonly shadowGenerator: ShadowGenerator;
  private readonly assetManager: AssetManager;

  constructor(
    scene: Scene,
    shadowGenerator: ShadowGenerator,
    assetManager: AssetManager
  ) {
    this.scene = scene;
    this.shadowGenerator = shadowGenerator;
    this.assetManager = assetManager;
  }

  async spawnNPC(options: SpawnNPCOptions): Promise<NPC> {
    const { position, scale, animations } = options;
    const config = this.resolveNPCConfig(options);

    const data = await this.assetManager.loadMesh(config.asset, this.scene);

    return new NPC(data.meshes, data.animationGroups, this.shadowGenerator, position, {
      scale: scale ?? config.scale,
      castShadow: config.castShadow,
      idleAnimation: config.idleAnimation,
      animations,
    });
  }

  private resolveNPCConfig(options: SpawnNPCOptions): NPCConfig {
    // Try entity key lookup (case-insensitive)
    if (options.entityKey) {
      const key = this.findEntityKey(options.entityKey);
      if (key) {
        const config = ENTITIES[key];
        if (config?.type === "npc") {
          return config;
        }
      }
    }

    // Use direct asset path
    if (options.asset) {
      const assetPath = this.normalizeAssetPath(options.asset);
      return { ...DEFAULT_NPC_CONFIG, asset: assetPath };
    }

    throw new Error(
      `Invalid NPC spawn options: provide either entityKey or asset. Got: ${JSON.stringify(options)}`
    );
  }

  private findEntityKey(key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    return Object.keys(ENTITIES).find((k) => k.toLowerCase() === lowerKey);
  }

  private normalizeAssetPath(path: string): string {
    if (path.startsWith("/assets/")) return path;
    if (path.startsWith("/")) return path;
    return `/assets/${path}`;
  }

  spawnPortal(position: Vector3, targetLevel: string, editorMode = false): Portal {
    return new Portal(this.scene, position, targetLevel, { editorMode });
  }
}
