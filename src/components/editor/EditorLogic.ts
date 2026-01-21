import { Engine } from "../../core/Engine";
import { LevelManager } from "../../managers/LevelManager";
import { Level } from "../../levels/Level";
import { LEVELS, DEFAULT_CONFIG } from "../../config/levels";
import { ENTITIES } from "../../config/entities";

export function editorLogic() {
  return {
    currentLevelId: "level1",
    config: JSON.parse(JSON.stringify(LEVELS.level1)),
    selectedEntityIdx: -1,
    transformMode: "position" as "position" | "rotation" | "scale",
    copyStatus: "Copy JSON",
    showAssetModal: false,
    searchQuery: "",
    outlinerSearch: "",

    // Available assets - these are loaded from public/assets
    availableAssets: [
      "/assets/Demon.glb",
      "/assets/home.glb",
      "/assets/man.glb",
      "/assets/room-large.glb",
      "/assets/wife.glb",
    ],

    availableMusic: [
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
    ],

    // Core references
    engine: null as any,

    get filteredAssets() {
      const field = this.selectingAssetFor?.field;
      const source =
        field === "music" ? this.availableMusic : this.availableAssets;
      if (!this.searchQuery) return source;
      return source.filter((a: string) =>
        a.toLowerCase().includes(this.searchQuery.toLowerCase()),
      );
    },

    async init() {
      const canvas = document.getElementById(
        "game-canvas",
      ) as HTMLCanvasElement;
      if (!canvas) return;

      this.engine = Engine.getInstance(canvas);
      if (!this.engine.engine) {
        await this.engine.init();
      }

      // Start Loop
      const levelManager = LevelManager.getInstance();
      this.engine.runRenderLoop(() => {
        levelManager.update();
        levelManager.getCurrentLevel()?.render();
      });

      // Initial Load
      this.loadLevel(this.currentLevelId);

      // Keyboard shortcuts
      this.setupKeyboardShortcuts();
    },

    setupKeyboardShortcuts() {
      window.addEventListener("keydown", (e) => {
        // Don't trigger if typing in input
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return;
        }

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
            this.selectedEntityIdx = -1;
            const levelManager = LevelManager.getInstance();
            const lvl = levelManager.getCurrentLevel();
            if (lvl instanceof Level) {
              (lvl as any).gizmoManager?.attachToMesh(null);
            }
            break;
          case "d":
            if (e.shiftKey && this.selectedEntityIdx !== -1) {
              // Duplicate entity
              this.duplicateEntity(this.selectedEntityIdx);
            }
            break;
        }
      });
    },

    duplicateEntity(idx: number) {
      const entity = this.config.entities[idx];
      if (!entity) return;

      const copy = JSON.parse(JSON.stringify(entity));
      // Offset position slightly
      copy.position[0] += 1;
      this.config.entities.push(copy);
      this.reloadLevelPromise();
      this.selectedEntityIdx = this.config.entities.length - 1;
    },

    loadLevel(id: string) {
      this.currentLevelId = id;
      if (LEVELS[id]) {
        this.config = JSON.parse(JSON.stringify(LEVELS[id]));
      } else {
        // Fallback
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.config.id = id;
      }
      this.selectedEntityIdx = -1;
      this.reloadLevelPromise();
    },

    async reloadLevelPromise() {
      const levelManager = LevelManager.getInstance();
      levelManager.register("editor", () => new Level(this.config));

      try {
        await levelManager.load("editor");
        // Enable Editor Mode
        const lvl = levelManager.getCurrentLevel();
        if (lvl instanceof Level) {
          lvl.enableEditorMode(
            (type, id, obj) => this.onObjectSelected(type, +id, obj),
            (id, pos, rot, scale) =>
              this.onTransformChange(+id, pos, rot, scale),
          );
          // Sync transform mode
          lvl.setGizmoMode(this.transformMode);
        }
      } catch (e) {
        console.error("Failed to load level", e);
      }
    },

    hotUpdate() {
      const levelManager = LevelManager.getInstance();
      const lvl = levelManager.getCurrentLevel();
      if (lvl && lvl.hotUpdate) {
        lvl.hotUpdate(this.config);
      }
    },

    // --- Asset Browser Context ---
    selectingAssetFor: null as {
      index: number | null;
      field: "entity" | "asset" | "music" | "environment";
    } | null,

    openAssetBrowser(
      forEntityIdx?: number | null,
      field?: "entity" | "asset" | "music" | "environment",
    ) {
      if (field) {
        this.selectingAssetFor = { index: forEntityIdx ?? null, field };
      } else {
        this.selectingAssetFor = null;
      }
      this.showAssetModal = true;
    },

    onAssetSelected(assetPath: string) {
      if (this.selectingAssetFor) {
        const { index, field } = this.selectingAssetFor;

        if (field === "music") {
          this.config.music = assetPath;
          this.hotUpdate();
        } else if (field === "environment") {
          this.config.environment.asset = assetPath;
          this.reloadLevelPromise();
        } else if (index !== null && this.config.entities[index]) {
          if (field === "entity") {
            const name =
              assetPath.split("/").pop()?.replace(".glb", "") || assetPath;
            this.config.entities[index].entity = name;
          } else {
            this.config.entities[index].asset = assetPath;
          }
          this.reloadLevelPromise();
        }

        this.selectingAssetFor = null;
        this.showAssetModal = false;
      } else {
        // Add new prop
        this.addProp(assetPath);
      }
    },

    // --- Entity Management ---
    addEntity(type: "npc" | "portal" | "prop" = "npc") {
      let newEntity: any;

      switch (type) {
        case "npc":
          newEntity = {
            type: "npc",
            entity: "wife",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: 1,
            animations: { idle: "", interact: "" },
          };
          break;
        case "portal":
          newEntity = {
            type: "portal",
            position: [0, 1.5, 0],
            targetLevel: "level1",
          };
          break;
        case "prop":
          newEntity = {
            type: "prop",
            asset: "/assets/home.glb",
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scaling: [1, 1, 1],
            physics: { enabled: false, mass: 0, impostor: "mesh" },
          };
          break;
      }

      this.config.entities.push(newEntity);
      this.reloadLevelPromise();
      this.selectedEntityIdx = this.config.entities.length - 1;
    },

    addProp(assetPath: string) {
      this.config.entities.push({
        type: "prop",
        asset: assetPath,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scaling: [1, 1, 1],
        physics: { enabled: false, mass: 0, impostor: "mesh" },
      });
      this.reloadLevelPromise();
      this.selectedEntityIdx = this.config.entities.length - 1;
      this.showAssetModal = false;
    },

    addPortal() {
      this.addEntity("portal");
    },

    removeEntity(idx: number) {
      this.config.entities.splice(idx, 1);
      this.selectedEntityIdx = -1;
      this.reloadLevelPromise();
    },

    selectEntity(idx: number) {
      this.selectedEntityIdx = idx;
      this.loadEntityAnimations(idx);
    },

    loadEntityAnimations(idx: number) {
      // We need to wait for next frame or retry because level might be reloading
      const levelManager = LevelManager.getInstance();
      const lvl = levelManager.getCurrentLevel();
      if (lvl instanceof Level) {
        // We need to extend the Level type definition in our head or cast it
        // actually we just added getEntityAnimationGroups to Level class
        const groups = (lvl as any).getEntityAnimationGroups(idx);
        if (this.config.entities[idx]) {
          // We don't want to store this in config, but in a local reactive state
          this.currentEntityAnims = groups;
          // Ensure animations object exists so UI bindings don't fail
          if (!this.config.entities[idx].animations) {
            this.config.entities[idx].animations = {};
          }
        }
      }
    },

    previewAnimation(idx: number, animName: string) {
      console.log(
        `[EditorLogic] previewAnimation: idx=${idx}, anim=${animName}`,
      );
      if (!animName) {
        console.warn("[EditorLogic] No animation name provided");
        return;
      }
      const levelManager = LevelManager.getInstance();
      const lvl = levelManager.getCurrentLevel();
      console.log(`[EditorLogic] Current Level:`, lvl);
      if (lvl instanceof Level) {
        (lvl as any).playEntityAnimation(idx, animName);
      } else {
        console.error(
          "[EditorLogic] Current level is not an instance of Level class",
        );
      }
    },

    currentEntityAnims: [] as string[],

    forceUpdateEntity(idx: number) {
      this.reloadLevelPromise();
    },

    setTransformMode(mode: "position" | "rotation" | "scale") {
      this.transformMode = mode;
      const levelManager = LevelManager.getInstance();
      const lvl = levelManager.getCurrentLevel();
      if (lvl && lvl instanceof Level) {
        lvl.setGizmoMode(mode);
      }
    },

    // --- 3D Events ---
    onObjectSelected(type: string, id: number, obj: any) {
      if (type === "entity") {
        this.selectedEntityIdx = id;
        this.loadEntityAnimations(id);
      } else {
        this.selectedEntityIdx = -1;
      }
    },

    onTransformChange(id: number, pos: any, rot: any, scale: any) {
      if (this.selectedEntityIdx === id && this.config.entities[id]) {
        const entity = this.config.entities[id];
        entity.position = [
          parseFloat(pos.x.toFixed(2)),
          parseFloat(pos.y.toFixed(2)),
          parseFloat(pos.z.toFixed(2)),
        ];
        // Capture rotation from Gizmo
        if (rot) {
          entity.rotation = [
            parseFloat(rot.x.toFixed(2)),
            parseFloat(rot.y.toFixed(2)),
            parseFloat(rot.z.toFixed(2)),
          ];
        }
        // Capture scale from Gizmo - store as array for props, single value for NPCs
        if (scale) {
          if (entity.type === "prop") {
            // Props use 'scaling' as array
            entity.scaling = [
              parseFloat(scale.x.toFixed(2)),
              parseFloat(scale.y.toFixed(2)),
              parseFloat(scale.z.toFixed(2)),
            ];
          } else {
            // NPCs use 'scale' as single number (uniform)
            // Use average or just x value for uniform scale
            entity.scale = parseFloat(scale.x.toFixed(2));
          }
        }
      }
    },

    updateTransformFromUI() {
      // Optimized update - do NOT reload level
      if (this.selectedEntityIdx !== -1) {
        const ent = this.config.entities[this.selectedEntityIdx];
        const levelManager = LevelManager.getInstance();
        const lvl = levelManager.getCurrentLevel();
        if (lvl && lvl instanceof Level) {
          // Handle scale properly: props use 'scaling', NPCs use 'scale'
          let scaleArr: number[];
          if (ent.type === "prop" && ent.scaling) {
            scaleArr = ent.scaling;
          } else if (ent.scale !== undefined) {
            const s =
              typeof ent.scale === "number" ? ent.scale : ent.scale[0] || 1;
            scaleArr = [s, s, s];
          } else {
            scaleArr = [1, 1, 1];
          }

          lvl.updateEntityTransform(
            this.selectedEntityIdx,
            ent.position,
            ent.rotation || [0, 0, 0],
            scaleArr,
          );
        }
      }
    },

    // Get scale value for UI display
    getEntityScale(entity: any): number {
      if (entity.type === "prop" && entity.scaling) {
        return entity.scaling[0] || 1;
      }
      if (typeof entity.scale === "number") {
        return entity.scale;
      }
      if (Array.isArray(entity.scale)) {
        return entity.scale[0] || 1;
      }
      return 1;
    },

    // Set scale value from UI
    setEntityScale(entity: any, value: number) {
      if (entity.type === "prop") {
        entity.scaling = [value, value, value];
      } else {
        entity.scale = value;
      }
      this.updateTransformFromUI();
    },

    // --- NPC Logic Helpers ---
    addRequirement(idx: number) {
      if (!this.config.entities[idx].requirements)
        this.config.entities[idx].requirements = [];
      this.config.entities[idx].requirements.push({
        type: "item",
        value: 1,
      });
    },
    removeRequirement(entIdx: number, reqIdx: number) {
      this.config.entities[entIdx].requirements.splice(reqIdx, 1);
    },

    addReward(idx: number) {
      if (!this.config.entities[idx].rewards)
        this.config.entities[idx].rewards = [];
      this.config.entities[idx].rewards.push({ type: "money", value: 100 });
    },
    removeReward(entIdx: number, rewardIdx: number) {
      this.config.entities[entIdx].rewards.splice(rewardIdx, 1);
    },

    // Fail Dialogue (when requirements NOT met)
    addFailDialogue(idx: number) {
      if (!this.config.entities[idx].failDialogue)
        this.config.entities[idx].failDialogue = [];
      this.config.entities[idx].failDialogue.push({
        speaker: "NPC",
        text: "You don't have what I need...",
        duration: 3000,
      });
    },
    removeFailDialogue(entIdx: number, diagIdx: number) {
      this.config.entities[entIdx].failDialogue.splice(diagIdx, 1);
    },

    // Success Dialogue (when requirements ARE met, rewards given)
    addSuccessDialogue(idx: number) {
      if (!this.config.entities[idx].successDialogue)
        this.config.entities[idx].successDialogue = [];
      this.config.entities[idx].successDialogue.push({
        speaker: "NPC",
        text: "Thank you! Here's your reward.",
        duration: 3000,
      });
    },
    removeSuccessDialogue(entIdx: number, diagIdx: number) {
      this.config.entities[entIdx].successDialogue.splice(diagIdx, 1);
    },

    // --- Helpers ---
    getIcon(type: string) {
      if (type === "npc") return "👤";
      if (type === "prop") return "📦";
      if (type === "portal") return "🚪";
      return "❓";
    },

    getAssetName(path: string) {
      if (!path || typeof path !== "string") return "Unknown";
      return path.replace("/assets/", "").replace(".glb", "");
    },

    getEntityName(ent: any) {
      if (!ent) return "Unknown";
      if (ent.name) return ent.name;

      if (ent.type === "npc") return ent.entity;
      if (ent.type === "prop") return "Prop: " + this.getAssetName(ent.asset);
      return `Portal -> ${ent.targetLevel}`;
    },

    getAvailableEntities() {
      return Object.keys(ENTITIES).filter((k) => ENTITIES[k].type === "npc");
    },

    hexToRgb(hex: string) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255,
          }
        : { r: 0, g: 0, b: 0 };
    },

    colorToHex(colorArr: number[]) {
      if (!colorArr) return "#000000";
      const r = Math.round(colorArr[0] * 255)
        .toString(16)
        .padStart(2, "0");
      const g = Math.round(colorArr[1] * 255)
        .toString(16)
        .padStart(2, "0");
      const b = Math.round(colorArr[2] * 255)
        .toString(16)
        .padStart(2, "0");
      return `#${r}${g}${b}`;
    },

    copyJson() {
      navigator.clipboard.writeText(JSON.stringify(this.config, null, 2));
      this.copyStatus = "Copied!";
      setTimeout(() => (this.copyStatus = "Copy JSON"), 2000);
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

    getPipelineRange(setting: string) {
      const ranges: any = {
        grain: { min: 0, max: 50, step: 1 },
        vignette: { min: 0, max: 10, step: 0.1 },
        chromaticAberration: { min: 0, max: 10, step: 0.1 },
        contrast: { min: 0, max: 3, step: 0.1 },
        exposure: { min: 0, max: 5, step: 0.1 },
      };
      return ranges[setting] || { min: 0, max: 100, step: 1 };
    },

    camelToTitle(str: string) {
      const result = str.replace(/([A-Z])/g, " $1");
      return result.charAt(0).toUpperCase() + result.slice(1);
    },
  };
}
