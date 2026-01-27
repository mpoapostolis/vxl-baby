import {
  type Mesh,
  Vector3,
  GizmoManager,
  AbstractMesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeMesh,
  type Observer,
  type PickingInfo,
  type PointerInfo,
  PointerEventTypes,
} from "@babylonjs/core";
import type {
  LevelConfig,
  LevelEffect,
  Trigger,
  TriggerAction,
  NPCSpawn,
  PortalSpawn,
  PropSpawn,
} from "../config/levels";
import { NPC } from "../entities/NPC";
import type { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { DialogueManager } from "../managers/DialogueManager";
import { BaseLevel } from "./BaseLevel";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  INTERACTION_RADIUS: 3,
} as const;

// ============================================================================
// TYPES
// ============================================================================

interface EntityMetadata {
  type: "entity";
  index: number;
  entityType: "npc" | "portal" | "prop";
  id?: string;
}

interface TriggerState {
  triggered: boolean;
}

interface ParsedLink {
  from: number;
  to: number;
  slot: number;
}

type EntitySelectCallback = (
  type: string,
  id: number,
  object: AbstractMesh | null,
) => void;
type TransformChangeCallback = (
  id: number,
  pos: Vector3,
  rot?: Vector3,
  scale?: Vector3,
) => void;

// ============================================================================
// TYPE GUARDS
// ============================================================================

function isEntityMetadata(meta: unknown): meta is EntityMetadata {
  return (
    meta !== null &&
    typeof meta === "object" &&
    (meta as EntityMetadata).type === "entity"
  );
}

// ============================================================================
// LEVEL CLASS
// ============================================================================

export class Level extends BaseLevel {
  private levelConfig: LevelConfig;
  private currentMusic: string | undefined;

  // Entity storage
  private readonly npcs = new Map<number, NPC>();
  private readonly portals = new Map<number, Portal>();
  private readonly props = new Map<number, AbstractMesh>();
  private readonly triggerStates = new Map<Trigger, TriggerState>();
  private readonly npcDialogueTriggered = new Set<number>();

  // Fast lookups
  private readonly entityMeshIndex = new Map<number, AbstractMesh>();
  private readonly npcNameIndex = new Map<string, NPC>();

  // Effects
  private effectTime = 0;

  // Editor state
  private gizmoManager?: GizmoManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly gizmoObservers: Observer<any>[] = [];
  private editorPointerObserver: Observer<PointerInfo> | null = null;
  private onEntitySelected?: EntitySelectCallback;
  private onTransformChanged?: TransformChangeCallback;
  private isEditorMode = false;
  private currentInteractingNPC: number | null = null;

