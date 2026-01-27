import { Engine } from "../../core/Engine";
import { LevelManager } from "../../managers/LevelManager";
import { LevelStore, type LevelMeta } from "../../managers/LevelStore";
import { Level } from "../../levels/Level";
import {
  DEFAULT_CONFIG,
  type LevelConfig,
  type EntitySpawn,
  type NPCSpawn,
  type PropSpawn,
  type PortalSpawn,
} from "../../config/levels";
import { ENTITIES } from "../../config/entities";
import type { Vector3 } from "@babylonjs/core";

// Type guards for entity discrimination
function isNPCSpawn(entity: EntitySpawn): entity is NPCSpawn {
  return entity.type === "npc";
}

function isPropSpawn(entity: EntitySpawn): entity is PropSpawn {
  return entity.type === "prop";
}

function isPortalSpawn(entity: EntitySpawn): entity is PortalSpawn {
  return entity.type === "portal";
}

// ==================== TYPES ====================

type TransformMode = "position" | "rotation" | "scale";
type AssetField = "entity" | "asset" | "music" | "environment";

interface AssetSelection {
  index: number | null;
  field: AssetField;
}

interface EditorState {
  currentLevelId: string;
  config: LevelConfig;
  selectedEntityIdx: number;
  transformMode: TransformMode;
  currentEntityAnims: string[];
  copyStatus: string;
  showAssetModal: boolean;
  showLevelModal: boolean;
  showNewLevelModal: boolean;
  showQuestEditor: boolean;
  newLevelName: string;
  searchQuery: string;
  outlinerSearch: string;
  selectingAssetFor: AssetSelection | null;
  engine: Engine | null;
  levelList: LevelMeta[];
  saveStatus: string;
  isDirty: boolean;
}

// ==================== CONSTANTS ====================

const AVAILABLE_ASSETS = [
  "/assets/Demon.glb",
  "/assets/home.glb",
  "/assets/man.glb",
  "/assets/room-large.glb",
  "/assets/wife.glb",
] as const;

const AVAILABLE_MUSIC = [
  "level_1",
  "level_2",
  "teleport",
  "demon_voice",
  "typing",
  "/assets/sounds/level_1.mp3",
  "/assets/sounds/level_2.mp3",
  "/assets/sounds/i_see_you_voice.mp3",
  "/assets/sounds/teleport.mp3",
  "/assets/sounds/typing.mp3",
  "/assets/sounds/beep.wav",
] as const;

const PIPELINE_RANGES = {
  grain: { min: 0, max: 50, step: 1 },
  vignette: { min: 0, max: 10, step: 0.1 },
  chromaticAberration: { min: 0, max: 10, step: 0.1 },
  contrast: { min: 0, max: 3, step: 0.1 },
  exposure: { min: 0, max: 5, step: 0.1 },
} as const;

const ENTITY_ICONS = {
  npc: "👤",
  prop: "📦",
  portal: "🚪",
} as const;

// ==================== HELPERS ====================

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function extractAssetName(path: string): string {
  if (!path || typeof path !== "string") return "Unknown";
  return path.replace("/assets/", "").replace(".glb", "").replace(".mp3", "");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
}

