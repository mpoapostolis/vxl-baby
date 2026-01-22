import {
  type AbstractMesh,
  type AnimationGroup,
  type ShadowGenerator,
  Vector3,
} from "@babylonjs/core";

export interface NPCAnimations {
  idle?: string;
  interact?: string;
}

export interface NPCOptions {
  scale?: number;
  castShadow?: boolean;
  idleAnimation?: string | string[];
  animations?: NPCAnimations;
}

const IDLE_PATTERNS = ["idle", "characterarmature|idle"];

export class NPC {
  public readonly mesh: AbstractMesh;
  private readonly animMap: Map<string, AnimationGroup>;
  private readonly animList: AnimationGroup[];
  private currentAnim: AnimationGroup | null = null;
  private disposed = false;

  constructor(
    meshes: AbstractMesh[],
    animationGroups: AnimationGroup[],
    shadowGenerator: ShadowGenerator,
    position: Vector3,
    options: NPCOptions = {},
  ) {
    const root = meshes[0];
    if (!root) throw new Error("NPC requires at least one mesh");

    this.mesh = root;
    this.animList = animationGroups;

    // Build O(1) lookup map
    this.animMap = new Map();
    for (const ag of animationGroups) {
      this.animMap.set(ag.name, ag);
      this.animMap.set(ag.name.toLowerCase(), ag);
    }

    // Apply transform
    this.mesh.position = position;
    this.mesh.scaling.setAll(options.scale ?? 1);

    // Setup shadows
    if (options.castShadow !== false) {
      for (const m of meshes) shadowGenerator.addShadowCaster(m);
    }

    // Stop all & play idle
    this.stopAll();
    const idle = this.findAnim(options.animations?.idle || options.idleAnimation);
    if (idle) {
      idle.play(true);
      this.currentAnim = idle;
    }
  }

  private findAnim(name?: string | string[]): AnimationGroup | undefined {
    if (!name) return this.findIdleAnim();

    const names = Array.isArray(name) ? name : [name];

    // O(1) exact lookup
    for (const n of names) {
      const exact = this.animMap.get(n) || this.animMap.get(n.toLowerCase());
      if (exact) return exact;
    }

    // Fallback: partial match (rare)
    for (const n of names) {
      const lower = n.toLowerCase();
      for (const ag of this.animList) {
        if (ag.name.toLowerCase().includes(lower)) return ag;
      }
    }

    return this.findIdleAnim();
  }

  private findIdleAnim(): AnimationGroup | undefined {
    for (const pattern of IDLE_PATTERNS) {
      for (const ag of this.animList) {
        if (ag.name.toLowerCase().includes(pattern)) return ag;
      }
    }
    return this.animList[0];
  }

  get position(): Vector3 {
    return this.mesh.position;
  }

  set position(value: Vector3) {
    this.mesh.position = value;
  }

  getAnimationNames(): string[] {
    return this.animList.map((a) => a.name);
  }

  playAnimation(name: string, loop = true): boolean {
    if (this.disposed) return false;

    const anim = this.animMap.get(name) || this.animMap.get(name.toLowerCase());
    if (!anim) {
      // Fallback partial match
      const found = this.animList.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
      if (!found) return false;
      return this.playAnimGroup(found, loop);
    }

    return this.playAnimGroup(anim, loop);
  }

  private playAnimGroup(anim: AnimationGroup, loop: boolean): boolean {
    if (this.currentAnim === anim) return true;

    this.stopAll();
    anim.start(true, 1.0, anim.from, anim.to, loop);
    this.currentAnim = anim;
    return true;
  }

  private stopAll(): void {
    for (const ag of this.animList) ag.stop();
    this.currentAnim = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stopAll();
    for (const ag of this.animList) ag.dispose();
    this.mesh.dispose(false, true);
  }
}
