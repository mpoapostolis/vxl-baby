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
import { Engine } from "../core/Engine";
import { Player } from "../entities/Player";
import type { Portal } from "../entities/Portal";
import { EntityFactory } from "../factories/EntityFactory";
import { AssetManager } from "../managers/AssetManager";
import { InputManager } from "../managers/InputManager";
import { getHavokPlugin } from "../physics";
import {
  type LevelConfig,
  DEFAULT_CONFIG as SHARED_DEFAULT_CONFIG,
} from "../config/levels";

export abstract class BaseLevel {
  protected engine: Engine;
  protected assetManager: AssetManager;
  protected inputManager: InputManager;

  public scene!: Scene;
  public camera!: ArcRotateCamera;
  public light!: HemisphericLight;
  public flashlight!: SpotLight;
  public shadowGenerator!: ShadowGenerator;
  public pipeline?: DefaultRenderingPipeline;
  public player!: Player;

  // Added generic portal reference
  public portal?: Portal;
  public entityFactory!: EntityFactory;

  protected config: LevelConfig;

  constructor(config: Partial<LevelConfig> = {}) {
    this.engine = Engine.getInstance();
    this.assetManager = AssetManager.getInstance();
    this.inputManager = InputManager.getInstance();
    this.config = { ...SHARED_DEFAULT_CONFIG, ...config } as LevelConfig;
  }

  public async load(): Promise<void> {
    this.scene = new Scene(this.engine.engine);

    const havokPlugin = await getHavokPlugin();
    this.scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
    // Camera setup
    this.camera = new ArcRotateCamera(
      "camera",
      Math.PI / 2,
      Math.PI / 2,
      this.config.cameraRadius ?? 10,
      Vector3.Zero(),
      this.scene,
    );
    this.camera.upperBetaLimit = this.config.cameraBeta ?? Math.PI / 3;
    this.camera.lowerBetaLimit = this.config.cameraBeta ?? Math.PI / 3;
    this.camera.upperRadiusLimit = this.config.cameraRadius ?? 10;
    this.camera.lowerRadiusLimit = this.config.cameraRadius ?? 10;
    this.camera.attachControl(this.engine.canvas, true);

    // Lighting setup
    this.light = new HemisphericLight("light", Vector3.Up(), this.scene);
    this.light.intensity = this.config.ambientIntensity;

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

    // Shadow Generator
    this.shadowGenerator = new ShadowGenerator(1024, this.flashlight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;

    // Entity Factory
    this.entityFactory = new EntityFactory(
      this.scene,
      this.shadowGenerator,
      this.assetManager,
    );

    // Atmosphere
    this.scene.clearColor = new Color4(...this.config.clearColor);

    if (this.config.fogEnabled && this.config.fogColor) {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogColor = new Color3(...this.config.fogColor);
      this.scene.fogDensity = this.config.fogDensity ?? 0.03;
    }

    // Pipeline
    if (this.config.pipeline) {
      this.pipeline = new DefaultRenderingPipeline(
        "pipeline",
        true,
        this.scene,
        [this.camera],
      );
      this.pipeline.grainEnabled = this.config.pipeline.grain > 0;
      this.pipeline.grain.intensity = this.config.pipeline.grain;
      this.pipeline.grain.animated = true;

      this.pipeline.chromaticAberrationEnabled =
        this.config.pipeline.chromaticAberration > 0;
      this.pipeline.chromaticAberration.aberrationAmount =
        this.config.pipeline.chromaticAberration;

      this.pipeline.imageProcessingEnabled = true;
      this.pipeline.imageProcessing.vignetteEnabled =
        this.config.pipeline.vignette > 0;
      this.pipeline.imageProcessing.vignetteWeight =
        this.config.pipeline.vignetteWeight;
      this.pipeline.imageProcessing.contrast = this.config.pipeline.contrast;
      this.pipeline.imageProcessing.exposure = this.config.pipeline.exposure;
    }

    this.inputManager.init(this.scene);

    const playerData = await this.assetManager.loadMesh(
      "/assets/man.glb",
      this.scene,
    );
    const rootMesh = playerData.meshes[0];
    this.player = new Player(
      rootMesh!,
      playerData.animationGroups,
      this.camera,
      this.shadowGenerator,
      this.scene,
    );

    await this.onLoad();
  }

  public setupStaticMeshPhysics(mesh: Mesh): void {
    const body = new PhysicsBody(
      mesh,
      PhysicsMotionType.STATIC,
      false,
      this.scene,
    );
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
  }

  public hotUpdate(config: LevelConfig): void {
    this.config = { ...this.config, ...config };

    // Update Ambient Light
    if (this.light) {
      this.light.intensity = this.config.ambientIntensity;
    }

    // Update Flashlight
    if (this.flashlight) {
      this.flashlight.intensity = this.config.flashlightIntensity ?? 1.5;
    }

    // Update Clear Color
    if (this.scene) {
      this.scene.clearColor = new Color4(...this.config.clearColor);
    }

    // Update Fog
    if (this.scene) {
      if (this.config.fogEnabled && this.config.fogColor) {
        this.scene.fogMode = Scene.FOGMODE_EXP2;
        this.scene.fogColor = new Color3(...this.config.fogColor);
        if (this.config.fogDensity !== undefined) {
          this.scene.fogDensity = this.config.fogDensity;
        }
      } else {
        this.scene.fogMode = Scene.FOGMODE_NONE;
      }
    }

    // Update Pipeline
    if (this.pipeline && this.config.pipeline) {
      this.pipeline.grainEnabled = this.config.pipeline.grain > 0;
      this.pipeline.grain.intensity = this.config.pipeline.grain;

      this.pipeline.imageProcessing.vignetteEnabled =
        this.config.pipeline.vignette > 0;
      this.pipeline.imageProcessing.vignetteWeight =
        this.config.pipeline.vignette;

      this.pipeline.chromaticAberrationEnabled =
        this.config.pipeline.chromaticAberration > 0;
      this.pipeline.chromaticAberration.aberrationAmount =
        this.config.pipeline.chromaticAberration;

      this.pipeline.imageProcessing.contrast = this.config.pipeline.contrast;
      this.pipeline.imageProcessing.exposure = this.config.pipeline.exposure;
    }

    // Update Camera limits
    if (this.camera) {
      this.camera.upperBetaLimit = this.config.cameraBeta ?? Math.PI / 3;
      this.camera.lowerBetaLimit = this.config.cameraBeta ?? Math.PI / 3;
      this.camera.upperRadiusLimit = this.config.cameraRadius ?? 10;
      this.camera.lowerRadiusLimit = this.config.cameraRadius ?? 10;
    }
  }

  protected abstract onLoad(): Promise<void>;
  public abstract start(): void;

  public update(): void {
    if (!this.player) return;
    this.player.update();
    this.onUpdate();
  }

  protected onUpdate(): void {}

  public dispose(): void {
    this.scene?.dispose();
  }

  public render(): void {
    if (!this.scene || !this.camera) return;
    this.scene.render();
  }
}
