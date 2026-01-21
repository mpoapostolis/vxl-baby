import {
  type AbstractMesh,
  type AnimationGroup,
  type ShadowGenerator,
  Vector3,
} from "@babylonjs/core";
import type { NPCConfig } from "../config/entities";

export class NPC {
  public mesh: AbstractMesh;
  public anims: AnimationGroup[];

  constructor(
    meshes: AbstractMesh[],
    animationGroups: AnimationGroup[],
    shadowGenerator: ShadowGenerator,
    position: Vector3,
    config: NPCConfig,
    scaleOverride?: number,
  ) {
    this.mesh = meshes[0]!;
    this.anims = animationGroups;

    const scale = scaleOverride ?? config.scale;
    this.mesh.position = position;
    this.mesh.scaling = new Vector3(scale, scale, scale);

    if (config.castShadow) {
      meshes.forEach((m) => shadowGenerator.addShadowCaster(m));
    }

    animationGroups.forEach((a) => a.stop());

    // Check for override in spawn config (cast to any or extend interface)
    // The config passed here might be the merged one or just NPCConfig.
    // If we want to support the per-instance overrides from levels.ts, we need to handle it.
    // Assuming 'config' here might have extra props or we should look at a different arg?
    // In Level.ts: await this.entityFactory.spawnNPC(spawn.entity, position, spawn.scale);
    // It doesn't pass the full spawn object! We need to change Level.ts to pass animations.

    // For now, let's assume Level.ts will be updated to pass these options or merge them.
    // Let's use the 'idleAnimation' from config if available, OR the 'animations.idle' from the extended config.

    const spawnConfig = config as any;
    const idleName = spawnConfig.animations?.idle || config.idleAnimation;

    const idle = this.findIdleAnimation(animationGroups, idleName);
    if (idle) idle.play(true);
  }

  private findIdleAnimation(
    animationGroups: AnimationGroup[],
    idleAnimation: string | string[],
  ): AnimationGroup | undefined {
    if (Array.isArray(idleAnimation)) {
      return animationGroups.find((a) =>
        idleAnimation.some((name) => a.name.includes(name)),
      );
    }
    return animationGroups.find((a) => a.name === idleAnimation);
  }

  public get position(): Vector3 {
    return this.mesh.position;
  }

  public playAnimation(name: string, loop = true): void {
    const anim = this.anims.find((a) => a.name.includes(name));
    if (anim) {
      this.anims.forEach((a) => a.stop());
      anim.play(loop);
    }
  }
}
