/**
 * LevelStore - Dynamic level storage and management
 * Supports: localStorage, JSON import/export, CRUD operations
 */

import { LEVELS, DEFAULT_CONFIG, type LevelConfig } from "../config/levels";

const STORAGE_KEY = "vxl_levels";
const STORAGE_META_KEY = "vxl_levels_meta";

export interface LevelMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  isBuiltIn: boolean;
}

export class LevelStore {
  private static instance: LevelStore;
  private levels = new Map<string, LevelConfig>();
  private meta = new Map<string, LevelMeta>();

  private constructor() {
    this.loadBuiltInLevels();
    this.loadFromStorage();
  }

  static getInstance(): LevelStore {
    return (LevelStore.instance ??= new LevelStore());
  }

  // ==================== CRUD ====================

  get(id: string): LevelConfig | undefined {
    return this.levels.get(id);
  }

  getAll(): LevelConfig[] {
    return Array.from(this.levels.values());
  }

  getAllMeta(): LevelMeta[] {
    return Array.from(this.meta.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  exists(id: string): boolean {
    return this.levels.has(id);
  }

  create(name: string): LevelConfig {
    const id = this.generateId(name);
    const now = Date.now();

    const config: LevelConfig = {
      id,
      name,
      ambientIntensity: 0.5,
      flashlightIntensity: 3,
      clearColor: [0.05, 0.05, 0.1, 1],
      fogEnabled: false,
      fogColor: [0.1, 0.1, 0.1],
      fogDensity: 0.02,
      cameraRadius: 10,
      cameraBeta: Math.PI / 3,
      pipeline: {
        grain: 20,
        vignette: 5,
        vignetteWeight: 5,
        chromaticAberration: 1,
        contrast: 1.2,
        exposure: 1.0,
      },
      environment: { asset: "/assets/room-large.glb", scale: 1 },
      entities: [],
      dialogues: [],
      triggers: [],
      effects: [],
    };

    this.levels.set(id, config);
    this.meta.set(id, {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
    });

    this.saveToStorage();
    return config;
  }

  save(config: LevelConfig): void {
    const existing = this.meta.get(config.id);

    if (existing?.isBuiltIn) {
      // Clone built-in level as custom
      const newId = config.id + "_custom";
      config = { ...config, id: newId };
    }

    this.levels.set(config.id, config);
    this.meta.set(config.id, {
      id: config.id,
      name: config.name,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      isBuiltIn: false,
    });

    this.saveToStorage();
  }

  delete(id: string): boolean {
    const meta = this.meta.get(id);
    if (!meta || meta.isBuiltIn) return false;

    this.levels.delete(id);
    this.meta.delete(id);
    this.saveToStorage();
    return true;
  }

  duplicate(id: string): LevelConfig | undefined {
    const original = this.levels.get(id);
    if (!original) return undefined;

    const newName = `${original.name} (Copy)`;
    const newId = this.generateId(newName);
    const now = Date.now();

    const copy: LevelConfig = {
      ...JSON.parse(JSON.stringify(original)),
      id: newId,
      name: newName,
    };

    this.levels.set(newId, copy);
    this.meta.set(newId, {
      id: newId,
      name: newName,
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
    });

    this.saveToStorage();
    return copy;
  }

  // ==================== IMPORT/EXPORT ====================

  exportToJson(id: string): string | undefined {
    const config = this.levels.get(id);
    if (!config) return undefined;
    return JSON.stringify(config, null, 2);
  }

  exportAllToJson(): string {
    const custom = this.getAll().filter((l) => !this.meta.get(l.id)?.isBuiltIn);
    return JSON.stringify(custom, null, 2);
  }

  importFromJson(json: string): LevelConfig | undefined {
    try {
      const config = JSON.parse(json) as LevelConfig;

      if (!config.id || !config.name) {
        throw new Error("Invalid level config: missing id or name");
      }

      // Ensure unique ID
      if (this.exists(config.id)) {
        config.id = this.generateId(config.name);
      }

      this.save(config);
      return config;
    } catch (e) {
      console.error("[LevelStore] Import failed:", e);
      return undefined;
    }
  }

  importMultipleFromJson(json: string): LevelConfig[] {
    try {
      const configs = JSON.parse(json) as LevelConfig[];
      if (!Array.isArray(configs)) {
        const single = this.importFromJson(json);
        return single ? [single] : [];
      }

      return configs
        .map((c) => this.importFromJson(JSON.stringify(c)))
        .filter(Boolean) as LevelConfig[];
    } catch (e) {
      console.error("[LevelStore] Batch import failed:", e);
      return [];
    }
  }

  // ==================== STORAGE ====================

  private loadBuiltInLevels(): void {
    for (const [id, config] of Object.entries(LEVELS)) {
      this.levels.set(id, config);
      this.meta.set(id, {
        id,
        name: config.name,
        createdAt: 0,
        updatedAt: 0,
        isBuiltIn: true,
      });
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const data = localStorage.getItem(STORAGE_KEY);
      const metaData = localStorage.getItem(STORAGE_META_KEY);

      if (data) {
        const configs = JSON.parse(data) as LevelConfig[];
        for (const config of configs) {
          this.levels.set(config.id, config);
        }
      }

      if (metaData) {
        const metas = JSON.parse(metaData) as LevelMeta[];
        for (const m of metas) {
          if (!m.isBuiltIn) {
            this.meta.set(m.id, m);
          }
        }
      }
    } catch (e) {
      console.error("[LevelStore] Failed to load from storage:", e);
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === "undefined") return;

    try {
      // Only save custom levels
      const customLevels = this.getAll().filter((l) => !this.meta.get(l.id)?.isBuiltIn);
      const customMeta = this.getAllMeta().filter((m) => !m.isBuiltIn);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(customLevels));
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(customMeta));
    } catch (e) {
      console.error("[LevelStore] Failed to save to storage:", e);
    }
  }

  clearCustomLevels(): void {
    const customIds = this.getAllMeta()
      .filter((m) => !m.isBuiltIn)
      .map((m) => m.id);

    for (const id of customIds) {
      this.levels.delete(id);
      this.meta.delete(id);
    }

    this.saveToStorage();
  }

  // ==================== HELPERS ====================

  private generateId(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    let id = base || "level";
    let counter = 1;

    while (this.exists(id)) {
      id = `${base}_${counter++}`;
    }

    return id;
  }
}