function rgbToHex(color: number[]): string {
  if (!color) return "#000000";
  const [r, g, b] = color.map((c) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${r}${g}${b}`;
}

function camelToTitle(str: string): string {
  return str.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

function createFallbackConfig(): LevelConfig {
  return {
    id: "new_level",
    name: "New Level",
    ambientIntensity: 0.5,
    clearColor: [0.05, 0.05, 0.1, 1],
    fogEnabled: false,
    environment: { asset: "/assets/room-large.glb", scale: 1 },
    entities: [],
  };
}

// ==================== MAIN LOGIC ====================

export function editorLogic() {
  const store = LevelStore.getInstance();
  const firstLevel = store.getFirst() ?? createFallbackConfig();

  const state: EditorState = {
    currentLevelId: firstLevel.id,
    config: deepClone(firstLevel),
    selectedEntityIdx: -1,
    transformMode: "position",
    currentEntityAnims: [],
    copyStatus: "Copy JSON",
    showAssetModal: false,
    showLevelModal: false,
    showNewLevelModal: false,
    showQuestEditor: false,
    newLevelName: "",
    searchQuery: "",
    outlinerSearch: "",
    selectingAssetFor: null,
    engine: null,
    levelList: store.getAllMeta(),
    saveStatus: "Saved",
    isDirty: false,
  };

  let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  const pendingTimeouts: number[] = [];
  let autoSaveTimer: number | null = null;

  // Helper to track timeouts for cleanup
  const safeTimeout = (callback: () => void, delay: number): number => {
    const id = window.setTimeout(() => {
      callback();
      const idx = pendingTimeouts.indexOf(id);
      if (idx > -1) pendingTimeouts.splice(idx, 1);
    }, delay);
    pendingTimeouts.push(id);
    return id;
  };

  return {
    // Expose state
    ...state,
    availableAssets: AVAILABLE_ASSETS,
    availableMusic: AVAILABLE_MUSIC,

    // ==================== COMPUTED ====================

    get filteredAssets(): readonly string[] {
      const source =
        this.selectingAssetFor?.field === "music"
          ? this.availableMusic
          : this.availableAssets;
      if (!this.searchQuery) return source;
      const query = this.searchQuery.toLowerCase();
      return source.filter((a: string) => a.toLowerCase().includes(query));
    },

    // ==================== LIFECYCLE ====================

    async init() {
      const canvas = document.getElementById(
        "game-canvas",
      ) as HTMLCanvasElement;
      if (!canvas) return;

      this.engine = Engine.getInstance(canvas);
      if (!this.engine.engine) {
        await this.engine.init();
      }

      const levelManager = LevelManager.getInstance();
      this.engine.runRenderLoop(() => {
        levelManager.update();
        levelManager.getCurrentLevel()?.render();
      });

      this.loadLevel(this.currentLevelId);
      this.setupKeyboardShortcuts();
    },

    setupKeyboardShortcuts() {
      keyboardHandler = (e: KeyboardEvent) => {
        if (this.isInputFocused(e.target)) return;

        switch (e.key.toLowerCase()) {
          case "g":
            this.setTransformMode("position");
            break;
          case "r":
            this.setTransformMode("rotation");
            break;
          case "s":
            this.setTransformMode("scale");
            break;
          case "delete":
          case "backspace":
            if (this.selectedEntityIdx !== -1) {
              this.removeEntity(this.selectedEntityIdx);
            }
            break;
          case "escape":
            this.deselectEntity();
            break;
          case "d":
            if (e.shiftKey && this.selectedEntityIdx !== -1) {
              this.duplicateEntity(this.selectedEntityIdx);
            }
            break;
        }
      };

      window.addEventListener("keydown", keyboardHandler);
    },

    isInputFocused(target: EventTarget | null): boolean {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      );
    },

    // ==================== LEVEL MANAGEMENT ====================

    loadLevel(id: string) {
      const config = store.get(id);
      if (!config) {
        console.error(`Level "${id}" not found`);
        return;
      }

      this.currentLevelId = id;
      this.config = deepClone(config);
      this.selectedEntityIdx = -1;
      this.currentEntityAnims = [];
      this.isDirty = false;
      this.saveStatus = "Saved";
      this.reloadLevelPromise();
    },

    createNewLevel(name: string) {
      if (!name.trim()) return;

      const config = store.create(name.trim());
      this.levelList = store.getAllMeta();
      this.currentLevelId = config.id;
      this.config = deepClone(config);
      this.selectedEntityIdx = -1;
      this.currentEntityAnims = [];
      this.isDirty = false;
      this.showNewLevelModal = false;
      this.newLevelName = "";
      this.reloadLevelPromise();
    },

    saveCurrentLevel() {
      store.save(this.config);
      this.levelList = store.getAllMeta();
      this.isDirty = false;
      this.saveStatus = "Saved";
      safeTimeout(() => (this.saveStatus = "Saved"), 2000);
    },

    deleteLevel(id: string) {
      const meta = this.levelList.find((l) => l.id === id);
      if (meta?.isBuiltIn) {
        alert("Cannot delete built-in levels");
        return;
      }

      if (!confirm(`Delete "${meta?.name || id}"?`)) return;

      store.delete(id);
      this.levelList = store.getAllMeta();

      // If we deleted the current level, load another
      if (this.currentLevelId === id) {
        const first = this.levelList[0];
        if (first) this.loadLevel(first.id);
      }
    },

    duplicateLevel(id: string) {
      const copy = store.duplicate(id);
      if (copy) {
        this.levelList = store.getAllMeta();
        this.loadLevel(copy.id);
      }
    },

    markDirty() {
      if (!this.isDirty) {
        this.isDirty = true;
        this.saveStatus = "Unsaved*";
      }

      // Auto-save after 3 seconds of no changes
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(() => {
        this.saveCurrentLevel();
        autoSaveTimer = null;
      }, 3000);
    },

    async reloadLevelPromise() {
      const previousIdx = this.selectedEntityIdx;
      const levelManager = LevelManager.getInstance();

      levelManager.register("editor", () => new Level(this.config));

      try {
        await levelManager.load("editor");
        const lvl = levelManager.getCurrentLevel();

        if (lvl instanceof Level) {
          lvl.enableEditorMode(
            (type, id) => this.onObjectSelected(type, id),
            (id, pos, rot, scale) =>
              this.onTransformChange(id, pos, rot, scale),
          );
          lvl.setGizmoMode(this.transformMode);

          // Restore selection
          if (previousIdx !== -1 && this.config.entities[previousIdx]) {
            safeTimeout(() => {
              this.selectedEntityIdx = previousIdx;
              this.loadEntityAnimations(previousIdx);
            }, 100);
          }
        }
      } catch (e) {
        console.error("[Editor] Failed to load level:", e);
      }
    },

    hotUpdate() {
      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl?.hotUpdate) {
        lvl.hotUpdate(this.config);
      }
      this.markDirty();
    },

    // ==================== ENTITY MANAGEMENT ====================

    async addEntity(type: "npc" | "portal" | "prop" = "npc") {
      const entity = this.createDefaultEntity(type);
      this.config.entities.push(entity);
      const newIndex = this.config.entities.length - 1;

      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        const anims = await lvl.addEntityLive(newIndex, entity);
        this.currentEntityAnims = anims;
      }

      this.selectedEntityIdx = newIndex;
      this.markDirty();
    },

    createDefaultEntity(type: "npc" | "portal" | "prop"): EntitySpawn {
      switch (type) {
        case "npc":
          return {
            type: "npc",
            asset: "/assets/wife.glb",
            name: "New NPC",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: 1,
            animations: { idle: "", interact: "" },
          };
        case "portal":
          return {
            type: "portal",
            position: [0, 1.5, 0],
            targetLevel: "level1",
          };
        case "prop":
          return {
            type: "prop",
            asset: "/assets/home.glb",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scaling: [1, 1, 1],
            physics: { enabled: false, mass: 0, impostor: "mesh" },
          };
      }
    },

    async addProp(assetPath: string) {
      const entity = this.createDefaultEntity("prop") as PropSpawn;
      entity.asset = assetPath;
      this.config.entities.push(entity);
      const newIndex = this.config.entities.length - 1;

      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        await lvl.addEntityLive(newIndex, entity);
      }

      this.selectedEntityIdx = newIndex;
      this.showAssetModal = false;
      this.markDirty();
    },

    removeEntity(idx: number) {
      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        lvl.removeEntityLive(idx);
      }

      this.config.entities.splice(idx, 1);
      this.selectedEntityIdx = -1;
      this.currentEntityAnims = [];
      this.markDirty();
    },

    async duplicateEntity(idx: number) {
      const entity = this.config.entities[idx];
      if (!entity) return;

      const copy = deepClone(entity);
      copy.position[0] += 1;
      this.config.entities.push(copy);
      const newIndex = this.config.entities.length - 1;

      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        const anims = await lvl.addEntityLive(newIndex, copy);
        this.currentEntityAnims = anims;
      }

      this.selectedEntityIdx = newIndex;
      this.markDirty();
    },

    selectEntity(idx: number) {
      this.selectedEntityIdx = idx;
      safeTimeout(() => this.loadEntityAnimations(idx), 100);
    },

    deselectEntity() {
      this.selectedEntityIdx = -1;
      this.currentEntityAnims = [];
      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        (lvl as any).gizmoManager?.attachToMesh(null);
      }
    },

    // ==================== ASSET BROWSER ====================

    openAssetBrowser(forEntityIdx?: number | null, field?: AssetField) {
      this.selectingAssetFor = field
        ? { index: forEntityIdx ?? null, field }
        : null;
      this.showAssetModal = true;
    },

    async onAssetSelected(assetPath: string) {
      if (!this.selectingAssetFor) {
        this.addProp(assetPath);
        return;
      }

      const { index, field } = this.selectingAssetFor;

      switch (field) {
        case "music":
          this.config.music = assetPath;
          this.hotUpdate();
          break;

        case "environment":
          this.config.environment.asset = assetPath;
          this.reloadLevelPromise();
          break;

        case "entity":
          if (index !== null && this.config.entities[index]) {
            await this.swapEntityModel(index, assetPath);
          }
          break;

        case "asset":
          if (index !== null && this.config.entities[index]) {
            const ent = this.config.entities[index];
            if (isPropSpawn(ent)) {
              ent.asset = assetPath;
              const lvl = LevelManager.getInstance().getCurrentLevel();
              if (lvl instanceof Level) {
                await lvl.swapPropModel(index, assetPath);
              }
              this.markDirty();
            } else if (isNPCSpawn(ent)) {
              await this.swapEntityModel(index, assetPath);
            }
          }
          break;
      }

      this.selectingAssetFor = null;
      this.showAssetModal = false;
    },

    async swapEntityModel(index: number, assetPath: string) {
      const entity = this.config.entities[index];
      if (!isNPCSpawn(entity)) return;

      entity.asset = assetPath;
      delete entity.entity;
      entity.animations = { idle: "", interact: "" };

      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        const anims = await lvl.swapNPCModel(index, assetPath, entity.scale);
        this.currentEntityAnims = anims;
      }
      this.markDirty();
    },

    // ==================== ANIMATIONS ====================

    loadEntityAnimations(idx: number) {
      const lvl = LevelManager.getInstance().getCurrentLevel();

      if (!(lvl instanceof Level)) {
        safeTimeout(() => this.loadEntityAnimations(idx), 200);
        return;
      }

      const anims = lvl.getEntityAnimationGroups(idx);
      this.currentEntityAnims = anims;

      const entity = this.config.entities[idx];
      if (entity && isNPCSpawn(entity) && !entity.animations) {
        entity.animations = { idle: "", interact: "" };
      }
    },

    previewAnimation(idx: number, animName: string) {
      if (!animName) return;

      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        lvl.playEntityAnimation(idx, animName);
      }
    },

    // ==================== 3D CALLBACKS ====================

    onObjectSelected(type: string, id: number) {
      if (type === "entity") {
        this.selectedEntityIdx = id;
        safeTimeout(() => this.loadEntityAnimations(id), 50);
      } else {
        this.selectedEntityIdx = -1;
        this.currentEntityAnims = [];
      }
    },

    onTransformChange(
      id: number,
      pos: Vector3,
      rot?: Vector3,
      scale?: Vector3,
    ) {
      const entity = this.config.entities[id];
      if (!entity || this.selectedEntityIdx !== id) return;

      entity.position = [
        parseFloat(pos.x.toFixed(2)),
        parseFloat(pos.y.toFixed(2)),
        parseFloat(pos.z.toFixed(2)),
      ];

      if (rot && (isNPCSpawn(entity) || isPropSpawn(entity))) {
        entity.rotation = [
          parseFloat(rot.x.toFixed(2)),
          parseFloat(rot.y.toFixed(2)),
          parseFloat(rot.z.toFixed(2)),
        ];
      }

      if (scale) {
        if (isPropSpawn(entity)) {
          entity.scaling = [
            parseFloat(scale.x.toFixed(2)),
            parseFloat(scale.y.toFixed(2)),
            parseFloat(scale.z.toFixed(2)),
          ];
        } else if (isNPCSpawn(entity)) {
          entity.scale = parseFloat(scale.x.toFixed(2));
        }
      }

      this.markDirty();
    },

    setTransformMode(mode: TransformMode) {
      this.transformMode = mode;
      const lvl = LevelManager.getInstance().getCurrentLevel();
      if (lvl instanceof Level) {
        lvl.setGizmoMode(mode);
      }
    },

    updateTransformFromUI() {
      if (this.selectedEntityIdx === -1) return;

      const entity = this.config.entities[this.selectedEntityIdx];
      const lvl = LevelManager.getInstance().getCurrentLevel();

      if (!(lvl instanceof Level)) return;

      const scale = this.getEntityScaleArray(entity);
      const rotation = (isNPCSpawn(entity) || isPropSpawn(entity)) ? (entity.rotation || [0, 0, 0]) : [0, 0, 0];
      lvl.updateEntityTransform(
        this.selectedEntityIdx,
        entity.position,
        rotation,
        scale,
      );
      this.markDirty();
    },

    forceUpdateEntity(idx: number) {
      this.reloadLevelPromise();
    },

    // ==================== SCALE HELPERS ====================

    getEntityScale(entity: EntitySpawn): number {
      if (isPropSpawn(entity) && entity.scaling) return entity.scaling[0] || 1;
      if (isNPCSpawn(entity) && typeof entity.scale === "number")
        return entity.scale;
      return 1;
    },

    getEntityScaleArray(entity: EntitySpawn): number[] {
      if (isPropSpawn(entity) && entity.scaling) return [...entity.scaling];
      if (isNPCSpawn(entity)) {
        const s = typeof entity.scale === "number" ? entity.scale : 1;
        return [s, s, s];
      }
      return [1, 1, 1];
    },

    setEntityScale(entity: EntitySpawn, value: number) {
      if (isPropSpawn(entity)) {
        entity.scaling = [value, value, value];
      } else if (isNPCSpawn(entity)) {
        entity.scale = value;
      }
      this.updateTransformFromUI();
    },

    // ==================== NPC FEATURES ====================

    addRequirement(idx: number) {
      const entity = this.config.entities[idx];
      if (!isNPCSpawn(entity)) return;
      if (!entity.requirements) entity.requirements = [];
      entity.requirements.push({ type: "item", value: 1 });
    },

    removeRequirement(entIdx: number, reqIdx: number) {
      const entity = this.config.entities[entIdx];
      if (isNPCSpawn(entity)) {
        entity.requirements?.splice(reqIdx, 1);
      }
    },

    addReward(idx: number) {
      const entity = this.config.entities[idx];
      if (!isNPCSpawn(entity)) return;
      if (!entity.rewards) entity.rewards = [];
      entity.rewards.push({ type: "money", value: 100 });
    },

    removeReward(entIdx: number, rewardIdx: number) {
      const entity = this.config.entities[entIdx];
      if (isNPCSpawn(entity)) {
        entity.rewards?.splice(rewardIdx, 1);
      }
    },

    addFailDialogue(idx: number) {
      const entity = this.config.entities[idx];
      if (!isNPCSpawn(entity)) return;
      if (!entity.failDialogue) entity.failDialogue = [];
      entity.failDialogue.push({
        speaker: "NPC",
        text: "You don't have what I need...",
      });
    },

    removeFailDialogue(entIdx: number, diagIdx: number) {
      const entity = this.config.entities[entIdx];
      if (isNPCSpawn(entity)) {
        entity.failDialogue?.splice(diagIdx, 1);
      }
    },

    addSuccessDialogue(idx: number) {
      const entity = this.config.entities[idx];
      if (!isNPCSpawn(entity)) return;
      if (!entity.successDialogue) entity.successDialogue = [];
      entity.successDialogue.push({
        speaker: "NPC",
        text: "Thank you! Here's your reward.",
      });
    },

    removeSuccessDialogue(entIdx: number, diagIdx: number) {
      const entity = this.config.entities[entIdx];
      if (isNPCSpawn(entity)) {
        entity.successDialogue?.splice(diagIdx, 1);
      }
    },

    // ==================== QUEST EDITOR ====================

    openQuestEditor(idx: number) {
      this.selectedEntityIdx = idx;
      this.showQuestEditor = true;
    },

    closeQuestEditor() {
      this.showQuestEditor = false;
    },

    saveQuestGraph(data: any) {
      if (this.selectedEntityIdx === -1) return;

      const entity = this.config.entities[this.selectedEntityIdx];
      if (entity && isNPCSpawn(entity)) {
        entity.questGraph = data;
        console.log("Saved Quest Graph for NPC:", entity.name, data);
        // Save immediately (don't wait for auto-save)
        this.saveCurrentLevel();
      }
    },

    // ==================== UI HELPERS ====================

    getIcon(type: string): string {
      return ENTITY_ICONS[type as keyof typeof ENTITY_ICONS] || "❓";
    },

    getAssetName: extractAssetName,

    getEntityName(entity: EntitySpawn | null): string {
      if (!entity) return "Unknown";
      if (entity.name) return entity.name;

      if (isNPCSpawn(entity)) {
        return extractAssetName(entity.asset || entity.entity || "Unknown");
      }
      if (isPropSpawn(entity)) {
        return `Prop: ${extractAssetName(entity.asset)}`;
      }
      if (isPortalSpawn(entity)) {
        return `Portal → ${entity.targetLevel}`;
      }
      return "Unknown";
    },

    getModelDisplayName(entity: EntitySpawn | null): string {
      if (!entity) return "";
      if (isNPCSpawn(entity))
        return extractAssetName(entity.asset || entity.entity || "");
      if (isPropSpawn(entity)) return extractAssetName(entity.asset);
      return "";
    },

    getAvailableEntities(): string[] {
      return Object.keys(ENTITIES).filter((k) => ENTITIES[k].type === "npc");
    },

    hexToRgb,
    colorToHex: rgbToHex,
    camelToTitle,

    getPipelineRange(setting: string) {
      return (
        PIPELINE_RANGES[setting as keyof typeof PIPELINE_RANGES] || {
          min: 0,
          max: 100,
          step: 1,
        }
      );
    },

    // ==================== IMPORT/EXPORT ====================

    copyJson() {
      navigator.clipboard.writeText(JSON.stringify(this.config, null, 2));
      this.copyStatus = "Copied!";
      safeTimeout(() => (this.copyStatus = "Copy JSON"), 2000);
    },

    downloadJson() {
      const blob = new Blob([JSON.stringify(this.config, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `level_${this.config.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    async importJson() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const imported = store.importFromJson(text);

          if (imported) {
            this.levelList = store.getAllMeta();
            this.loadLevel(imported.id);
          } else {
            alert("Failed to import level. Check the JSON format.");
          }
        } catch (err) {
          alert("Failed to read file");
        }
      };

      input.click();
    },

    exportAllLevels() {
      const json = store.exportAllToJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "all_custom_levels.json";
      a.click();
      URL.revokeObjectURL(url);
    },

    // ==================== CLEANUP ====================

    destroy() {
      // Save any pending changes
      if (this.isDirty) {
        this.saveCurrentLevel();
      }

      // Clear all pending timeouts
      for (const id of pendingTimeouts) {
        window.clearTimeout(id);
      }
      pendingTimeouts.length = 0;

      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }

      if (keyboardHandler) {
        window.removeEventListener("keydown", keyboardHandler);
        keyboardHandler = null;
      }

      this.engine?.dispose();
      this.engine = null;
    },

    // ==================== LEVEL LIST HELPERS ====================

    getLevelList(): LevelMeta[] {
      return this.levelList;
    },

    refreshLevelList() {
      this.levelList = store.getAllMeta();
    },

    isBuiltInLevel(id: string): boolean {
      return this.levelList.find((l) => l.id === id)?.isBuiltIn ?? false;
    },
  };
}
