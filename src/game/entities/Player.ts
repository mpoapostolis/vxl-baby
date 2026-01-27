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
import { ANIMATIONS } from "../utils/hero_anim";
import { InputManager } from "../../core/InputManager";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MOVE_SPEED: 5,
  CAPSULE_HEIGHT: 2,
  CAPSULE_RADIUS: 0.25,
  SPOTLIGHT_ANGLE: Math.PI / 2,
  SPOTLIGHT_EXPONENT: 10_000,
  SPOTLIGHT_HEIGHT: 2,
  MESH_OFFSET_Y: -1,
  INITIAL_POSITION_Y: 1,
  LOOK_ANGLE: -Math.PI / 3,
} as const;

// Pre-allocated direction references (module-level, never mutated)
const FORWARD_REF = Vector3.Forward();
const RIGHT_REF = Vector3.Right();

// ============================================================================
// TYPES
// ============================================================================

interface MovementInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

// ============================================================================
// PLAYER CLASS
// ============================================================================

export class Player {
  // Public readonly references
  readonly mesh: AbstractMesh;
  readonly capsule: AbstractMesh;
  readonly spotLight: SpotLight;

  // Private state
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly input: InputManager;
  private readonly animations: Map<string, AnimationGroup>;
  private physicsAggregate: PhysicsAggregate | null;
  private currentAnimation: string | null = null;
  private isDisposed = false;
  private physicsEnabled = true;

  // Reusable vectors (zero allocations during update)
  private readonly moveDirection = Vector3.Zero();
  private readonly velocity = Vector3.Zero();
  private readonly lookTarget = Vector3.Zero();
  private readonly forward = Vector3.Zero();
  private readonly right = Vector3.Zero();

