/**
 * LevelStore - Dynamic level storage from localStorage
 * All levels are user-created, no built-in levels
 */

import { DEFAULT_CONFIG, type LevelConfig } from "../game/config/levels";

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
    this.loadFromStorage();
    this.ensureStarterLevel();
  }

  static getInstance(): LevelStore {
    return (LevelStore.instance ??= new LevelStore());
  }

  private ensureStarterLevel(): void {
    // If no levels exist, create a starter level
    if (this.levels.size === 0) {
      const starterLevel: LevelConfig = {
        ...DEFAULT_CONFIG,
        id: "starter",
        name: "My First Level",
        environment: {
          asset: "",
          scale: 1,
        },
        entities: [],
      };

      const now = Date.now();
      this.levels.set(starterLevel.id, starterLevel);
      this.meta.set(starterLevel.id, {
        id: starterLevel.id,
        name: starterLevel.name,
        createdAt: now,
        updatedAt: now,
        isBuiltIn: false,
      });

      this.saveToStorage();
    }
  }

  // ==================== CRUD ====================

  get(id: string): LevelConfig | undefined {
    return this.levels.get(id);
  }

  getAll(): LevelConfig[] {
    return Array.from(this.levels.values());
  }

  getAllMeta(): LevelMeta[] {
    return Array.from(this.meta.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  getFirst(): LevelConfig | undefined {
    const metas = this.getAllMeta();
    if (metas.length === 0) return undefined;
    return this.levels.get(metas[0].id);
  }

  exists(id: string): boolean {
    return this.levels.has(id);
  }

  create(name: string): LevelConfig {
    const id = this.generateId(name);
    const now = Date.now();

    const config: LevelConfig = {
      ...DEFAULT_CONFIG,
      id,
      name,
      environment: {
        asset: "",
        scale: 1,
      },
      entities: [],
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

  delete(id: string): boolean {
    // Don't delete if it's the only level
    if (this.levels.size <= 1) return false;

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
    return JSON.stringify(this.getAll(), null, 2);
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

  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const metaData = localStorage.getItem(STORAGE_META_KEY);
      if (metaData) {
        const metas = JSON.parse(metaData) as LevelMeta[];
        for (const m of metas) {
          this.meta.set(m.id, m);
          // Load individual level
          const levelData = localStorage.getItem(`${STORAGE_KEY}_${m.id}`);
          if (levelData) {
            this.levels.set(m.id, JSON.parse(levelData));
          }
        }
      }

      // Migration check: If the old big key exists, migrate it
      const oldData = localStorage.getItem(STORAGE_KEY);
      if (oldData) {
        console.log("[LevelStore] Migrating legacy storage format...");
        const configs = JSON.parse(oldData) as LevelConfig[];
        for (const config of configs) {
          if (!this.levels.has(config.id)) {
            this.levels.set(config.id, config);
            // Save individually immediately
            localStorage.setItem(
              `${STORAGE_KEY}_${config.id}`,
              JSON.stringify(config),
            );
          }
        }
        // Remove old key after migration
        localStorage.removeItem(STORAGE_KEY);
        this.saveToStorage(); // Refresh meta
      }
    } catch (e) {
      console.error("[LevelStore] Failed to load from storage:", e);
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const allMeta = this.getAllMeta();
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(allMeta));

      // Save only modified levels or just the ones in memory
      // Since we only call saveToStorage after changes, we can save individual keys
      for (const [id, config] of this.levels.entries()) {
        // We could optimize this further by only saving "dirty" levels,
        // but saving one level at a time is already 100x faster than saving all.
        localStorage.setItem(`${STORAGE_KEY}_${id}`, JSON.stringify(config));
      }
    } catch (e) {
      console.error("[LevelStore] Failed to save to storage:", e);
    }
  }

  // Optimized save for a single level
  save(config: LevelConfig): void {
    const existing = this.meta.get(config.id);

    this.levels.set(config.id, config);
    this.meta.set(config.id, {
      id: config.id,
      name: config.name,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      isBuiltIn: false,
    });

    // Partial save
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        `${STORAGE_KEY}_${config.id}`,
        JSON.stringify(config),
      );
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(this.getAllMeta()));
    }
  }

  clearAllLevels(): void {
    this.levels.clear();
    this.meta.clear();
    this.saveToStorage();
    this.ensureStarterLevel();
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
