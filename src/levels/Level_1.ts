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
      clearColor: [0.01, 0.01, 0.03, 1],
      fogEnabled: true,
      fogColor: [0.01, 0.01, 0.03],
      fogDensity: 0.03,
      pipeline: {
        grain: 50,
        vignette: 20,
        vignetteWeight: 20,
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
        { speaker: "Wife", text: "Where have you been?", duration: 3000 },
        { speaker: "Wife", text: "I was so worried...", duration: 3000 },
        {
          speaker: "Wife",
          text: "Please, don't leave me again.",
          duration: 3500,
        },
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
  }

  public start(): void {}
}
