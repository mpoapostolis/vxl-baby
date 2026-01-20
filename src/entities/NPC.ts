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
    scaleOverride?: number
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
    const idle = this.findIdleAnimation(animationGroups, config.idleAnimation);
    if (idle) idle.play(true);
  }

  private findIdleAnimation(
    animationGroups: AnimationGroup[],
    idleAnimation: string | string[]
  ): AnimationGroup | undefined {
    if (Array.isArray(idleAnimation)) {
      return animationGroups.find((a) => idleAnimation.some((name) => a.name.includes(name)));
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
