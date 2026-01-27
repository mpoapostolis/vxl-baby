import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  HemisphericLight,
  type Mesh,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeMesh,
  Scene,
  ShadowGenerator,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { Engine } from "../../core/Engine";
import { Player } from "../entities/Player";
import type { Portal } from "../entities/Portal";
import { EntityFactory } from "../factories/EntityFactory";
import { AssetManager } from "../../core/AssetManager";
import { InputManager } from "../../core/InputManager";
import { getHavokPlugin } from "../../core/physics";
import { type LevelConfig, DEFAULT_CONFIG } from "../config/levels";
import { DialogueManager } from "../managers/DialogueManager";
import { ANIMATIONS } from "../utils/hero_anim";

// ============================================================================
// CONFIGURATION
// ============================================================================

const PHYSICS = {
  GRAVITY: new Vector3(0, -9.81, 0),
} as const;

const SHADOW = {
  MAP_SIZE: 1024,
  BLUR_KERNEL: 32,
} as const;

const PLAYER_ASSET = "/assets/man.glb";

// ============================================================================
// BASE LEVEL
// ============================================================================

export abstract class BaseLevel {
  // Core systems (protected for subclass access)
  protected readonly engine: Engine;
  protected readonly assetManager: AssetManager;
  protected readonly inputManager: InputManager;
  protected config: LevelConfig;

  // Scene components (public for editor/external access)
  public scene!: Scene;
  public camera!: ArcRotateCamera;
  public light!: HemisphericLight;
  public flashlight!: SpotLight;
  public shadowGenerator!: ShadowGenerator;
  public pipeline?: DefaultRenderingPipeline;
  public player!: Player;
  public portal?: Portal;
  public entityFactory!: EntityFactory;

