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
  type IPointerEvent,
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
  QuestGraph,
  QuestGraphNode,
  QuestGraphLink,
} from "../config/levels";
import { NPC } from "../entities/NPC";
import type { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { DialogueManager } from "../managers/DialogueManager";
import { BaseLevel } from "./BaseLevel";

// ==================== CONSTANTS ====================

const INTERACTION_RADIUS = 3;

// ==================== TYPES ====================

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

type SelectCallback = (type: string, id: number, object: AbstractMesh | null) => void;
type TransformCallback = (id: number, pos: Vector3, rot?: Vector3, scale?: Vector3) => void;

// ==================== HELPERS ====================

function isEntityMetadata(meta: unknown): meta is EntityMetadata {
  return meta !== null && typeof meta === "object" && (meta as EntityMetadata).type === "entity";
}

function parseQuestLinks(links: QuestGraphLink[]): Map<number, ParsedLink> {
  const linkMap = new Map<number, ParsedLink>();
  for (const link of links) {
    if (Array.isArray(link) && link.length >= 4) {
      linkMap.set(link[0], { from: link[1], to: link[3], slot: link[2] });
    }
  }
  return linkMap;
}

// ==================== LEVEL CLASS ====================

export class Level extends BaseLevel {
  private levelConfig: LevelConfig;
  private currentMusic: string | undefined;

  // Entity maps
  private npcs = new Map<number, NPC>();
  private portals = new Map<number, Portal>();
  private props = new Map<number, AbstractMesh>();
  private triggerStates = new Map<Trigger, TriggerState>();
  private npcDialogueTriggered = new Set<number>();

  // O(1) lookups
  private entityMeshIndex = new Map<number, AbstractMesh>();
  private npcNameIndex = new Map<string, NPC>();

  // Effects
  private effectTime = 0;

  // Editor
  private gizmoManager?: GizmoManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // ==================== LIFECYCLE ====================

  protected async onLoad(): Promise<void> {
    AudioManager.getInstance().stopAll();

    if (this.levelConfig.music) {
      AudioManager.getInstance().play(this.levelConfig.music, true);
      this.currentMusic = this.levelConfig.music;
    }

    await this.loadEnvironment();
    await this.spawnEntities();
    this.registerDialogues();
    this.initTriggers();
  }

  protected override onUpdate(): void {
    if (!this.isEditorMode) {
      this.checkNPCProximity();
    }
    this.processTriggers();
    this.processEffects();
  }

  public start(): void {
    // Proximity check happens in onUpdate
  }

  public override dispose(): void {
    this.cleanupGizmos();
    this.disposeEntities();
    this.triggerStates.clear();
    this.npcDialogueTriggered.clear();
    super.dispose();
  }

  // ==================== ENVIRONMENT ====================

  private async loadEnvironment(): Promise<void> {
    const env = this.levelConfig.environment;
    if (!env?.asset) {
      console.warn("[Level] No environment asset configured");
      return;
    }

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

  // ==================== ENTITY SPAWNING ====================

  private async spawnEntities(): Promise<void> {
    this.disposeEntities();

    const entities = this.levelConfig.entities;
    for (let i = 0; i < entities.length; i++) {
      const spawn = entities[i];
      const position = new Vector3(...spawn.position);

      try {
        switch (spawn.type) {
          case "npc":
            await this.spawnNPC(i, spawn, position);
            break;
          case "portal":
            this.spawnPortalEntity(i, spawn, position);
            break;
          case "prop":
            await this.spawnProp(i, spawn, position);
            break;
        }
      } catch (error) {
        console.error(`[Level] Failed to spawn entity ${i}:`, error);
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

    const name = spawn.name || spawn.entity || spawn.asset || `npc_${index}`;
    this.npcs.set(index, npc);
    this.setEntityMetadata(npc.mesh, index, "npc", name);
    this.npcNameIndex.set(name, npc);
    this.entityMeshIndex.set(index, npc.mesh);
  }

  private spawnPortalEntity(index: number, spawn: PortalSpawn, position: Vector3): void {
    const portal = this.entityFactory.spawnPortal(position, spawn.targetLevel, this.isEditorMode);
    this.portals.set(index, portal);

    if (!this.portal) this.portal = portal;

    if (portal.mesh) {
      this.setEntityMetadata(portal.mesh, index, "portal");
      this.entityMeshIndex.set(index, portal.mesh);
    }
  }

  private async spawnProp(index: number, spawn: PropSpawn, position: Vector3): Promise<void> {
    const data = await this.assetManager.loadMesh(spawn.asset, this.scene);
    const root = data.meshes[0];
    if (!root) return;

    root.position.copyFrom(position);
    if (spawn.rotation) {
      root.rotation.set(spawn.rotation[0], spawn.rotation[1], spawn.rotation[2]);
    }
    if (spawn.scaling) {
      root.scaling.set(spawn.scaling[0], spawn.scaling[1], spawn.scaling[2]);
    }

    this.props.set(index, root);
    this.setEntityMetadata(root, index, "prop");
    this.entityMeshIndex.set(index, root);

    if (spawn.physics?.enabled) {
      this.setupPropPhysics(root as Mesh, spawn.physics.mass);
    }
  }

  private setEntityMetadata(
    mesh: AbstractMesh,
    index: number,
    entityType: EntityMetadata["entityType"],
    id?: string,
  ): void {
    mesh.metadata = { type: "entity", index, entityType, id } satisfies EntityMetadata;
  }

  private setupPropPhysics(mesh: Mesh, mass: number): void {
    const motionType = mass > 0 ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC;
    const body = new PhysicsBody(mesh, motionType, false, this.scene);
    body.setMassProperties({ mass });
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
  }

  private disposeEntities(): void {
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();

    for (const portal of this.portals.values()) portal.mesh?.dispose();
    this.portals.clear();

    for (const prop of this.props.values()) prop.dispose();
    this.props.clear();

    this.entityMeshIndex.clear();
    this.npcNameIndex.clear();
  }

  // ==================== DIALOGUES & TRIGGERS ====================

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

  private checkNPCProximity(): void {
    if (!this.player) return;

    const dialogueManager = DialogueManager.getInstance();
    if (dialogueManager.isActive()) return;

    for (let i = 0; i < this.levelConfig.entities.length; i++) {
      const spawn = this.levelConfig.entities[i];
      if (spawn.type !== "npc") continue;
      if (this.npcDialogueTriggered.has(i)) continue;

      const npc = this.npcs.get(i);
      if (!npc) continue;

      const dist = Vector3.Distance(this.player.position, npc.position);
      if (dist < INTERACTION_RADIUS) {
        this.npcDialogueTriggered.add(i);

        if (spawn.questGraph) {
          this.executeQuestGraph(spawn.questGraph, spawn.name || "NPC");
          return;
        }

        if (spawn.successDialogue?.length) {
          const dialogueId = `npc_${i}_success`;
          dialogueManager.register({ id: dialogueId, lines: spawn.successDialogue });
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
        const targetNpc = this.npcNameIndex.get(trigger.target);
        if (!targetNpc) continue;

        const dist = Vector3.Distance(this.player.position, targetNpc.position);
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
          DialogueManager.getInstance().play(String(action.value));
          break;
        case "playSound":
          AudioManager.getInstance().play(String(action.value));
          break;
        case "setSpotlightIntensity":
          if (this.player) {
            this.player.spotLight.intensity = Number(action.value);
          }
          break;
      }
    }
  }

  // ==================== EFFECTS ====================

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

  // ==================== QUEST GRAPH ====================

  private executeQuestGraph(graph: QuestGraph, speakerName: string): void {
    if (!graph.nodes?.length) {
      console.warn("[Quest] Empty quest graph");
      return;
    }

    const dialogueManager = DialogueManager.getInstance();
    const linkMap = parseQuestLinks(graph.links ?? []);

    const getNode = (id: number): QuestGraphNode | undefined =>
      graph.nodes.find((n) => n.id === id);

    const getNextNode = (node: QuestGraphNode, slotIndex = 0): QuestGraphNode | null => {
      const output = node.outputs?.[slotIndex];
      if (!output?.links?.length) return null;

      const link = linkMap.get(output.links[0]);
      return link ? getNode(link.to) ?? null : null;
    };

    const runStep = (nodeId: number): void => {
      const node = getNode(nodeId);
      if (!node) return;

      switch (node.type) {
        case "Dialog/Start": {
          const next = getNextNode(node);
          if (next) runStep(next.id);
          break;
        }

        case "Dialog/Say": {
          const lines: { speaker: string; text: string }[] = [];
          let curr: QuestGraphNode | null = node;

          while (curr?.type === "Dialog/Say") {
            const text = String(curr.widgets_values?.[0] ?? curr.properties?.text ?? "");
            lines.push({ speaker: speakerName, text });

            const next = getNextNode(curr);
            if (next?.type === "Dialog/Say") {
              curr = next;
            } else {
              const nextId = next?.id ?? null;
              const dialogueId = `quest_say_${Date.now()}_${nodeId}`;

              dialogueManager.register({
                id: dialogueId,
                lines,
                onComplete: () => { if (nextId !== null) runStep(nextId); },
              });
              dialogueManager.play(dialogueId);
              return;
            }
          }
          break;
        }

        case "Dialog/Choice": {
          const props = node.properties as { prompt?: string; options?: string[] } | undefined;
          const prompt = props?.prompt ?? "Choose...";
          const options = props?.options ?? ["Yes", "No"];

          const choices = options.slice(0, 3).map((opt, idx) => ({
            text: opt || `Option ${idx + 1}`,
            value: idx,
          }));

          const dialogueId = `quest_choice_${Date.now()}_${nodeId}`;
          dialogueManager.register({
            id: dialogueId,
            lines: [{ speaker: speakerName, text: prompt, choices }],
            onChoice: (slotIndex: number) => {
              const next = getNextNode(node, slotIndex);
              if (next) runStep(next.id);
              else dialogueManager.stop();
            },
          });
          dialogueManager.play(dialogueId);
          break;
        }

        case "Dialog/Check": {
          const props = node.properties as { checkType?: string } | undefined;
          const result = props?.checkType === "Level" ? true : Math.random() > 0.1;
          const next = getNextNode(node, result ? 0 : 1);
          if (next) runStep(next.id);
          break;
        }

        case "Dialog/Give": {
          const props = node.properties as { giveType?: string; amount?: number } | undefined;
          console.log(`[Quest] Giving ${props?.giveType}: ${props?.amount}`);
          const next = getNextNode(node);
          if (next) runStep(next.id);
          break;
        }

        case "Dialog/End":
          dialogueManager.stop();
          break;

        default:
          console.warn("[Quest] Unknown node type:", node.type);
      }
    };

    const startNode = graph.nodes.find((n) => n.type === "Dialog/Start");
    if (startNode) {
      runStep(startNode.id);
    } else {
      console.warn("[Quest] No start node found");
    }
  }

  // ==================== EDITOR API ====================

  public enableEditorMode(onSelect: SelectCallback, onChange: TransformCallback): void {
    this.cleanupGizmos();
    this.isEditorMode = true;
    this.onObjectSelected = onSelect;
    this.onTransformChange = onChange;

    for (const portal of this.portals.values()) {
      portal.editorMode = true;
    }

    this.gizmoManager = new GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;

    this.scene.onPointerDown = (_evt: IPointerEvent, pickResult: PickingInfo, _type: PointerEventTypes) =>
      this.handleEditorClick(pickResult);
    this.setupGizmoObservers();
  }

  private handleEditorClick(pickResult: PickingInfo): void {
    if (this.isGizmoHovered()) return;

    if (pickResult.hit && pickResult.pickedMesh) {
      const entity = this.findEntityMesh(pickResult.pickedMesh);
      if (entity && isEntityMetadata(entity.metadata)) {
        this.gizmoManager?.attachToMesh(entity);
        this.onObjectSelected?.("entity", entity.metadata.index, entity);
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

    const checkGizmo = (g: { xGizmo: { isHovered: boolean }; yGizmo: { isHovered: boolean }; zGizmo: { isHovered: boolean } } | null) =>
      g && (g.xGizmo.isHovered || g.yGizmo.isHovered || g.zGizmo.isHovered);

    return !!(checkGizmo(positionGizmo) || checkGizmo(rotationGizmo) || checkGizmo(scaleGizmo));
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

    const updateTransform = () => {
      const mesh = gm.attachedMesh;
      if (!mesh || !isEntityMetadata(mesh.metadata)) return;

      this.onTransformChange?.(
        mesh.metadata.index,
        mesh.position.clone(),
        mesh.rotation.clone(),
        mesh.scaling.clone(),
      );
    };

    const gizmos = [gm.gizmos.positionGizmo, gm.gizmos.rotationGizmo, gm.gizmos.scaleGizmo];

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

    const name = spawn?.name || `npc_${index}`;
    this.npcs.set(index, newNpc);
    this.setEntityMetadata(newNpc.mesh, index, "npc", name);
    this.entityMeshIndex.set(index, newNpc.mesh);
    this.npcNameIndex.set(name, newNpc);

    return newNpc.getAnimationNames();
  }

  public override hotUpdate(config: LevelConfig): void {
    super.hotUpdate(config);

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

  // ==================== LIVE ENTITY MANAGEMENT ====================

  public async addEntityLive(index: number, spawn: NPCSpawn | PortalSpawn | PropSpawn): Promise<string[]> {
    const position = new Vector3(...spawn.position);

    try {
      switch (spawn.type) {
        case "npc":
          await this.spawnNPC(index, spawn, position);
          return this.npcs.get(index)?.getAnimationNames() ?? [];
        case "portal":
          this.spawnPortalEntity(index, spawn, position);
          return [];
        case "prop":
          await this.spawnProp(index, spawn, position);
          return [];
      }
    } catch (error) {
      console.error(`[Level] Failed to add entity ${index}:`, error);
      return [];
    }
  }

  public removeEntityLive(index: number): void {
    // Remove NPC
    const npc = this.npcs.get(index);
    if (npc) {
      const name = npc.mesh.metadata?.id;
      if (name) this.npcNameIndex.delete(name);
      npc.dispose();
      this.npcs.delete(index);
    }

    // Remove Portal
    const portal = this.portals.get(index);
    if (portal) {
      portal.mesh?.dispose();
      this.portals.delete(index);
    }

    // Remove Prop
    const prop = this.props.get(index);
    if (prop) {
      prop.dispose();
      this.props.delete(index);
    }

    // Clean up indexes
    this.entityMeshIndex.delete(index);

    // Reindex remaining entities (shift indices down)
    this.reindexEntities(index);
  }

  private reindexEntities(removedIndex: number): void {
    // Rebuild maps with corrected indices
    const newNpcs = new Map<number, NPC>();
    const newPortals = new Map<number, Portal>();
    const newProps = new Map<number, AbstractMesh>();
    const newMeshIndex = new Map<number, AbstractMesh>();

    for (const [idx, npc] of this.npcs) {
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      newNpcs.set(newIdx, npc);
      if (isEntityMetadata(npc.mesh.metadata)) {
        npc.mesh.metadata.index = newIdx;
      }
      newMeshIndex.set(newIdx, npc.mesh);
    }

    for (const [idx, portal] of this.portals) {
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      newPortals.set(newIdx, portal);
      if (portal.mesh && isEntityMetadata(portal.mesh.metadata)) {
        portal.mesh.metadata.index = newIdx;
      }
      if (portal.mesh) newMeshIndex.set(newIdx, portal.mesh);
    }

    for (const [idx, prop] of this.props) {
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      newProps.set(newIdx, prop);
      if (isEntityMetadata(prop.metadata)) {
        prop.metadata.index = newIdx;
      }
      newMeshIndex.set(newIdx, prop);
    }

    this.npcs = newNpcs;
    this.portals = newPortals;
    this.props = newProps;
    this.entityMeshIndex = newMeshIndex;
  }

  public duplicateEntityLive(sourceIndex: number, newIndex: number, spawn: NPCSpawn | PortalSpawn | PropSpawn): Promise<string[]> {
    return this.addEntityLive(newIndex, spawn);
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
    this.setEntityMetadata(root, index, "prop");
    this.entityMeshIndex.set(index, root);
  }

  private cleanupGizmos(): void {
    for (const obs of this.gizmoObservers) {
      obs.remove();
    }
    this.gizmoObservers = [];
    this.gizmoManager?.dispose();
    this.gizmoManager = undefined;
  }
}
