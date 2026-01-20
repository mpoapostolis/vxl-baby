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

export interface LevelConfig {
  ambientIntensity: number;
  flashlightIntensity: number;
  clearColor: [number, number, number, number];
  fogEnabled: boolean;
  fogColor?: [number, number, number];
  fogDensity?: number;
  pipeline?: {
    grain: number;
    vignette: number;
    vignetteWeight: number;
    chromaticAberration: number;
    contrast: number;
    exposure: number;
  };
  cameraRadius: number;
  cameraBeta: number;
}

export const DEFAULT_CONFIG: LevelConfig = {
  ambientIntensity: 0.5,
  flashlightIntensity: 3,
  clearColor: [0.05, 0.05, 0.1, 1],
  fogEnabled: false,
  cameraRadius: 10,
  cameraBeta: Math.PI / 3,
};

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
    this.config = { ...DEFAULT_CONFIG, ...config };
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
      this.config.cameraRadius,
      Vector3.Zero(),
      this.scene
    );
    this.camera.upperBetaLimit = this.config.cameraBeta;
    this.camera.lowerBetaLimit = this.config.cameraBeta;
    this.camera.upperRadiusLimit = this.config.cameraRadius;
    this.camera.lowerRadiusLimit = this.config.cameraRadius;
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
      this.scene
    );
    this.flashlight.parent = this.camera;
    this.flashlight.intensity = this.config.flashlightIntensity;

    // Shadow Generator
    this.shadowGenerator = new ShadowGenerator(1024, this.flashlight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;

    // Entity Factory
    this.entityFactory = new EntityFactory(this.scene, this.shadowGenerator, this.assetManager);

    // Atmosphere
    this.scene.clearColor = new Color4(...this.config.clearColor);

    if (this.config.fogEnabled && this.config.fogColor) {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogColor = new Color3(...this.config.fogColor);
      this.scene.fogDensity = this.config.fogDensity ?? 0.03;
    }

    // Pipeline
    if (this.config.pipeline) {
      this.pipeline = new DefaultRenderingPipeline("pipeline", true, this.scene, [this.camera]);
      this.pipeline.grainEnabled = this.config.pipeline.grain > 0;
      this.pipeline.grain.intensity = this.config.pipeline.grain;
      this.pipeline.grain.animated = true;

      this.pipeline.chromaticAberrationEnabled = this.config.pipeline.chromaticAberration > 0;
      this.pipeline.chromaticAberration.aberrationAmount = this.config.pipeline.chromaticAberration;

      this.pipeline.imageProcessingEnabled = true;
      this.pipeline.imageProcessing.vignetteEnabled = this.config.pipeline.vignette > 0;
      this.pipeline.imageProcessing.vignetteWeight = this.config.pipeline.vignetteWeight;
      this.pipeline.imageProcessing.contrast = this.config.pipeline.contrast;
      this.pipeline.imageProcessing.exposure = this.config.pipeline.exposure;
    }

    this.inputManager.init(this.scene);

    const playerData = await this.assetManager.loadMesh("/assets/man.glb", this.scene);
    const rootMesh = playerData.meshes[0];
    this.player = new Player(
      rootMesh!,
      playerData.animationGroups,
      this.camera,
      this.shadowGenerator,
      this.scene
    );

    await this.onLoad();
  }

  public setupStaticMeshPhysics(mesh: Mesh): void {
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = new PhysicsShapeMesh(mesh, this.scene);
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
    this.scene?.render();
  }
}
