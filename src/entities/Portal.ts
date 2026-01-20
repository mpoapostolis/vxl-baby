import {
  ActionManager,
  Color3,
  ExecuteCodeAction,
  MeshBuilder,
  PointLight,
  type Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
} from "@babylonjs/core";
import { AudioManager } from "../managers/AudioManager";
import { LevelManager } from "../managers/LevelManager";

export class Portal {
  public mesh: TransformNode;

  constructor(scene: Scene, position: Vector3, targetLevelId: string) {
    // 1. Create the Sphere
    const orb = MeshBuilder.CreateSphere("portalOrb", { diameter: 1.5 }, scene);
    orb.position = position;
    this.mesh = orb;

    // 2. Create Glowing Material
    const mat = new StandardMaterial("orbMat", scene);
    mat.emissiveColor = new Color3(0, 0.8, 1);
    mat.alpha = 0.8;
    orb.material = mat;

    // 3. Create Light
    const orbLight = new PointLight("orbLight", Vector3.Zero(), scene);
    orbLight.parent = orb;
    orbLight.diffuse = new Color3(0, 0.8, 1);
    orbLight.intensity = 5;
    orbLight.range = 10;

    // 4. Handle Interaction (Click to load level)
    orb.actionManager = new ActionManager(scene);
    orb.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        const levelManager = LevelManager.getInstance();
        levelManager.load(targetLevelId);
        AudioManager.getInstance().play("teleport");
      })
    );

    // 5. Self-contained Animation (Float & Rotate)
    const startY = position.y;
    const observer = scene.onBeforeRenderObservable.add(() => {
      // Rotate
      orb.rotation.y += 0.02;
      // Float
      orb.position.y = startY + Math.sin(Date.now() * 0.003) * 0.3;
    });

    // Cleanup observer when mesh is disposed (level unload)
    orb.onDisposeObservable.add(() => {
      scene.onBeforeRenderObservable.remove(observer);
    });
  }
}
