import {
  type Mesh,
  Vector3,
  GizmoManager,
  AbstractMesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeMesh,
  type Observer,
} from "@babylonjs/core";
import type {
  LevelConfig,
  LevelEffect,
  Trigger,
  TriggerAction,
  NPCSpawn,
} from "../config/levels";
import { NPC } from "../entities/NPC";
import type { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { DialogueManager } from "../managers/DialogueManager";
import { BaseLevel } from "./BaseLevel";

interface EntityMetadata {
  type: "entity";
  index: number;
  entityType: "npc" | "portal" | "prop";
  id?: string;
}

interface TriggerState {
  triggered: boolean;
}

type SelectCallback = (type: string, id: number, object: AbstractMesh | null) => void;
type TransformCallback = (id: number, pos: Vector3, rot?: Vector3, scale?: Vector3) => void;

export class Level extends BaseLevel {
  private levelConfig: LevelConfig;
  private npcs: Map<number, NPC> = new Map();
  private portals: Map<number, Portal> = new Map();
  private props: Map<number, AbstractMesh> = new Map();
  private triggerStates: Map<Trigger, TriggerState> = new Map();

  // O(1) lookups
  private entityMeshIndex: Map<number, AbstractMesh> = new Map();
  private npcNameIndex: Map<string, NPC> = new Map();

  // Time accumulator for effects (avoids Date.now() each frame)
  private effectTime = 0;

  // Editor
  private gizmoManager?: GizmoManager;
  private gizmoObservers: Observer<any>[] = [];
  private onObjectSelected?: SelectCallback;
  private onTransformChange?: TransformCallback;
  private isEditorMode = false;

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

  protected async onLoad(): Promise<void> {
    AudioManager.getInstance().stopAll();

    if (this.levelConfig.music) {
      AudioManager.getInstance().play(this.levelConfig.music);
    }

    await this.loadEnvironment();
    await this.spawnEntities();
    this.registerDialogues();
    this.initTriggers();
  }

  private async loadEnvironment(): Promise<void> {
    const env = this.levelConfig.environment;
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

  private async spawnEntities(): Promise<void> {
    this.disposeEntities();

    const entities = this.levelConfig.entities;

    for (let i = 0; i < entities.length; i++) {
      const spawn = entities[i];
      const position = new Vector3(...spawn.position);

      try {
        if (spawn.type === "npc") {
          await this.spawnNPC(i, spawn, position);
        } else if (spawn.type === "portal") {
          this.spawnPortalEntity(i, spawn, position);
        } else if (spawn.type === "prop") {
          await this.spawnProp(i, spawn, position);
        }
      } catch (error) {
        console.error(`Failed to spawn entity ${i}:`, error);
      }
    }
  }

  private async spawnNPC(index: number, spawn: NPCSpawn, position: Vector3): Promise<void> {
    const npc = await this.entityFactory.spawnNPC({
      entityKey: spawn.entity,
      asset: spawn.asset,
      position,
      scale: spawn.scale,
      animations: spawn.animations,
    });

    const name = spawn.name || spawn.entity || spawn.asset;
    this.npcs.set(index, npc);
    this.setEntityMetadata(npc.mesh, index, "npc", name);

    // Build O(1) name index
    if (name) this.npcNameIndex.set(name, npc);

    // Build mesh index
    this.entityMeshIndex.set(index, npc.mesh);
  }

  private spawnPortalEntity(index: number, spawn: any, position: Vector3): void {
    const portal = this.entityFactory.spawnPortal(position, spawn.targetLevel, this.isEditorMode);
    this.portals.set(index, portal);

    if (!this.portal) this.portal = portal;

    if (portal.mesh) {
      const mesh = portal.mesh as AbstractMesh;
      this.setEntityMetadata(mesh, index, "portal");
      this.entityMeshIndex.set(index, mesh);
    }
  }

  private async spawnProp(index: number, spawn: any, position: Vector3): Promise<void> {
    const data = await this.assetManager.loadMesh(spawn.asset, this.scene);
    const root = data.meshes[0];
    if (!root) return;

    root.position.copyFrom(position);
    if (spawn.rotation) root.rotation.set(spawn.rotation[0], spawn.rotation[1], spawn.rotation[2]);
    if (spawn.scaling) root.scaling.set(spawn.scaling[0], spawn.scaling[1], spawn.scaling[2]);

    this.props.set(index, root);
    this.setEntityMetadata(root, index, "prop");
    this.entityMeshIndex.set(index, root);

    if (spawn.physics?.enabled) {
      this.setupPropPhysics(root as Mesh, spawn.physics);
    }
  }

  private setEntityMetadata(
    mesh: AbstractMesh,
    index: number,
    entityType: EntityMetadata["entityType"],
    id?: string
  ): void {
    mesh.metadata = { type: "entity", index, entityType, id } as EntityMetadata;
  }

  private setupPropPhysics(mesh: Mesh, physics: any): void {
    const motionType = physics.mass > 0 ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC;
    const body = new PhysicsBody(mesh, motionType, false, this.scene);
    body.setMassProperties({ mass: physics.mass });
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
  }

  private disposeEntities(): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();

    for (const portal of this.portals.values()) portal.mesh?.dispose();
    this.portals.clear();

    for (const prop of this.props.values()) prop.dispose();
    this.props.clear();

    // Clear indexes
    this.entityMeshIndex.clear();
    this.npcNameIndex.clear();
  }

  private registerDialogues(): void {
    const dialogueManager = DialogueManager.getInstance();
    for (const dialogue of this.levelConfig.dialogues ?? []) {
      dialogueManager.register(dialogue);
    }
  }

  private initTriggers(): void {
    this.triggerStates.clear();
    for (const trigger of this.levelConfig.triggers ?? []) {
      this.triggerStates.set(trigger, { triggered: false });
    }
  }

  protected override onUpdate(): void {
    if (!this.isEditorMode) {
      this.checkNPCProximity();
    }
    this.processTriggers();
    this.processEffects();
  }

  private checkNPCProximity(): void {
    if (!this.player) return;

    const dialogueManager = DialogueManager.getInstance();
    if (dialogueManager.isActive()) return; // Don't interrupt active dialogue

    const INTERACTION_RADIUS = 3; // Distance to trigger dialogue

    for (let i = 0; i < this.levelConfig.entities.length; i++) {
      const spawn = this.levelConfig.entities[i];
      if (spawn.type !== "npc") continue;
      if (this.npcDialogueTriggered.has(i)) continue; // Already triggered

      const npc = this.npcs.get(i);
      if (!npc) continue;

      const dist = Vector3.Distance(this.player.position, npc.position);
      if (dist < INTERACTION_RADIUS) {
        const npcSpawn = spawn as NPCSpawn;

        // Mark as triggered so it only plays once
        this.npcDialogueTriggered.add(i);

        // Execute quest graph if available
        if (npcSpawn.questGraph) {
          this.executeQuestGraph(npcSpawn.questGraph, npcSpawn.name || "NPC");
          return;
        }

        // Fallback to successDialogue
        if (npcSpawn.successDialogue && npcSpawn.successDialogue.length > 0) {
          const dialogueId = `npc_${i}_success`;
          dialogueManager.register({
            id: dialogueId,
            lines: npcSpawn.successDialogue,
          });
          dialogueManager.play(dialogueId);
          return;
        }
      }
    }
  }

  private processTriggers(): void {
    if (!this.player) return;

    for (const trigger of this.levelConfig.triggers ?? []) {
      const state = this.triggerStates.get(trigger);
      if (!state || (trigger.once && state.triggered)) continue;

      if (trigger.type === "proximity") {
        const targetNpc = this.findNPCByName(trigger.target);
        if (!targetNpc) continue;

        const dist = Vector3.Distance(this.player.position, targetNpc.position);
        if (dist < trigger.radius) {
          state.triggered = true;
          this.executeTriggerActions(trigger.actions);
        }
      }
    }
  }

  private findNPCByName(name: string): NPC | undefined {
    return this.npcNameIndex.get(name);
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
    // Update time accumulator using engine delta time (avoids Date.now() per frame)
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
          const range = Math.random() < effect.chance ? effect.lowRange : effect.highRange;
          this.flashlight.intensity = range[0] + Math.random() * (range[1] - range[0]);
        }
        break;

      case "heartbeatVignette":
        if (this.pipeline) {
          const time = this.effectTime * effect.speed;
          const heartbeat = (Math.sin(time) + Math.sin(time * 2) + Math.sin(time * 0.5)) / 3;
          this.pipeline.imageProcessing.vignetteWeight = effect.baseWeight + heartbeat * effect.amplitude;
        }
        break;

      case "cameraShake":
        this.camera.rotation.x += (Math.random() - 0.5) * effect.intensity;
        this.camera.rotation.y += (Math.random() - 0.5) * effect.intensity;
        break;
    }
  }

  // Track which NPCs have already triggered their dialogue (one-time)
  private npcDialogueTriggered = new Set<number>();

  public start(): void {
    // Nothing needed here - proximity check happens in onUpdate
  }


  private executeQuestGraph(graphData: Record<string, any>, speakerName: string): void {
    const dialogueManager = DialogueManager.getInstance();

    const nodes = graphData.nodes || [];
    const links = graphData.links || [];

    // Build link map: link_id -> { from, to }
    const linkMap = new Map<number, { from: number; to: number }>();
    for (const link of links) {
      if (Array.isArray(link) && link.length >= 4) {
        linkMap.set(link[0], { from: link[1], to: link[3] });
      }
    }

    // Build node map and find START node
    const nodeMap = new Map<number, any>();
    let startNode: any = null;
    for (const node of nodes) {
      nodeMap.set(node.id, node);
      if (node.type === "Dialog/Start") {
        startNode = node;
      }
    }

    if (!startNode) return;

    // Follow flow from START, collecting SAY texts
    const dialogueLines: { speaker: string; text: string; duration: number }[] = [];
    let currentNode = startNode;
    const visited = new Set<number>();

    while (currentNode && !visited.has(currentNode.id)) {
      visited.add(currentNode.id);

      // SAY node - collect text
      if (currentNode.type === "Dialog/Say") {
        // LiteGraph stores widget values in widgets_values array (index 0 is the text)
        let text = "";
        if (currentNode.widgets_values && currentNode.widgets_values.length > 0) {
          text = String(currentNode.widgets_values[0]);
        } else if (currentNode.properties?.text) {
          text = String(currentNode.properties.text);
        }

        if (text) {
          dialogueLines.push({
            speaker: speakerName,
            text: text,
            duration: Math.max(2500, text.length * 100),
          });
        }
      }

      // Find next node via output links
      const outputs = currentNode.outputs || [];
      let nextNodeId: number | null = null;

      for (const output of outputs) {
        if (output.links && output.links.length > 0) {
          const linkId = output.links[0];
          const link = linkMap.get(linkId);
          if (link) {
            nextNodeId = link.to;
            break;
          }
        }
      }

      currentNode = nextNodeId !== null ? nodeMap.get(nextNodeId) : null;
    }

    // Play collected dialogue
    if (dialogueLines.length > 0) {
      const dialogueId = `quest_${Date.now()}`;
      dialogueManager.register({ id: dialogueId, lines: dialogueLines });
      dialogueManager.play(dialogueId);
    }
  }

  // ==================== EDITOR API ====================

  public enableEditorMode(onSelect: SelectCallback, onChange: TransformCallback): void {
    this.cleanupGizmos();
    this.isEditorMode = true;

    this.onObjectSelected = onSelect;
    this.onTransformChange = onChange;

    // Disable portal interactions
    for (const portal of this.portals.values()) {
      portal.editorMode = true;
    }

    this.gizmoManager = new GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;

    this.scene.onPointerDown = (evt, pickResult) => this.handleEditorClick(evt, pickResult);
    this.setupGizmoObservers();
  }

  private handleEditorClick(evt: any, pickResult: any): void {
    if (this.isGizmoHovered()) return;

    if (pickResult.hit && pickResult.pickedMesh) {
      const entity = this.findEntityMesh(pickResult.pickedMesh);
      if (entity) {
        this.gizmoManager?.attachToMesh(entity);
        const meta = entity.metadata as EntityMetadata;
        this.onObjectSelected?.("entity", meta.index, entity);
        return;
      }
    }

    this.gizmoManager?.attachToMesh(null);
    this.onObjectSelected?.("none", -1, null);
  }

  private isGizmoHovered(): boolean {
    const gm = this.gizmoManager;
    if (!gm) return false;

    const { positionGizmo, rotationGizmo, scaleGizmo } = gm.gizmos;

    return !!(
      (positionGizmo && (positionGizmo.xGizmo.isHovered || positionGizmo.yGizmo.isHovered || positionGizmo.zGizmo.isHovered)) ||
      (rotationGizmo && (rotationGizmo.xGizmo.isHovered || rotationGizmo.yGizmo.isHovered || rotationGizmo.zGizmo.isHovered)) ||
      (scaleGizmo && (scaleGizmo.xGizmo.isHovered || scaleGizmo.yGizmo.isHovered || scaleGizmo.zGizmo.isHovered))
    );
  }

  private findEntityMesh(pickedMesh: AbstractMesh): AbstractMesh | null {
    let mesh: AbstractMesh | null = pickedMesh;

    while (mesh) {
      if ((mesh.metadata as EntityMetadata)?.type === "entity") {
        return mesh;
      }
      mesh = mesh.parent as AbstractMesh | null;
    }

    return null;
  }

  private setupGizmoObservers(): void {
    const gm = this.gizmoManager;
    if (!gm) return;

    const updateTransform = () => {
      const mesh = gm.attachedMesh;
      if (!mesh || (mesh.metadata as EntityMetadata)?.type !== "entity") return;

      const meta = mesh.metadata as EntityMetadata;
      this.onTransformChange?.(
        meta.index,
        mesh.position.clone(),
        mesh.rotation.clone(),
        mesh.scaling.clone()
      );
    };

    // Collect observers for cleanup
    const gizmos = [
      gm.gizmos.positionGizmo,
      gm.gizmos.rotationGizmo,
      gm.gizmos.scaleGizmo,
    ];

    for (const gizmo of gizmos) {
      if (!gizmo) continue;

      const endObs = gizmo.onDragEndObservable.add(updateTransform);
      if (endObs) this.gizmoObservers.push(endObs);

      for (const axis of [gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo]) {
        if (!axis) continue;
        const dragObs = axis.dragBehavior.onDragObservable.add(updateTransform);
        if (dragObs) this.gizmoObservers.push(dragObs);
      }
    }
  }

  public setGizmoMode(mode: "position" | "rotation" | "scale"): void {
    if (!this.gizmoManager) return;
    this.gizmoManager.positionGizmoEnabled = mode === "position";
    this.gizmoManager.rotationGizmoEnabled = mode === "rotation";
    this.gizmoManager.scaleGizmoEnabled = mode === "scale";
  }

  public updateEntityTransform(index: number, position: number[], rotation?: number[], scale?: number[]): void {
    const mesh = this.findMeshByIndex(index);
    if (!mesh) return;

    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation = new Vector3(rotation[0], rotation[1], rotation[2]);
    if (scale) mesh.scaling = new Vector3(scale[0], scale[1], scale[2]);

    if (mesh.physicsBody) {
      mesh.physicsBody.setTargetTransform(
        mesh.position,
        mesh.rotationQuaternion || mesh.rotation.toQuaternion()
      );
    }
  }

  private findMeshByIndex(index: number): AbstractMesh | undefined {
    return this.entityMeshIndex.get(index);
  }

  public getEntityAnimationGroups(index: number): string[] {
    const npc = this.npcs.get(index);
    return npc?.getAnimationNames() ?? [];
  }

  public playEntityAnimation(index: number, animationName: string): boolean {
    const npc = this.npcs.get(index);
    if (!npc) {
      console.warn(`[Level] NPC not found for index ${index}`);
      return false;
    }
    return npc.playAnimation(animationName);
  }

  public async swapNPCModel(index: number, assetPath: string, scale?: number): Promise<string[]> {
    const oldNpc = this.npcs.get(index);
    if (oldNpc) {
      oldNpc.dispose();
      this.npcs.delete(index);
    }

    const spawn = this.levelConfig.entities[index];
    const position = spawn?.position ? new Vector3(...spawn.position) : Vector3.Zero();
    const animations = spawn?.type === "npc" ? spawn.animations : undefined;

    const newNpc = await this.entityFactory.spawnNPC({
      asset: assetPath,
      position,
      scale,
      animations,
    });

    const name = `npc_${index}`;
    this.npcs.set(index, newNpc);
    this.setEntityMetadata(newNpc.mesh, index, "npc", name);
    this.entityMeshIndex.set(index, newNpc.mesh);
    this.npcNameIndex.set(name, newNpc);

    return newNpc.getAnimationNames();
  }

  public override hotUpdate(config: LevelConfig): void {
    super.hotUpdate(config);
    this.levelConfig = config;
  }

  private cleanupGizmos(): void {
    for (const obs of this.gizmoObservers) {
      obs.remove();
    }
    this.gizmoObservers = [];

    this.gizmoManager?.dispose();
    this.gizmoManager = undefined;
  }

  public override dispose(): void {
    this.cleanupGizmos();
    this.disposeEntities();
    this.triggerStates.clear();

    super.dispose();
  }
}