  constructor(config: Partial<LevelConfig> = {}) {
    this.engine = Engine.getInstance();
    this.assetManager = AssetManager.getInstance();
    this.inputManager = InputManager.getInstance();
    this.config = { ...DEFAULT_CONFIG, ...config } as LevelConfig;
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  public async load(): Promise<void> {
    await this.initializeScene();
    this.setupCamera();
    this.setupLighting();
    this.setupAtmosphere();
    this.setupPipeline();
    this.setupEntityFactory();

    this.inputManager.init(this.scene);
    await this.loadPlayer();
    await this.onLoad();
  }

  public update(): void {
    // Don't move player while dialogue is active - stop and play idle
    if (DialogueManager.getInstance().isDialoguePlaying()) {
      this.player?.stopMovement();
      this.player?.playAnimation(ANIMATIONS.Idle_Neutral);
    } else {
      this.player?.update();
    }
    this.onUpdate();
  }

  public render(): void {
    if (this.scene && this.scene.activeCamera) {
      this.scene.render();
    }
  }

  public dispose(): void {
    this.player?.dispose();
    this.camera?.detachControl();
    this.shadowGenerator?.dispose();
    this.pipeline?.dispose();
    this.scene?.dispose();
  }

  // ==========================================================================
  // ABSTRACT METHODS
  // ==========================================================================

  protected abstract onLoad(): Promise<void>;
  public abstract start(): void;
  protected onUpdate(): void {}

  // ==========================================================================
  // HOT UPDATE (Live editing support)
  // ==========================================================================

  public hotUpdate(config: LevelConfig): void {
    this.config = { ...this.config, ...config };
    this.updateLighting();
    this.updateAtmosphere();
    this.updatePipeline();
    this.updateCamera();
  }

  // ==========================================================================
  // PHYSICS UTILITIES
  // ==========================================================================

  public setupStaticMeshPhysics(mesh: Mesh): void {
    const body = new PhysicsBody(
      mesh,
      PhysicsMotionType.STATIC,
      false,
      this.scene,
    );
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
  }

  // ==========================================================================
  // INITIALIZATION (Private)
  // ==========================================================================

  private async initializeScene(): Promise<void> {
    this.scene = new Scene(this.engine.engine);
    const havokPlugin = await getHavokPlugin();
    this.scene.enablePhysics(PHYSICS.GRAVITY, havokPlugin);
  }

  private setupCamera(): void {
    const { cameraRadius = 10, cameraBeta = Math.PI / 3 } = this.config;

    this.camera = new ArcRotateCamera(
      "camera",
      Math.PI / 2,
      Math.PI / 2,
      cameraRadius,
      Vector3.Zero(),
      this.scene,
    );

    this.camera.upperBetaLimit = cameraBeta;
    this.camera.lowerBetaLimit = cameraBeta;
    this.camera.upperRadiusLimit = cameraRadius;
    this.camera.lowerRadiusLimit = cameraRadius;
    this.camera.attachControl(this.engine.canvas, true);
  }

  private setupLighting(): void {
    // Ambient light
    this.light = new HemisphericLight("ambientLight", Vector3.Up(), this.scene);
    this.light.intensity = this.config.ambientIntensity;

    // Flashlight (attached to camera)
    this.flashlight = new SpotLight(
      "flashlight",
      Vector3.Zero(),
      Vector3.Forward(),
      Math.PI / 4,
      30,
      this.scene,
    );
    this.flashlight.parent = this.camera;
    this.flashlight.intensity = this.config.flashlightIntensity ?? 1.5;

    // Shadows
    this.shadowGenerator = new ShadowGenerator(
      SHADOW.MAP_SIZE,
      this.flashlight,
    );
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = SHADOW.BLUR_KERNEL;
  }

  private setupAtmosphere(): void {
    this.scene.clearColor = new Color4(...this.config.clearColor);

    if (this.config.fogEnabled && this.config.fogColor) {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogColor = new Color3(...this.config.fogColor);
      this.scene.fogDensity = this.config.fogDensity ?? 0.03;
    }
  }

  private setupPipeline(): void {
    const pipelineConfig = this.config.pipeline;
    if (!pipelineConfig) return;

    this.pipeline = new DefaultRenderingPipeline("pipeline", true, this.scene, [
      this.camera,
    ]);

    // Film grain
    this.pipeline.grainEnabled = pipelineConfig.grain > 0;
    this.pipeline.grain.intensity = pipelineConfig.grain;
    this.pipeline.grain.animated = true;

    // Chromatic aberration
    this.pipeline.chromaticAberrationEnabled =
      pipelineConfig.chromaticAberration > 0;
    this.pipeline.chromaticAberration.aberrationAmount =
      pipelineConfig.chromaticAberration;

    // Image processing
    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.vignetteEnabled = pipelineConfig.vignette > 0;
    this.pipeline.imageProcessing.vignetteWeight =
      pipelineConfig.vignetteWeight;
    this.pipeline.imageProcessing.contrast = pipelineConfig.contrast;
    this.pipeline.imageProcessing.exposure = pipelineConfig.exposure;
  }

  private setupEntityFactory(): void {
    this.entityFactory = new EntityFactory(
      this.scene,
      this.shadowGenerator,
      this.assetManager,
    );
  }

  private async loadPlayer(): Promise<void> {
    const playerData = await this.assetManager.loadMesh(
      PLAYER_ASSET,
      this.scene,
    );
    const rootMesh = playerData.meshes[0];

    if (!rootMesh) {
      throw new Error("[BaseLevel] Failed to load player mesh");
    }

    this.player = new Player(
      rootMesh,
      playerData.animationGroups,
      this.camera,
      this.shadowGenerator,
      this.scene,
    );
  }

  // ==========================================================================
  // HOT UPDATE HELPERS (Private)
  // ==========================================================================

  private updateLighting(): void {
    if (this.light) {
      this.light.intensity = this.config.ambientIntensity;
    }
    if (this.flashlight) {
      this.flashlight.intensity = this.config.flashlightIntensity ?? 1.5;
    }
  }

  private updateAtmosphere(): void {
    if (!this.scene) return;

    this.scene.clearColor = new Color4(...this.config.clearColor);

    if (this.config.fogEnabled && this.config.fogColor) {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogColor = new Color3(...this.config.fogColor);
      this.scene.fogDensity = this.config.fogDensity ?? 0.03;
    } else {
      this.scene.fogMode = Scene.FOGMODE_NONE;
    }
  }

  private updatePipeline(): void {
    if (!this.config.pipeline) return;

    // Lazily initialize pipeline if it doesn't exist
    if (!this.pipeline) {
      this.setupPipeline();
      if (!this.pipeline) return;
    }

    const p = this.config.pipeline;

    this.pipeline.grainEnabled = p.grain > 0;
    this.pipeline.grain.intensity = p.grain;

    this.pipeline.chromaticAberrationEnabled = p.chromaticAberration > 0;
    this.pipeline.chromaticAberration.aberrationAmount = p.chromaticAberration;

    this.pipeline.imageProcessing.vignetteEnabled = p.vignette > 0;
    this.pipeline.imageProcessing.vignetteWeight = p.vignette;
    this.pipeline.imageProcessing.contrast = p.contrast;
    this.pipeline.imageProcessing.exposure = p.exposure;
  }

  private updateCamera(): void {
    if (!this.camera) return;

    const { cameraRadius = 10, cameraBeta = Math.PI / 3 } = this.config;

    this.camera.upperBetaLimit = cameraBeta;
    this.camera.lowerBetaLimit = cameraBeta;
    this.camera.upperRadiusLimit = cameraRadius;
    this.camera.lowerRadiusLimit = cameraRadius;
  }
}
