export type EntityType = "npc" | "portal";

export interface NPCConfig {
  type: "npc";
  asset: string;
  scale: number;
  idleAnimation: string | string[];
  castShadow: boolean;
}

export interface PortalConfig {
  type: "portal";
  diameter: number;
  color: [number, number, number];
  lightIntensity: number;
  lightRange: number;
}

export type EntityConfig = NPCConfig | PortalConfig;

export const ENTITIES: Record<string, EntityConfig> = {
  wife: {
    type: "npc",
    asset: "/assets/wife.glb",
    scale: 0.95,
    idleAnimation: ["Idle", "idle"],
    castShadow: true,
  },
  demon: {
    type: "npc",
    asset: "/assets/Demon.glb",
    scale: 2,
    idleAnimation: "CharacterArmature|Idle",
    castShadow: true,
  },
  portal: {
    type: "portal",
    diameter: 1.5,
    color: [0, 0.8, 1],
    lightIntensity: 5,
    lightRange: 10,
  },
} as const;

export interface DialogueLine {
  speaker: string;
  text: string;
  duration: number;
}

export interface DialogueConfig {
  id: string;
  lines: DialogueLine[];
}

export interface SpawnConfig {
  entity: keyof typeof ENTITIES;
  position: [number, number, number];
  scale?: number;
  dialogue?: DialogueConfig;
  interactionRadius?: number;
  onInteract?: {
    playSound?: string;
    playDialogue?: string;
  };
}

export interface PortalSpawnConfig {
  entity: "portal";
  position: [number, number, number];
  targetLevel: string;
}

export function isPortalSpawn(
  config: SpawnConfig | PortalSpawnConfig
): config is PortalSpawnConfig {
  return config.entity === "portal";
}
