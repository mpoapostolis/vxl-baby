import {
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  MeshBuilder,
  Mesh,
} from "@babylonjs/core";
import { BaseLevel } from "./BaseLevel";
import { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { Wife } from "../entities/Wife";
import { DialogueManager } from "../managers/DialogueManager";

export class Level_1 extends BaseLevel {
  private wife!: Wife;
  private hasInteracted: boolean = false;

  constructor() {
    super({
      ambientIntensity: 0.4,
      flashlightIntensity: 1,
      clearColor: [0.01, 0.01, 0.03, 1],
      fogEnabled: true,
      fogColor: [0.01, 0.01, 0.03],
      fogDensity: 0.03,
      pipeline: {
        grain: 1,
        vignette: 0,
        vignetteWeight: 1,
        chromaticAberration: 2,
        contrast: 1.4,
        exposure: 1.0,
      },
    });
  }

  protected async onLoad(): Promise<void> {
    const apartmentData = await this.assetManager.loadMesh(
      "/assets/home.glb",
      this.scene,
    );
    AudioManager.getInstance().stopAll();
    AudioManager.getInstance().play("level_1");

    // Scale FIRST
    const rootMesh = apartmentData.meshes[0];
    rootMesh?.scaling.setAll(9);
    rootMesh?.position.set(-2, 0, 0);

    // Force compute world matrices after scaling
    rootMesh?.computeWorldMatrix(true);
    apartmentData.meshes.forEach((m) => {
      m.receiveShadows = true;
      m.computeWorldMatrix(true);
    });

    // THEN add physics (after transforms are baked)
    apartmentData.meshes?.forEach((m) => {
      if (m.getTotalVertices() > 0) {
        this.setupStaticMeshPhysics(m as Mesh);
      }
    });

    // --- PORTAL ONE-LINER ---
    // Scene, Position, Target Level ID
    this.portal = new Portal(this.scene, new Vector3(3, 1.5, 3), "level2");

    // Load Wife
    const wifeData = await this.assetManager.loadMesh(
      "/assets/wife.glb",
      this.scene,
    );
    this.wife = new Wife(
      wifeData.meshes,
      wifeData.animationGroups,
      this.shadowGenerator,
      new Vector3(-5, -1, -0), // Adjust position as needed
      0.95,
    );

    // Register Wife Dialogue
    const dialogueManager = DialogueManager.getInstance();
    dialogueManager.register({
      id: "wife_intro",
      lines: [
        { text: "Where have you been?", duration: 3000 },
        { text: "I was so worried...", duration: 3000 },
        { text: "Please, don't leave me again.", duration: 3500 },
      ],
    });
  }

  protected override onUpdate(): void {
    if (this.wife && this.player) {
      const dist = Vector3.Distance(this.player.position, this.wife.position);
      if (dist < 3 && !this.hasInteracted) {
        this.hasInteracted = true;
        DialogueManager.getInstance().play("wife_intro");
      }
    }

    if (Math.random() < 0.03) {
      this.flashlight.intensity = 2 + Math.random() * 0.5;
    } else {
      this.flashlight.intensity = 3 + Math.random() * 0.3;
    }

    if (this.pipeline) {
      const time = Date.now() * 0.001;
      this.pipeline.imageProcessing.vignetteWeight = 3 + Math.sin(time) * 0.5;
    }

    this.camera.rotation.x += (Math.random() - 0.5) * 0.001;
    this.camera.rotation.y += (Math.random() - 0.5) * 0.001;
  }

  public start(): void {}
}
