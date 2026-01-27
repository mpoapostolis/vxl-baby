import type { DialogueConfig } from "./entities";

export interface PipelineConfig {
  grain: number;
  vignette: number;
  vignetteWeight: number;
  chromaticAberration: number;
  contrast: number;
  exposure: number;
}

export interface EnvironmentConfig {
  asset: string;
  scale?: number;
  position?: [number, number, number];
}

export interface NPCRequirement {
  type: "item" | "level" | "energy" | "money";
  value: string | number;
  itemId?: string;
}

export interface NPCReward {
  type: "item" | "energy" | "money";
  value: string | number;
  itemId?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
}

// Quest Graph Types (LiteGraph format)
export interface QuestGraphLink {
  0: number; // link id
  1: number; // origin node id
  2: number; // origin slot index
  3: number; // target node id
  4: number; // target slot index
  5?: string; // type
}

export interface QuestGraphNodeOutput {
  name: string;
  type?: string;
  links?: number[];
}

export interface QuestGraphNodeInput {
  name: string;
  type?: string;
  link?: number;
}

export interface QuestGraphNode {
  id: number;
  type: string;
  pos?: [number, number];
  size?: [number, number];
  properties?: Record<string, unknown>;
  widgets_values?: unknown[];
  inputs?: QuestGraphNodeInput[];
  outputs?: QuestGraphNodeOutput[];
}

export interface QuestGraph {
  nodes: QuestGraphNode[];
  links: QuestGraphLink[];
}

export interface NPCSpawn {
  type: "npc";
  name?: string;
  entity?: string;
  asset?: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  requirements?: NPCRequirement[];
  rewards?: NPCReward[];
  failDialogue?: DialogueLine[];
  successDialogue?: DialogueLine[];
  animations?: {
    idle?: string;
    interact?: string;
  };
  questGraph?: QuestGraph;
}

export interface PortalSpawn {
  type: "portal";
  name?: string;
  position: [number, number, number];
  targetLevel: string;
}

export interface PropSpawn {
  type: "prop";
  asset: string;
  name?: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scaling?: [number, number, number];
  physics?: {
    enabled: boolean;
    mass: number;
    impostor: "box" | "sphere" | "mesh" | "capsule";
  };
}

export type EntitySpawn = NPCSpawn | PortalSpawn | PropSpawn;

export interface ProximityTrigger {
  type: "proximity";
  target: string;
  radius: number;
  once: boolean;
  actions: TriggerAction[];
}

export type Trigger = ProximityTrigger;

export interface TriggerAction {
  type: "playDialogue" | "playSound" | "setSpotlightIntensity";
  value: string | number;
}

export interface FlickerEffect {
  type: "flicker";
  target: "flashlight";
  chance: number;
  lowRange: [number, number];
  highRange: [number, number];
}

export interface CameraShakeEffect {
  type: "cameraShake";
  intensity: number;
}

export interface HeartbeatVignetteEffect {
  type: "heartbeatVignette";
  baseWeight: number;
  amplitude: number;
  speed: number;
}

export interface SpotlightOverride {
  type: "spotlightOverride";
  intensity: number;
}

export type LevelEffect =
  | FlickerEffect
  | CameraShakeEffect
  | HeartbeatVignetteEffect
  | SpotlightOverride;

export interface LevelConfig {
  id: string;
  name: string;
  ambientIntensity: number;
  flashlightIntensity?: number;
  clearColor: [number, number, number, number];
  fogEnabled: boolean;
  fogColor?: [number, number, number];
  fogDensity?: number;
  cameraRadius?: number;
  cameraBeta?: number;
  pipeline?: PipelineConfig;
  music?: string;
  environment: EnvironmentConfig;
  entities: EntitySpawn[];
  dialogues?: DialogueConfig[];
  triggers?: Trigger[];
  effects?: LevelEffect[];
}

export const DEFAULT_CONFIG: LevelConfig = {
  id: "default",
  name: "New Level",
  ambientIntensity: 0.5,
  flashlightIntensity: 3,
  clearColor: [0.05, 0.05, 0.1, 1],
  fogEnabled: false,
  cameraRadius: 10,
  cameraBeta: Math.PI / 3,
  environment: {
    asset: "/assets/room-large.glb",
    scale: 1,
  },
  entities: [],
};
