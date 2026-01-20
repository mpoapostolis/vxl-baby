import { type Mesh, Vector3 } from "@babylonjs/core";
import type { LevelConfig, LevelEffect, Trigger, TriggerAction } from "../config/levels";
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
    for (const spawn of this.levelConfig.entities) {
      const position = new Vector3(...spawn.position);

      if (spawn.type === "npc") {
        const npc = await this.entityFactory.spawnNPC(spawn.entity, position, spawn.scale);
        this.npcs.set(spawn.entity, npc);
      } else if (spawn.type === "portal") {
        const portal = this.entityFactory.spawnPortal(position, spawn.targetLevel);
        this.portals.push(portal);
        if (!this.portal) {
          this.portal = portal;
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
              effect.lowRange[0] + Math.random() * (effect.lowRange[1] - effect.lowRange[0]);
          } else {
            this.flashlight.intensity =
              effect.highRange[0] + Math.random() * (effect.highRange[1] - effect.highRange[0]);
          }
        }
        break;

      case "heartbeatVignette":
        if (this.pipeline) {
          const time = Date.now() * effect.speed;
          const heartbeat = (Math.sin(time) + Math.sin(time * 2) + Math.sin(time * 0.5)) / 3;
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
}
