/**
 * LevelManager - Handles level lifecycle and transitions
 * Supports: dynamic loading from LevelStore, custom factories, hot-reload
 */

import type { BaseLevel } from "../levels/BaseLevel";
import { Level } from "../levels/Level";
import { DialogueManager } from "./DialogueManager";
import { InputManager } from "./InputManager";
import { LevelStore, type LevelMeta } from "./LevelStore";
import type { LevelConfig } from "../config/levels";

export class LevelManager {
  private static instance: LevelManager;

  private currentLevel?: BaseLevel;
  private currentLevelId?: string;
  private customFactories = new Map<string, () => BaseLevel>();
  private store: LevelStore;

  private constructor() {
    this.store = LevelStore.getInstance();
  }

  static getInstance(): LevelManager {
    return (LevelManager.instance ??= new LevelManager());
  }

  // ==================== REGISTRATION ====================

  /** Register a custom factory (for editor, special levels) */
  register(id: string, factory: () => BaseLevel): void {
    this.customFactories.set(id, factory);
  }

  unregister(id: string): void {
    this.customFactories.delete(id);
  }

  // ==================== LEVEL LOADING ====================

  async load(id: string): Promise<void> {
    this.cleanup();

    // Try custom factory first (editor mode)
    const factory = this.customFactories.get(id);
    if (factory) {
      this.currentLevel = factory();
      this.currentLevelId = id;
      await this.currentLevel.load();
      this.currentLevel.start();
      return;
    }

    // Load from store (always fresh)
    const config = this.store.get(id);
    if (!config) {
      throw new Error(`Level "${id}" not found`);
    }

    this.currentLevel = new Level(config);
    this.currentLevelId = id;
    await this.currentLevel.load();
    this.currentLevel.start();
  }

  async loadConfig(config: LevelConfig): Promise<void> {
    this.cleanup();

    this.currentLevel = new Level(config);
    this.currentLevelId = config.id;
    await this.currentLevel.load();
    this.currentLevel.start();
  }

  async reload(): Promise<void> {
    if (this.currentLevelId) {
      await this.load(this.currentLevelId);
    }
  }

  private cleanup(): void {
    DialogueManager.getInstance().stop();
    InputManager.getInstance().dispose();

    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = undefined;
    }
  }

  // ==================== GETTERS ====================

  getCurrentLevel(): BaseLevel | undefined {
    return this.currentLevel;
  }

  getCurrentLevelId(): string | undefined {
    return this.currentLevelId;
  }

  getAvailableLevels(): LevelMeta[] {
    return this.store.getAllMeta();
  }

  getLevelConfig(id: string): LevelConfig | undefined {
    return this.store.get(id);
  }

  // ==================== STORE PROXY ====================

  createLevel(name: string): LevelConfig {
    return this.store.create(name);
  }

  saveLevel(config: LevelConfig): void {
    this.store.save(config);
  }

  deleteLevel(id: string): boolean {
    return this.store.delete(id);
  }

  duplicateLevel(id: string): LevelConfig | undefined {
    return this.store.duplicate(id);
  }

  exportLevel(id: string): string | undefined {
    return this.store.exportToJson(id);
  }

  importLevel(json: string): LevelConfig | undefined {
    return this.store.importFromJson(json);
  }

  // ==================== UPDATE LOOP ====================

  update(): void {
    this.currentLevel?.update();
  }
}
