// removed DialogueConfig import to avoid confusion if we are moving to inline
// import type { DialogueConfig } from "./entities";

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
  itemId?: string; // If type is item
}

export interface NPCReward {
  type: "item" | "energy" | "money";
  value: string | number;
  itemId?: string; // If type is item
}

export interface DialogueLine {
  speaker: string;
  text: string;
  duration?: number;
}

export interface NPCSpawn {
  type: "npc";
  name?: string; // Editor display name
  entity: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  // Extended RPG features
  requirements?: NPCRequirement[];
  rewards?: NPCReward[];
  // Dialogue when requirements NOT met
  failDialogue?: DialogueLine[];
  // Dialogue when requirements ARE met (rewards given after)
  successDialogue?: DialogueLine[];
  animations?: {
    idle?: string;
    interact?: string;
  };
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
    mass: number; // 0 = Static, >0 = Dynamic
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

  // Visual settings
  ambientIntensity: number;
  flashlightIntensity?: number;
  clearColor: [number, number, number, number];
  fogEnabled: boolean;
  fogColor?: [number, number, number];
  fogDensity?: number;
  cameraRadius?: number;
  cameraBeta?: number;
  pipeline?: PipelineConfig;

  // Audio
  music?: string;

  // Environment
  environment: EnvironmentConfig;

  // Entities
  entities: EntitySpawn[];

  // Dialogues
  dialogues?: DialogueConfig[];

  // Triggers
  triggers?: Trigger[];

  // Effects
  // Effects
  effects?: LevelEffect[];
}

export const LEVELS: Record<string, LevelConfig> = {
  level1: {
    id: "level1",
    name: "Home",
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
    music: "level_1",
    environment: {
      asset: "/assets/home.glb",
      scale: 9,
      position: [-2, 0, 0],
    },
    entities: [
      {
        type: "npc",
        entity: "wife",
        position: [-5, -1, 0],
      },
      {
        type: "portal",
        position: [3, 1.5, 3],
        targetLevel: "level2",
      },
    ],
    dialogues: [
      {
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
      },
    ],
    triggers: [
      {
        type: "proximity",
        target: "wife",
        radius: 3,
        once: true,
        actions: [{ type: "playDialogue", value: "wife_intro" }],
      },
    ],
  },

  level2: {
    id: "level2",
    name: "The Void",
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
    music: "level_2",
    environment: {
      asset: "/assets/room-large.glb",
    },
    entities: [
      {
        type: "npc",
        entity: "demon",
        position: [5, 0, 5],
      },
      {
        type: "portal",
        position: [-3, 1.5, -3],
        targetLevel: "level1",
      },
    ],
    dialogues: [
      {
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
      },
    ],
    triggers: [
      {
        type: "proximity",
        target: "demon",
        radius: 4,
        once: true,
        actions: [
          { type: "setSpotlightIntensity", value: 500 },
          { type: "playSound", value: "demon_voice" },
          { type: "playDialogue", value: "demon_intro" },
        ],
      },
    ],
    effects: [
      {
        type: "spotlightOverride",
        intensity: 500,
      },
      {
        type: "flicker",
        target: "flashlight",
        chance: 0.05,
        lowRange: [1.0, 1.5],
        highRange: [2.5, 3.0],
      },
      {
        type: "heartbeatVignette",
        baseWeight: 7,
        amplitude: 3,
        speed: 0.002,
      },
      {
        type: "cameraShake",
        intensity: 0.002,
      },
    ],
  },
};

export const DEFAULT_CONFIG: Partial<LevelConfig> = {
  ambientIntensity: 0.5,
  flashlightIntensity: 3,
  clearColor: [0.05, 0.05, 0.1, 1],
  fogEnabled: false,
  cameraRadius: 10,
  cameraBeta: Math.PI / 3,
};
