import {
  type AbstractMesh,
  type AnimationGroup,
  type ArcRotateCamera,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  type Scene,
  type ShadowGenerator,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { ANIMATIONS } from "../hero_anim";
import { InputManager } from "../managers/InputManager";

export class Player {
  public mesh: AbstractMesh;
  public anims: Map<string, AnimationGroup>;
  public spotLight: SpotLight;
  public capsule: AbstractMesh;
  public physicsAggregate: PhysicsAggregate;

  private input: InputManager;
  private camera: ArcRotateCamera;
  private moveSpeed = 5;

  constructor(
    mesh: AbstractMesh,
    animationGroups: AnimationGroup[],
    camera: ArcRotateCamera,
    shadowGenerator: ShadowGenerator,
    scene: Scene
  ) {
    this.mesh = mesh;
    this.camera = camera;
    this.input = InputManager.getInstance();

    // Create physics capsule
    this.capsule = MeshBuilder.CreateCapsule("playerCapsule", { height: 2, radius: 0.25 }, scene);
    this.capsule.position = new Vector3(0, 1, 0);
    this.capsule.isVisible = false;
    this.capsule.visibility = 0.4;

    // Parent the visual mesh to the capsule
    this.mesh.parent = this.capsule;
    this.mesh.position.y = -1;

    // Create physics aggregate for the capsule
    this.physicsAggregate = new PhysicsAggregate(
      this.capsule,
      PhysicsShapeType.CAPSULE,
      { mass: 1, friction: 0.5, restitution: 0 },
      scene
    );

    // Lock rotation so capsule stays upright
    this.physicsAggregate.body.setMassProperties({
      inertia: new Vector3(0, 0, 0),
    });

    // Setup animations
    this.anims = new Map<string, AnimationGroup>(animationGroups.map((ag) => [ag.name, ag]));
    scene.stopAllAnimations();

    // Add shadow caster
    shadowGenerator.addShadowCaster(mesh);

    // Player spotlight
    this.spotLight = new SpotLight(
      "flashlight",
      Vector3.Zero(),
      Vector3.Forward(),
      Math.PI / 2,
      10_000,
      scene
    );
    this.spotLight.position.y = 2;
    this.spotLight.parent = this.mesh;

    // Start idle
    const idleAnim = this.anims.get(ANIMATIONS.Idle_Neutral);
    idleAnim?.play(true);
  }

  public update(): void {
    const dirForward = this.camera.getDirection(Vector3.Forward());
    const dirRight = this.camera.getDirection(Vector3.Right());
    dirForward.y = 0;
    dirRight.y = 0;
    dirRight.normalize();
    dirForward.normalize();
    const moveVec = Vector3.Zero();
    let isMoving = false;

    if (this.input.isKeyDown("KeyW")) {
      moveVec.addInPlace(dirForward);
      isMoving = true;
    }

    if (this.input.isKeyDown("KeyS")) {
      moveVec.subtractInPlace(dirForward);
      isMoving = true;
    }
    if (this.input.isKeyDown("KeyA")) {
      moveVec.subtractInPlace(dirRight);
      isMoving = true;
    }
    if (this.input.isKeyDown("KeyD")) {
      moveVec.addInPlace(dirRight);
      isMoving = true;
    }

    // Get current vertical velocity to preserve gravity
    const currentVelocity = this.physicsAggregate.body.getLinearVelocity();

    if (isMoving) {
      moveVec.normalize();
      moveVec.y = 0;
      // Set horizontal velocity while preserving vertical (gravity)
      this.physicsAggregate.body.setLinearVelocity(
        new Vector3(moveVec.x * this.moveSpeed, currentVelocity.y, moveVec.z * this.moveSpeed)
      );

      let animToPlay = ANIMATIONS.Run;
      if (this.input.isKeyDown("KeyS")) animToPlay = ANIMATIONS.Run_Back;
      else if (this.input.isKeyDown("KeyW")) animToPlay = ANIMATIONS.Run;
      else if (this.input.isKeyDown("KeyA")) animToPlay = ANIMATIONS.Run_Left;
      else if (this.input.isKeyDown("KeyD")) animToPlay = ANIMATIONS.Run_Right;

      const anim = this.anims.get(animToPlay);
      if (anim && !anim.isPlaying) {
        this.anims.forEach((a) => a.stop());
        anim.play(true);
      }
    } else {
      // Stop horizontal movement but keep vertical velocity
      this.physicsAggregate.body.setLinearVelocity(new Vector3(0, currentVelocity.y, 0));

      const idle = this.anims.get(ANIMATIONS.Idle_Neutral);
      if (idle && !idle.isPlaying) {
        this.anims.forEach((a) => a.stop());
        idle.play(true);
      }
    }

    const dirForward1 = dirForward.scale(-2);
    dirForward1.y = -Math.PI / 3;
    this.mesh.lookAt(dirForward1);
    // Camera follows the capsule
    this.camera.setTarget(this.capsule.position);
  }

  public get position(): Vector3 {
    return this.capsule.position;
  }
}