  constructor(config: LevelConfig) {
    super({
      ambientIntensity: config.ambientIntensity,
      clearColor: config.clearColor,
      fogEnabled: config.fogEnabled,
      flashlightIntensity: config.flashlightIntensity,
      fogColor: config.fogColor,
      fogDensity: config.fogDensity,
      cameraRadius: config.cameraRadius,
      cameraBeta: config.cameraBeta,
      pipeline: config.pipeline,
    });
    this.levelConfig = config;
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  protected async onLoad(): Promise<void> {
    AudioManager.getInstance().stopAll();

    if (this.levelConfig.music) {
      AudioManager.getInstance().play(this.levelConfig.music, true);
      this.currentMusic = this.levelConfig.music;
    }

    await this.loadEnvironment();
    await this.spawnAllEntities();
    this.registerDialogues();
    this.initializeTriggers();
  }

  protected override onUpdate(): void {
    if (!this.isEditorMode) {
      this.checkNPCProximity();
      this.checkInteractionState();
    }
    this.processTriggers();
    this.processEffects();
  }

  public start(): void {
    // Game start logic (if any)
  }

  public setEditorMode(enabled: boolean): void {
    this.isEditorMode = enabled;
  }

  public override dispose(): void {
    this.cleanupEditor();
    this.disposeAllEntities();
    this.triggerStates.clear();
    this.npcDialogueTriggered.clear();
    super.dispose();
  }

  // ==========================================================================
  // ENVIRONMENT
  // ==========================================================================

  private async loadEnvironment(): Promise<void> {
    const env = this.levelConfig.environment;
    if (!env?.asset) return;

    const data = await this.assetManager.loadMesh(env.asset, this.scene);
    const root = data.meshes[0];

    if (root) {
      if (env.scale) root.scaling.setAll(env.scale);
      if (env.position) root.position.set(...env.position);
      root.computeWorldMatrix(true);
    }

    for (const mesh of data.meshes) {
      mesh.receiveShadows = true;
      mesh.computeWorldMatrix(true);
      if (mesh.getTotalVertices() > 0) {
        this.setupStaticMeshPhysics(mesh as Mesh);
      }
    }
  }

  // ==========================================================================
  // ENTITY MANAGEMENT
  // ==========================================================================

  private async spawnAllEntities(): Promise<void> {
    this.disposeAllEntities();

    const entities = this.levelConfig.entities;
    for (let i = 0; i < entities.length; i++) {
      await this.spawnEntityAtIndex(i, entities[i]);
    }
  }

  private async spawnEntityAtIndex(
    index: number,
    spawn: NPCSpawn | PortalSpawn | PropSpawn,
  ): Promise<void> {
    const position = new Vector3(...spawn.position);

    try {
      switch (spawn.type) {
        case "npc":
          await this.spawnNPC(index, spawn, position);
          break;
        case "portal":
          this.spawnPortal(index, spawn, position);
          break;
        case "prop":
          await this.spawnProp(index, spawn, position);
          break;
      }
    } catch (error) {
      console.error(`[Level] Failed to spawn entity ${index}:`, error);
    }
  }

  private async spawnNPC(
    index: number,
    spawn: NPCSpawn,
    position: Vector3,
  ): Promise<void> {
    const npc = await this.entityFactory.spawnNPC({
      entityKey: spawn.entity,
      asset: spawn.asset,
      position,
      scale: spawn.scale,
      animations: spawn.animations,
    });

    const name = spawn.name || spawn.entity || spawn.asset || `npc_${index}`;
    this.npcs.set(index, npc);
    this.npcNameIndex.set(name, npc);
    this.entityMeshIndex.set(index, npc.mesh);
    this.setEntityMetadata(npc.mesh, index, "npc", name);
  }

  private spawnPortal(
    index: number,
    spawn: PortalSpawn,
    position: Vector3,
  ): void {
    const portal = this.entityFactory.spawnPortal(
      position,
      spawn.targetLevel,
      this.isEditorMode,
    );
    this.portals.set(index, portal);
    if (!this.portal) this.portal = portal;

    if (portal.mesh) {
      this.entityMeshIndex.set(index, portal.mesh);
      this.setEntityMetadata(portal.mesh, index, "portal");
    }
  }

  private async spawnProp(
    index: number,
    spawn: PropSpawn,
    position: Vector3,
  ): Promise<void> {
    const data = await this.assetManager.loadMesh(spawn.asset, this.scene);
    const root = data.meshes[0];
    if (!root) return;

    root.position.copyFrom(position);
    if (spawn.rotation) root.rotation.set(...spawn.rotation);
    if (spawn.scaling) root.scaling.set(...spawn.scaling);

    this.props.set(index, root);
    this.entityMeshIndex.set(index, root);
    this.setEntityMetadata(root, index, "prop");

    if (!this.isEditorMode && spawn.physics?.enabled) {
      if (spawn.physics.mass === 0) {
        // Static prop: apply physics to all sub-meshes for accurate collision
        for (const m of data.meshes) {
          if (m.getTotalVertices() > 0) {
            this.setupPropPhysics(m as Mesh, 0);
          }
        }
      } else {
        // Dynamic prop: apply to root (simplistic, requires root to have geometry or use impostor)
        // TODO: Handle compound physics for dynamic objects
        this.setupPropPhysics(root as Mesh, spawn.physics.mass);
      }
    }
  }

  private setEntityMetadata(
    mesh: AbstractMesh,
    index: number,
    entityType: EntityMetadata["entityType"],
    id?: string,
  ): void {
    mesh.metadata = {
      type: "entity",
      index,
      entityType,
      id,
    } satisfies EntityMetadata;
  }

  private setupPropPhysics(mesh: Mesh, mass: number): void {
    const motionType =
      mass > 0 ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC;
    const body = new PhysicsBody(mesh, motionType, false, this.scene);
    body.setMassProperties({ mass });
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
  }

  private disposeAllEntities(): void {
    this.npcs.forEach((npc) => npc.dispose());
    this.npcs.clear();

    this.portals.forEach((portal) => portal.mesh?.dispose());
    this.portals.clear();

    this.props.forEach((prop) => prop.dispose());
    this.props.clear();

    this.entityMeshIndex.clear();
    this.npcNameIndex.clear();
  }

  // ==========================================================================
  // DIALOGUES & TRIGGERS
  // ==========================================================================

  private registerDialogues(): void {
    const dialogueManager = DialogueManager.getInstance();
    for (const dialogue of this.levelConfig.dialogues ?? []) {
      dialogueManager.register(dialogue);
    }
  }

  private initializeTriggers(): void {
    this.triggerStates.clear();
    for (const trigger of this.levelConfig.triggers ?? []) {
      this.triggerStates.set(trigger, { triggered: false });
    }
  }

  private checkNPCProximity(): void {
    if (!this.player) return;

    const dialogueManager = DialogueManager.getInstance();
    if (dialogueManager.isDialoguePlaying()) return;

    for (let i = 0; i < this.levelConfig.entities.length; i++) {
      const spawn = this.levelConfig.entities[i];
      if (spawn.type !== "npc") continue;

      const npc = this.npcs.get(i);
      if (!npc) continue;

      const distance = Vector3.Distance(this.player.position, npc.position);
      const inRange = distance < CONFIG.INTERACTION_RADIUS;
      const wasTriggered = this.npcDialogueTriggered.has(i);

      if (inRange && !wasTriggered) {
        // Player entered range - trigger dialogue
        this.npcDialogueTriggered.add(i);
        this.handleNPCInteraction(i, spawn);
        return;
      } else if (!inRange && wasTriggered) {
        // Player left range - allow re-trigger next time
        this.npcDialogueTriggered.delete(i);
      }
    }
  }

  private checkInteractionState(): void {
    if (this.currentInteractingNPC === null) return;

    if (!DialogueManager.getInstance().isDialoguePlaying()) {
      // Interaction ended, restore idle
      const npc = this.npcs.get(this.currentInteractingNPC);
      const spawn = this.levelConfig.entities[this.currentInteractingNPC];

      if (npc && spawn && spawn.type === "npc" && spawn.animations?.idle) {
        npc.playAnimation(spawn.animations.idle, true);
      } else if (npc) {
        // Fallback to default idle
        npc.playAnimation("idle", true);
      }

      this.currentInteractingNPC = null;
    }
  }

  private handleNPCInteraction(index: number, spawn: NPCSpawn): void {
    const dialogueManager = DialogueManager.getInstance();
    this.currentInteractingNPC = index;

    if (spawn.interactionSound) {
      AudioManager.getInstance().play(spawn.interactionSound);
    }

    // Play interaction animation (LOOPING)
    if (spawn.animations?.interact) {
      const npc = this.npcs.get(index);
      if (npc) {
        npc.playAnimation(spawn.animations.interact, true);
      }
    }

    // Priority 1: Custom Script
    if (spawn.scriptSource) {
      dialogueManager.startScript(spawn.scriptSource, () => {
        const npc = this.npcs.get(index);
        if (npc) {
          npc.playAnimation(spawn.animations?.idle || "idle", true);
        }
        this.currentInteractingNPC = null;
      });
      return;
    }

    // Priority 2: Requirements & Success/Fail Dialogue (Simple Quest)
    // TODO: Add requirement check logic here if needed.
    // For now, if we have success dialogue, we assume we might want to show it?
    // Or should we show default dialogue?
    // Let's implement the standard fallback:

    // Check if we have standard dialogue to play
    if (spawn.dialogue?.length) {
      const dialogueId = `npc_${index}_default`;
      dialogueManager.register({
        id: dialogueId,
        lines: spawn.dialogue,
      });
      dialogueManager.play(dialogueId);
      return;
    }

    // Fallback/Legacy: Success dialogue if no standard dialogue
    if (spawn.successDialogue?.length) {
      const dialogueId = `npc_${index}_success`;
      dialogueManager.register({
        id: dialogueId,
        lines: spawn.successDialogue,
      });
      dialogueManager.play(dialogueId);
    }
  }

  private processTriggers(): void {
    if (!this.player) return;

    for (const trigger of this.levelConfig.triggers ?? []) {
      const state = this.triggerStates.get(trigger);
      if (!state || (trigger.once && state.triggered)) continue;

      if (trigger.type === "proximity") {
        const targetNpc = this.npcNameIndex.get(trigger.target);
        if (!targetNpc) continue;

        const distance = Vector3.Distance(
          this.player.position,
          targetNpc.position,
        );
        if (distance < trigger.radius) {
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
          DialogueManager.getInstance().play(String(action.value));
          break;
        case "playSound":
          AudioManager.getInstance().play(String(action.value));
          break;
        case "setSpotlightIntensity":
          if (this.player)
            this.player.spotLight.intensity = Number(action.value);
          break;
      }
    }
  }

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  private processEffects(): void {
    const deltaTime = this.scene.getEngine().getDeltaTime() * 0.001;
    this.effectTime += deltaTime;

    for (const effect of this.levelConfig.effects ?? []) {
      this.applyEffect(effect);
    }
  }

  private applyEffect(effect: LevelEffect): void {
    switch (effect.type) {
      case "spotlightOverride":
        if (this.player) this.player.spotLight.intensity = effect.intensity;
        break;

      case "flicker":
        if (effect.target === "flashlight") {
          const range =
            Math.random() < effect.chance ? effect.lowRange : effect.highRange;
          this.flashlight.intensity =
            range[0] + Math.random() * (range[1] - range[0]);
        }
        break;

      case "heartbeatVignette":
        if (this.pipeline) {
          const t = this.effectTime * effect.speed;
          const heartbeat =
            (Math.sin(t) + Math.sin(t * 2) + Math.sin(t * 0.5)) / 3;
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

  // ==========================================================================
  // EDITOR MODE
  // ==========================================================================

  public enableEditorMode(
    onSelect: EntitySelectCallback,
    onChange: TransformChangeCallback,
  ): void {
    this.cleanupEditor();
    this.isEditorMode = true;
    DialogueManager.getInstance().stop();
    this.onEntitySelected = onSelect;
    this.onTransformChanged = onChange;

    // Disable physics for free movement
    this.player?.disablePhysics();

    // Set portals to editor mode
    this.portals.forEach((portal) => {
      portal.editorMode = true;
    });

    // Disable physics for all props
    this.props.forEach((prop) => {
      if (prop.physicsBody) {
        prop.physicsBody.dispose();
      }
      prop.getChildMeshes().forEach((m) => {
        if (m.physicsBody) m.physicsBody.dispose();
      });
    });

    this.setupGizmoManager();
    this.setupEditorPointerEvents();
  }

  private setupGizmoManager(): void {
    console.log("[Level] Setting up GizmoManager...");
    this.gizmoManager = new GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;

    this.setupGizmoObservers();
    console.log("[Level] GizmoManager setup complete.");
  }

  private setupEditorPointerEvents(): void {
    if (this.editorPointerObserver) {
      this.scene.onPointerObservable.remove(this.editorPointerObserver);
    }

    this.editorPointerObserver = this.scene.onPointerObservable.add(
      (pointerInfo) => {
        // Handle Double Tap for Selection
        if (pointerInfo.type === PointerEventTypes.POINTERDOUBLETAP) {
          if (this.isGizmoHovered()) return;
          if (pointerInfo.pickInfo) {
            this.handleEditorClick(pointerInfo.pickInfo);
          }
          return;
        }

        // Handle Single Tap (POINTERDOWN) - mostly for gizmo interaction or clearing if needed?
        // User requested selection ONLY on Double Click.
        // Gizmo interaction is handled by GizmoManager internally.
      },
      PointerEventTypes.POINTERDOUBLETAP,
    );
  }

  private handleEditorClick(pickResult: PickingInfo): void {
    if (this.isGizmoHovered()) return;

    if (pickResult.hit && pickResult.pickedMesh) {
      const entityMesh = this.findEntityMesh(pickResult.pickedMesh);
      if (entityMesh && isEntityMetadata(entityMesh.metadata)) {
        this.gizmoManager?.attachToMesh(entityMesh);
        this.onEntitySelected?.(
          "entity",
          entityMesh.metadata.index,
          entityMesh,
        );
        return;
      }
    }

    this.gizmoManager?.attachToMesh(null);
    this.onEntitySelected?.("none", -1, null);
  }

  private isGizmoHovered(): boolean {
    const gm = this.gizmoManager;
    if (!gm) return false;

    const { positionGizmo, rotationGizmo, scaleGizmo } = gm.gizmos;

    const checkAxisGizmo = (
      g: {
        xGizmo: { isHovered: boolean };
        yGizmo: { isHovered: boolean };
        zGizmo: { isHovered: boolean };
      } | null,
    ) => g && (g.xGizmo.isHovered || g.yGizmo.isHovered || g.zGizmo.isHovered);

    return !!(
      checkAxisGizmo(positionGizmo) ||
      checkAxisGizmo(rotationGizmo) ||
      checkAxisGizmo(scaleGizmo)
    );
  }

  private findEntityMesh(pickedMesh: AbstractMesh): AbstractMesh | null {
    let mesh: AbstractMesh | null = pickedMesh;
    while (mesh) {
      if (isEntityMetadata(mesh.metadata)) return mesh;
      mesh = mesh.parent as AbstractMesh | null;
    }
    return null;
  }

  private setupGizmoObservers(): void {
    const gm = this.gizmoManager;
    if (!gm) return;

    const handleTransformChange = () => {
      const mesh = gm.attachedMesh;
      if (!mesh || !isEntityMetadata(mesh.metadata)) return;

      this.onTransformChanged?.(
        mesh.metadata.index,
        mesh.position.clone(),
        mesh.rotation.clone(),
        mesh.scaling.clone(),
      );
    };

    const gizmos = [
      gm.gizmos.positionGizmo,
      gm.gizmos.rotationGizmo,
      gm.gizmos.scaleGizmo,
    ];

    for (const gizmo of gizmos) {
      if (!gizmo) continue;

      const endObs = gizmo.onDragEndObservable.add(handleTransformChange);
      if (endObs) this.gizmoObservers.push(endObs);

      for (const axis of [gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo]) {
        if (!axis) continue;
        const dragObs = axis.dragBehavior.onDragObservable.add(
          handleTransformChange,
        );
        if (dragObs) this.gizmoObservers.push(dragObs);
      }
    }
  }

  private cleanupEditor(): void {
    for (const obs of this.gizmoObservers) {
      obs.remove();
    }
    this.gizmoObservers.length = 0;

    if (this.editorPointerObserver) {
      this.scene.onPointerObservable.remove(this.editorPointerObserver);
      this.editorPointerObserver = null;
    }

    this.gizmoManager?.dispose();
    this.gizmoManager = undefined;
  }

  // ==========================================================================
  // PUBLIC EDITOR API
  // ==========================================================================

  public highlightEntity(index: number): void {
    if (!this.gizmoManager) return;

    if (index === -1) {
      this.gizmoManager.attachToMesh(null);
      return;
    }

    const mesh = this.entityMeshIndex.get(index);
    if (mesh) {
      this.gizmoManager.attachToMesh(mesh);
    }
  }

  public setGizmoMode(mode: "position" | "rotation" | "scale"): void {
    if (!this.gizmoManager) return;
    this.gizmoManager.positionGizmoEnabled = mode === "position";
    this.gizmoManager.rotationGizmoEnabled = mode === "rotation";
    this.gizmoManager.scaleGizmoEnabled = mode === "scale";
  }

  public updateEntityTransform(
    index: number,
    position: number[],
    rotation?: number[],
    scale?: number[],
  ): void {
    const mesh = this.entityMeshIndex.get(index);
    if (!mesh) return;

    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (scale) mesh.scaling.set(scale[0], scale[1], scale[2]);

    if (mesh.physicsBody) {
      mesh.physicsBody.setTargetTransform(
        mesh.position,
        mesh.rotationQuaternion || mesh.rotation.toQuaternion(),
      );
    }
  }

  public getEntityAnimationGroups(index: number): string[] {
    return this.npcs.get(index)?.getAnimationNames() ?? [];
  }

  public playEntityAnimation(index: number, animationName: string): boolean {
    return this.npcs.get(index)?.playAnimation(animationName) ?? false;
  }

  public async swapNPCModel(
    index: number,
    assetPath: string,
    scale?: number,
  ): Promise<string[]> {
    const oldNpc = this.npcs.get(index);
    if (oldNpc) {
      oldNpc.dispose();
      this.npcs.delete(index);
    }

    const spawn = this.levelConfig.entities[index];
    const position = spawn?.position
      ? new Vector3(...spawn.position)
      : Vector3.Zero();
    const animations = spawn?.type === "npc" ? spawn.animations : undefined;

    const newNpc = await this.entityFactory.spawnNPC({
      asset: assetPath,
      position,
      scale,
      animations,
    });
    const name = spawn?.name || `npc_${index}`;

    this.npcs.set(index, newNpc);
    this.npcNameIndex.set(name, newNpc);
    this.entityMeshIndex.set(index, newNpc.mesh);
    this.setEntityMetadata(newNpc.mesh, index, "npc", name);

    return newNpc.getAnimationNames();
  }

  public async swapPropModel(index: number, assetPath: string): Promise<void> {
    const oldProp = this.props.get(index);
    const oldPosition = oldProp?.position.clone();
    const oldRotation = oldProp?.rotation.clone();
    const oldScaling = oldProp?.scaling.clone();

    if (oldProp) {
      oldProp.dispose();
      this.props.delete(index);
      this.entityMeshIndex.delete(index);
    }

    const data = await this.assetManager.loadMesh(assetPath, this.scene);
    const root = data.meshes[0];
    if (!root) return;

    if (oldPosition) root.position.copyFrom(oldPosition);
    if (oldRotation) root.rotation.copyFrom(oldRotation);
    if (oldScaling) root.scaling.copyFrom(oldScaling);

    this.props.set(index, root);
    this.entityMeshIndex.set(index, root);
    this.setEntityMetadata(root, index, "prop");
  }

  // ==========================================================================
  // LIVE ENTITY MANAGEMENT
  // ==========================================================================

  public async addEntityLive(
    index: number,
    spawn: NPCSpawn | PortalSpawn | PropSpawn,
  ): Promise<string[]> {
    await this.spawnEntityAtIndex(index, spawn);
    return this.npcs.get(index)?.getAnimationNames() ?? [];
  }

  public removeEntityLive(index: number): void {
    // Dispose entity
    const npc = this.npcs.get(index);
    if (npc) {
      const name = npc.mesh.metadata?.id;
      if (name) this.npcNameIndex.delete(name);
      npc.dispose();
      this.npcs.delete(index);
    }

    const portal = this.portals.get(index);
    if (portal) {
      portal.mesh?.dispose();
      this.portals.delete(index);
    }

    const prop = this.props.get(index);
    if (prop) {
      prop.dispose();
      this.props.delete(index);
    }

    this.entityMeshIndex.delete(index);
    this.reindexEntities(index);
  }

  private reindexEntities(removedIndex: number): void {
    const reindex = <T>(
      map: Map<number, T>,
      updateFn?: (item: T, newIdx: number) => void,
    ): Map<number, T> => {
      const newMap = new Map<number, T>();
      for (const [idx, item] of map) {
        const newIdx = idx > removedIndex ? idx - 1 : idx;
        newMap.set(newIdx, item);
        updateFn?.(item, newIdx);
      }
      return newMap;
    };

    this.npcs.clear();
    for (const [idx, npc] of reindex(this.npcs)) {
      this.npcs.set(idx, npc);
      if (isEntityMetadata(npc.mesh.metadata)) npc.mesh.metadata.index = idx;
    }

    this.portals.clear();
    for (const [idx, portal] of reindex(this.portals)) {
      this.portals.set(idx, portal);
      if (portal.mesh && isEntityMetadata(portal.mesh.metadata))
        portal.mesh.metadata.index = idx;
    }

    this.props.clear();
    for (const [idx, prop] of reindex(this.props)) {
      this.props.set(idx, prop);
      if (isEntityMetadata(prop.metadata)) prop.metadata.index = idx;
    }

    // Rebuild mesh index
    this.entityMeshIndex.clear();
    this.npcs.forEach((npc, idx) => this.entityMeshIndex.set(idx, npc.mesh));
    this.portals.forEach((portal, idx) => {
      if (portal.mesh) this.entityMeshIndex.set(idx, portal.mesh);
    });
    this.props.forEach((prop, idx) => this.entityMeshIndex.set(idx, prop));
  }

  // ==========================================================================
  // HOT UPDATE
  // ==========================================================================

  public override hotUpdate(config: LevelConfig): void {
    super.hotUpdate(config);

    // Handle music changes
    if (config.music !== this.currentMusic) {
      AudioManager.getInstance().stopAll();
      if (config.music) {
        AudioManager.getInstance().play(config.music, true);
      }
      this.currentMusic = config.music;
    }

    this.registerDialogues();
    this.levelConfig = config;
  }
}
