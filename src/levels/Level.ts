import {
  type Mesh,
  Vector3,
  GizmoManager,
  UtilityLayerRenderer,
  AbstractMesh,
  Color3,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeMesh,
} from "@babylonjs/core";
import type {
  LevelConfig,
  LevelEffect,
  Trigger,
  TriggerAction,
} from "../config/levels";
import type { NPC } from "../entities/NPC";
import type { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { DialogueManager } from "../managers/DialogueManager";
import { BaseLevel } from "./BaseLevel";

interface TriggerState {
  triggered: boolean;
}

export class Level extends BaseLevel {
  private levelConfig: LevelConfig;
  private npcs: Map<string, NPC> = new Map();
  private portals: Portal[] = [];
  private triggerStates: Map<Trigger, TriggerState> = new Map();

  // Editor Support
  private gizmoManager?: GizmoManager;
  private onObjectSelected?: (
    type: string,
    id: string | number,
    object: any,
  ) => void;
  private onTransformChange?: (
    id: string | number,
    position: Vector3,
    rotation?: Vector3,
    scale?: Vector3,
  ) => void;

  constructor(config: LevelConfig) {
    // Build base config, only including defined values
    const baseConfig: Record<string, unknown> = {
      ambientIntensity: config.ambientIntensity,
      clearColor: config.clearColor,
      fogEnabled: config.fogEnabled,
    };

    if (config.flashlightIntensity !== undefined) {
      baseConfig.flashlightIntensity = config.flashlightIntensity;
    }
    if (config.fogColor !== undefined) {
      baseConfig.fogColor = config.fogColor;
    }
    if (config.fogDensity !== undefined) {
      baseConfig.fogDensity = config.fogDensity;
    }
    if (config.cameraRadius !== undefined) {
      baseConfig.cameraRadius = config.cameraRadius;
    }
    if (config.cameraBeta !== undefined) {
      baseConfig.cameraBeta = config.cameraBeta;
    }
    if (config.pipeline !== undefined) {
      baseConfig.pipeline = config.pipeline;
    }

    super(baseConfig);
    this.levelConfig = config;
  }

  protected async onLoad(): Promise<void> {
    const config = this.levelConfig;

    // Audio
    AudioManager.getInstance().stopAll();
    if (config.music) {
      AudioManager.getInstance().play(config.music);
    }

    // Load environment
    await this.loadEnvironment();

    // Spawn entities
    await this.spawnEntities();

    // Register dialogues
    this.registerDialogues();

    // Initialize triggers
    this.initTriggers();
  }

  private async loadEnvironment(): Promise<void> {
    const env = this.levelConfig.environment;
    const data = await this.assetManager.loadMesh(env.asset, this.scene);

    const rootMesh = data.meshes[0];
    if (rootMesh) {
      if (env.scale) {
        rootMesh.scaling.setAll(env.scale);
      }
      if (env.position) {
        rootMesh.position.set(...env.position);
      }
      rootMesh.computeWorldMatrix(true);
    }

    data.meshes.forEach((m) => {
      m.receiveShadows = true;
      m.computeWorldMatrix(true);
      if (m.getTotalVertices() > 0) {
        this.setupStaticMeshPhysics(m as Mesh);
      }
    });
  }

  private async spawnEntities(): Promise<void> {
    // Clear existing
    this.npcs.clear();
    this.portals = [];

    for (let i = 0; i < this.levelConfig.entities.length; i++) {
      const spawn = this.levelConfig.entities[i];
      const position = new Vector3(...spawn.position);

      if (spawn.type === "npc") {
        const npc = await this.entityFactory.spawnNPC(
          spawn.entity,
          position,
          spawn.scale,
        );
        this.npcs.set(spawn.entity, npc);

        // Tag for editor
        if (npc.mesh) {
          npc.mesh.metadata = {
            type: "entity",
            index: i,
            entityType: "npc",
            id: spawn.entity,
          };
        }
      } else if (spawn.type === "portal") {
        const portal = this.entityFactory.spawnPortal(
          position,
          spawn.targetLevel,
        );
        this.portals.push(portal);
        if (!this.portal) {
          this.portal = portal;
        }
        // Tag for editor
        if (portal.mesh) {
          portal.mesh.metadata = {
            type: "entity",
            index: i,
            entityType: "portal",
          };
        }
      } else if (spawn.type === "prop") {
        const data = await this.assetManager.loadMesh(spawn.asset, this.scene);
        const root = data.meshes[0];
        if (root) {
          root.position.copyFrom(position);
          if (spawn.rotation) {
            root.rotation = new Vector3(...spawn.rotation);
          }
          if (spawn.scaling) {
            root.scaling = new Vector3(...spawn.scaling);
          }

          // Tag for editor
          root.metadata = {
            type: "entity",
            index: i,
            entityType: "prop",
          };

          // Physics
          if (spawn.physics?.enabled) {
            const motionType =
              spawn.physics.mass > 0
                ? PhysicsMotionType.DYNAMIC
                : PhysicsMotionType.STATIC;
            // Merge meshes for physics if needed, or just root.
            // Simple approach: Apply to root if it has geometry, or first child.
            // Best for GLB: Parent to a capsule or box if dynamic?
            // For now, let's try direct mesh physics on root or children.
            // Actually, often root is empty __root__.

            // Aggreagte simple physics:
            const physicsRoot = root; // Simplified
            const body = new PhysicsBody(
              physicsRoot,
              motionType,
              false,
              this.scene,
            );
            body.setMassProperties({ mass: spawn.physics.mass });

            // Shape
            let shape;
            if (spawn.physics.impostor === "box") {
              // Approximate box
              // shape = new PhysicsShapeBox(...) // Need bounding info
            }
            // Fallback to mesh shape for now for everything or simple mesh impostor
            const shapeMesh = new PhysicsShapeMesh(
              physicsRoot as Mesh,
              this.scene,
            );
            body.shape = shapeMesh;
          }
        }
      }
    }
  }

  private registerDialogues(): void {
    const dialogueManager = DialogueManager.getInstance();
    for (const dialogue of this.levelConfig.dialogues ?? []) {
      dialogueManager.register(dialogue);
    }
  }

  private initTriggers(): void {
    for (const trigger of this.levelConfig.triggers ?? []) {
      this.triggerStates.set(trigger, { triggered: false });
    }
  }

  protected override onUpdate(): void {
    this.processTriggers();
    this.processEffects();
  }

  private processTriggers(): void {
    if (!this.player) return;

    for (const trigger of this.levelConfig.triggers ?? []) {
      const state = this.triggerStates.get(trigger);
      if (!state) continue;

      if (trigger.once && state.triggered) continue;

      if (trigger.type === "proximity") {
        const target = this.npcs.get(trigger.target);
        if (!target) continue;

        const dist = Vector3.Distance(this.player.position, target.position);
        if (dist < trigger.radius) {
          state.triggered = true;
          this.executeTriggerActions(trigger.actions);
        }
      }
    }
  }

  private executeTriggerActions(actions: TriggerAction[]): void {
    for (const action of actions) {
      switch (action.type) {
        case "playDialogue":
          DialogueManager.getInstance().play(action.value as string);
          break;
        case "playSound":
          AudioManager.getInstance().play(action.value as string);
          break;
        case "setSpotlightIntensity":
          if (this.player) {
            this.player.spotLight.intensity = action.value as number;
          }
          break;
      }
    }
  }

  private processEffects(): void {
    for (const effect of this.levelConfig.effects ?? []) {
      this.applyEffect(effect);
    }
  }

  private applyEffect(effect: LevelEffect): void {
    switch (effect.type) {
      case "spotlightOverride":
        if (this.player) {
          this.player.spotLight.intensity = effect.intensity;
        }
        break;

      case "flicker":
        if (effect.target === "flashlight") {
          if (Math.random() < effect.chance) {
            this.flashlight.intensity =
              effect.lowRange[0] +
              Math.random() * (effect.lowRange[1] - effect.lowRange[0]);
          } else {
            this.flashlight.intensity =
              effect.highRange[0] +
              Math.random() * (effect.highRange[1] - effect.highRange[0]);
          }
        }
        break;

      case "heartbeatVignette":
        if (this.pipeline) {
          const time = Date.now() * effect.speed;
          const heartbeat =
            (Math.sin(time) + Math.sin(time * 2) + Math.sin(time * 0.5)) / 3;
          this.pipeline.imageProcessing.vignetteWeight =
            effect.baseWeight + heartbeat * effect.amplitude;
        }
        break;

      case "cameraShake":
        this.camera.rotation.x += (Math.random() - 0.5) * effect.intensity;
        this.camera.rotation.y += (Math.random() - 0.5) * effect.intensity;
        break;
    }
  }

  public start(): void {}

  public enableEditorMode(
    onSelect: (type: string, id: string | number, object: any) => void,
    onChange: (
      id: string | number,
      position: Vector3,
      rotation?: Vector3,
      scale?: Vector3,
    ) => void,
  ): void {
    if (this.gizmoManager) return; // Already enabled

    this.onObjectSelected = onSelect;
    this.onTransformChange = onChange;

    this.gizmoManager = new GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;

    // Custom selection logic
    this.scene.onPointerDown = (evt, pickResult) => {
      // Check if we clicked on a gizmo (Utility Layer)
      const isGizmoHit =
        this.gizmoManager?.gizmos.positionGizmo?.xGizmo.isHovered ||
        this.gizmoManager?.gizmos.positionGizmo?.yGizmo.isHovered ||
        this.gizmoManager?.gizmos.positionGizmo?.zGizmo.isHovered ||
        this.gizmoManager?.gizmos.rotationGizmo?.xGizmo.isHovered ||
        this.gizmoManager?.gizmos.rotationGizmo?.yGizmo.isHovered ||
        this.gizmoManager?.gizmos.rotationGizmo?.zGizmo.isHovered ||
        this.gizmoManager?.gizmos.scaleGizmo?.xGizmo.isHovered ||
        this.gizmoManager?.gizmos.scaleGizmo?.yGizmo.isHovered ||
        this.gizmoManager?.gizmos.scaleGizmo?.zGizmo.isHovered;

      if (isGizmoHit) return;

      if (pickResult.hit && pickResult.pickedMesh) {
        let selectedMesh = pickResult.pickedMesh;

        // Walk up to find the root entity
        while (selectedMesh.parent && (selectedMesh.parent as AbstractMesh)) {
          if (selectedMesh.metadata?.type) break;
          selectedMesh = selectedMesh.parent as AbstractMesh;
        }

        if (selectedMesh.metadata?.type === "entity") {
          this.gizmoManager?.attachToMesh(selectedMesh);
          this.onObjectSelected?.(
            "entity",
            selectedMesh.metadata.index,
            selectedMesh,
          );
        } else {
          // We clicked a non-entity mesh (like the ground or a wall part of env)
          // Keep selection if it was an entity, unless we explicitly want to deselect?
          // For now, let's DESELECT if we click the environment.
          this.gizmoManager?.attachToMesh(null);
          this.onObjectSelected?.("none", -1, null);
        }
      } else if (evt.button === 0) {
        // Clicked skybox/void
        this.gizmoManager?.attachToMesh(null);
        this.onObjectSelected?.("none", -1, null);
      }
    };

    // Drag End Observer
    const updateTransform = () => {
      const mesh = this.gizmoManager?.attachedMesh;
      if (mesh && mesh.metadata?.type === "entity") {
        this.onTransformChange?.(
          mesh.metadata.index,
          mesh.position.clone(),
          mesh.rotation.clone(),
          mesh.scaling.clone(),
        );
      }
    };

    // Add drag end observers for all gizmos
    this.gizmoManager.gizmos.positionGizmo?.onDragEndObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.rotationGizmo?.onDragEndObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.scaleGizmo?.onDragEndObservable.add(
      updateTransform,
    );

    // Also observe during drag for smoother updates
    this.gizmoManager.gizmos.positionGizmo?.xGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.positionGizmo?.yGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.positionGizmo?.zGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.rotationGizmo?.xGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.rotationGizmo?.yGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.rotationGizmo?.zGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.scaleGizmo?.xGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.scaleGizmo?.yGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
    this.gizmoManager.gizmos.scaleGizmo?.zGizmo.dragBehavior.onDragObservable.add(
      updateTransform,
    );
  }

  public override hotUpdate(config: LevelConfig): void {
    super.hotUpdate(config);
    this.levelConfig = config;
  }

  // Optimized method for Editor Dragging
  public updateEntityTransform(
    index: number,
    position: number[],
    rotation?: number[],
    scale?: number[],
  ): void {
    // Find the mesh with this index
    const mesh = this.scene.meshes.find(
      (m) =>
        m.metadata &&
        m.metadata.type === "entity" &&
        m.metadata.index === index,
    );

    if (mesh) {
      mesh.position.set(position[0], position[1], position[2]);
      if (rotation) {
        mesh.rotation = new Vector3(rotation[0], rotation[1], rotation[2]);
      }
      if (scale) {
        mesh.scaling = new Vector3(scale[0], scale[1], scale[2]);
      }

      // Update Physics Body if exists
      if (mesh.physicsBody) {
        mesh.physicsBody.setTargetTransform(
          mesh.position,
          mesh.rotationQuaternion || mesh.rotation.toQuaternion(),
        );
      }
    }
  }
  public setGizmoMode(mode: "position" | "rotation" | "scale"): void {
    if (!this.gizmoManager) return;
    this.gizmoManager.positionGizmoEnabled = mode === "position";
    this.gizmoManager.rotationGizmoEnabled = mode === "rotation";
    this.gizmoManager.scaleGizmoEnabled = mode === "scale";
  }

  public getEntityAnimationGroups(index: number): string[] {
    const npc = Array.from(this.npcs.values()).find(
      (n) => n.mesh && n.mesh.metadata && n.mesh.metadata.index === index,
    );
    if (npc) {
      return npc.anims.map((a) => a.name);
    }
    return [];
  }

  public playEntityAnimation(index: number, animationName: string): void {
    console.log(
      `[Level] playEntityAnimation called for index ${index}, anim: ${animationName}`,
    );
    const npc = Array.from(this.npcs.values()).find(
      (n) => n.mesh && n.mesh.metadata && n.mesh.metadata.index === index,
    );
    if (npc) {
      console.log(`[Level] NPC found: ${npc.mesh?.name}`);
      if (npc.anims) {
        // Stop all first
        npc.anims.forEach((a) => a.stop());
        const anim = npc.anims.find((a) => a.name === animationName);
        if (anim) {
          console.log(`[Level] Starting animation: ${anim.name}`);
          anim.start(true, 1.0, anim.from, anim.to, false);
        } else {
          console.warn(
            `[Level] Animation not found: ${animationName}. Available:`,
            npc.anims.map((a) => a.name),
          );
        }
      } else {
        console.warn(`[Level] NPC has no animations`);
      }
    } else {
      console.error(`[Level] NPC not found for index ${index}`);
    }
  }
}