  constructor(
    mesh: AbstractMesh,
    animationGroups: AnimationGroup[],
    camera: ArcRotateCamera,
    shadowGenerator: ShadowGenerator,
    scene: Scene,
  ) {
    this.mesh = mesh;
    this.camera = camera;
    this.scene = scene;
    this.input = InputManager.getInstance();
    this.animations = new Map(animationGroups.map((ag) => [ag.name, ag]));

    this.capsule = this.createCapsule(scene);
    this.physicsAggregate = this.createPhysics(scene);
    this.spotLight = this.createSpotLight(scene);

    this.setupMeshHierarchy();
    shadowGenerator.addShadowCaster(mesh);
    scene.stopAllAnimations();
    this.playAnimation(ANIMATIONS.Idle_Neutral);
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  get position(): Vector3 {
    return this.capsule.position;
  }

  update(): void {
    if (this.isDisposed) return;

    this.updateDirectionVectors();
    const input = this.getMovementInput();
    const isMoving =
      input.forward || input.backward || input.left || input.right;

    this.calculateMoveDirection(input);

    if (this.physicsEnabled) {
      this.updateWithPhysics(isMoving);
    } else {
      this.updateWithoutPhysics(isMoving);
    }

    this.updateAnimation(isMoving, input);
    this.updateLookDirection();
    this.camera.setTarget(this.capsule.position);
  }

  disablePhysics(): void {
    if (this.physicsAggregate) {
      this.physicsAggregate.dispose();
      this.physicsAggregate = null;
    }
    this.physicsEnabled = false;
  }

  stopMovement(): void {
    if (this.physicsAggregate) {
      const currentY = this.physicsAggregate.body.getLinearVelocity().y;
      this.physicsAggregate.body.setLinearVelocity(new Vector3(0, currentY, 0));
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.stopAllAnimations();
    this.spotLight.dispose();
    this.physicsAggregate?.dispose();
    this.capsule.dispose();
    this.mesh.dispose();
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  private createCapsule(scene: Scene): AbstractMesh {
    const capsule = MeshBuilder.CreateCapsule(
      "playerCapsule",
      { height: CONFIG.CAPSULE_HEIGHT, radius: CONFIG.CAPSULE_RADIUS },
      scene,
    );
    capsule.position.y = CONFIG.INITIAL_POSITION_Y;
    capsule.isVisible = false;
    return capsule;
  }

  private createPhysics(scene: Scene): PhysicsAggregate {
    const aggregate = new PhysicsAggregate(
      this.capsule,
      PhysicsShapeType.CAPSULE,
      { mass: 1, friction: 0.5, restitution: 0 },
      scene,
    );
    aggregate.body.setMassProperties({ inertia: Vector3.Zero() });
    return aggregate;
  }

  private createSpotLight(scene: Scene): SpotLight {
    const light = new SpotLight(
      "playerLight",
      Vector3.Zero(),
      Vector3.Forward(),
      CONFIG.SPOTLIGHT_ANGLE,
      CONFIG.SPOTLIGHT_EXPONENT,
      scene,
    );
    light.position.y = CONFIG.SPOTLIGHT_HEIGHT;
    light.parent = this.mesh;
    return light;
  }

  private setupMeshHierarchy(): void {
    this.mesh.parent = this.capsule;
    this.mesh.position.y = CONFIG.MESH_OFFSET_Y;
  }

  // ==========================================================================
  // MOVEMENT
  // ==========================================================================

  private getMovementInput(): MovementInput {
    return {
      forward: this.input.isKeyDown("KeyW"),
      backward: this.input.isKeyDown("KeyS"),
      left: this.input.isKeyDown("KeyA"),
      right: this.input.isKeyDown("KeyD"),
    };
  }

  private updateDirectionVectors(): void {
    this.camera.getDirectionToRef(FORWARD_REF, this.forward);
    this.camera.getDirectionToRef(RIGHT_REF, this.right);
    this.forward.y = 0;
    this.right.y = 0;
    this.forward.normalize();
    this.right.normalize();
  }

  private calculateMoveDirection(input: MovementInput): void {
    this.moveDirection.setAll(0);

    if (input.forward) this.moveDirection.addInPlace(this.forward);
    if (input.backward) this.moveDirection.subtractInPlace(this.forward);
    if (input.left) this.moveDirection.subtractInPlace(this.right);
    if (input.right) this.moveDirection.addInPlace(this.right);

    if (this.moveDirection.lengthSquared() > 0) {
      this.moveDirection.normalize();
    }
  }

  private updateWithPhysics(isMoving: boolean): void {
    if (!this.physicsAggregate) return;

    const currentY = this.physicsAggregate.body.getLinearVelocity().y;

    if (isMoving) {
      this.velocity.set(
        this.moveDirection.x * CONFIG.MOVE_SPEED,
        currentY,
        this.moveDirection.z * CONFIG.MOVE_SPEED,
      );
    } else {
      this.velocity.set(0, currentY, 0);
    }

    this.physicsAggregate.body.setLinearVelocity(this.velocity);
  }

  private updateWithoutPhysics(isMoving: boolean): void {
    if (!isMoving) return;

    const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
    const movement = this.moveDirection.scale(CONFIG.MOVE_SPEED * deltaTime);
    this.capsule.position.addInPlace(movement);
  }

  private updateLookDirection(): void {
    this.lookTarget.copyFrom(this.forward).scaleInPlace(-2);
    this.lookTarget.y = CONFIG.LOOK_ANGLE;
    this.mesh.lookAt(this.lookTarget);
  }

  // ==========================================================================
  // ANIMATION
  // ==========================================================================

  private updateAnimation(isMoving: boolean, input: MovementInput): void {
    if (!isMoving) {
      this.playAnimation(ANIMATIONS.Idle_Neutral);
      return;
    }

    const animation = this.selectMovementAnimation(input);
    this.playAnimation(animation);
  }

  private selectMovementAnimation(input: MovementInput): string {
    if (input.backward) return ANIMATIONS.Run_Back;
    if (input.left) return ANIMATIONS.Run_Left;
    if (input.right) return ANIMATIONS.Run_Right;
    return ANIMATIONS.Run;
  }

  public playAnimation(name: string): void {
    if (this.currentAnimation === name) return;

    const animation = this.animations.get(name);
    if (!animation) return;

    if (this.currentAnimation) {
      this.animations.get(this.currentAnimation)?.stop();
    }

    animation.play(true);
    this.currentAnimation = name;
  }

  private stopAllAnimations(): void {
    for (const animation of this.animations.values()) {
      animation.stop();
    }
  }
}
