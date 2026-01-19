import { Mesh, Vector3 } from "@babylonjs/core";
import { BaseLevel } from "./BaseLevel";
import { Demon } from "../entities/Demon";
import { Portal } from "../entities/Portal";
import { AudioManager } from "../managers/AudioManager";
import { DialogueManager } from "../managers/DialogueManager";

export class Level_2 extends BaseLevel {
  private demon!: Demon;
  private hasInteracted: boolean = false;

  constructor() {
    super({
      ambientIntensity: 0.15,
      flashlightIntensity: 2.5,
      clearColor: [0, 0, 0, 1],
      fogEnabled: true,
      fogColor: [0.02, 0.02, 0.05],
      fogDensity: 0.05,
      pipeline: {
        grain: 500,
        vignette: 500,
        vignetteWeight: 500,
        chromaticAberration: 50,
        contrast: 2.0,
        exposure: 0.8,
      },
    });
  }

  protected async onLoad(): Promise<void> {
    // Sound is now managed by AudioManager
    AudioManager.getInstance().stopAll();
    AudioManager.getInstance().play("level_2");
    const roomData = await this.assetManager.loadMesh(
      "/assets/room-large.glb",
      this.scene,
    );
    roomData.meshes.forEach((m) => {
      m.receiveShadows = true;
      if (m.getTotalVertices() > 0) {
        this.setupStaticMeshPhysics(m as Mesh);
      }
    });

    const demonData = await this.assetManager.loadMesh(
      "/assets/Demon.glb",
      this.scene,
    );
    this.demon = new Demon(
      demonData.meshes,
      demonData.animationGroups,
      this.shadowGenerator,
      new Vector3(5, 0, 5),
      2,
    );

    // Register Dialogue
    const dialogueManager = DialogueManager.getInstance();
    dialogueManager.register({
      id: "demon_intro",
      lines: [
        { speaker: "Demon", text: "The void...", duration: 2500 },
        {
          speaker: "Demon",
          text: "It hungers for you, traveler.",
          duration: 3500,
        },
        {
          speaker: "Demon",
          text: "Your light is but a flickering candle in the eternal dark.",
          duration: 4000,
        },
      ],
    });

    // --- PORTAL ONE-LINER ---
    // Scene, Position, Target Level ID
    this.portal = new Portal(this.scene, new Vector3(-3, 1.5, -3), "level1");
  }

  protected override onUpdate(): void {
    if (this.demon && this.player) {
      this.player.spotLight.intensity = 500;
      const dist = Vector3.Distance(this.player.position, this.demon.position);
      if (dist < 4 && !this.hasInteracted) {
        this.hasInteracted = true;
        AudioManager.getInstance().play("demon_voice");
        DialogueManager.getInstance().play("demon_intro");
      }
    }

    if (Math.random() < 0.05) {
      this.flashlight.intensity = 1.0 + Math.random() * 0.5;
    } else {
      this.flashlight.intensity = 2.5 + Math.random() * 0.5;
    }

    if (this.pipeline) {
      const time = Date.now() * 0.002;
      const heartbeat =
        (Math.sin(time) + Math.sin(time * 2) + Math.sin(time * 0.5)) / 3;
      this.pipeline.imageProcessing.vignetteWeight = 7 + heartbeat * 3;
    }

    this.camera.rotation.x += (Math.random() - 0.5) * 0.002;
    this.camera.rotation.y += (Math.random() - 0.5) * 0.002;
  }

  public start(): void {}
}
