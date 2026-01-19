import { Engine } from "../core/Engine";
import type { BaseLevel } from "../levels/BaseLevel";
import { AudioManager } from "./AudioManager";
import { DialogueManager } from "./DialogueManager";

export class LevelManager {
  private static instance: LevelManager;
  private engine: Engine;
  private currentLevel?: BaseLevel;
  private levels: Map<string, () => BaseLevel> = new Map();

  private constructor(engine: Engine) {
    this.engine = engine;
  }

  public static getInstance(engine?: Engine): LevelManager {
    if (!LevelManager.instance) {
      if (!engine) throw new Error("Engine required for first initialization");
      LevelManager.instance = new LevelManager(engine);
    }
    return LevelManager.instance;
  }

  public register(id: string, levelFactory: () => BaseLevel): void {
    this.levels.set(id, levelFactory);
  }

  public async load(id: string): Promise<void> {
    // Stop any active dialogue
    DialogueManager.getInstance().stop();

    // Dispose current level
    if (this.currentLevel) {
      this.currentLevel.dispose();
    }

    // Create new level
    const factory = this.levels.get(id);
    if (!factory) throw new Error(`Level "${id}" not found`);

    this.currentLevel = factory();
    await this.currentLevel.load();
    this.currentLevel.start();
  }

  public getCurrentLevel(): BaseLevel | undefined {
    return this.currentLevel;
  }

  public update(): void {
    this.currentLevel?.update();
  }
}
