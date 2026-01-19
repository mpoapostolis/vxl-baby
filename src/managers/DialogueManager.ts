export interface DialogueLine {
  speaker?: string;
  text: string;
  duration?: number;
  sound?: string;
}

export interface Dialogue {
  id: string;
  lines: DialogueLine[];
}

import { AudioManager } from "./AudioManager";

export class DialogueManager {
  private static instance: DialogueManager;
  private dialogues: Map<string, Dialogue> = new Map();
  private currentDialogue?: Dialogue;
  private currentLineIndex: number = 0;
  private isPlaying: boolean = false;
  private timeoutId?: number;

  public onLineStart?: (line: DialogueLine) => void;
  public onLineEnd?: () => void;
  public onDialogueEnd?: () => void;

  private overlay: HTMLElement | null = null;
  private textElement: HTMLElement | null = null;
  private typeIntervalId?: number;

  private constructor() {
    this.createOverlay();
  }

  public static getInstance(): DialogueManager {
    if (!DialogueManager.instance) {
      DialogueManager.instance = new DialogueManager();
    }
    return DialogueManager.instance;
  }

  private createOverlay(): void {
    if (typeof document === "undefined") return;

    this.overlay = document.createElement("div");
    this.overlay.id = "dialogue-overlay";
    this.overlay.className =
      "fixed bottom-12 left-1/2 transform -translate-x-1/2 w-[90%] max-w-3xl bg-black/90 border-t-2 border-b-2 border-red-900/60 text-white p-8 rounded-sm shadow-2xl pointer-events-none opacity-0 transition-all duration-500 z-50 backdrop-blur-md flex flex-col items-center gap-4";

    // Speaker Label
    const speakerLabel = document.createElement("span");
    speakerLabel.className =
      "text-red-500 font-bold uppercase tracking-[0.2em] text-sm mb-2 opacity-80";
    speakerLabel.textContent = "UNKNOWN ENTITY"; // Default, could be dynamic
    this.overlay.appendChild(speakerLabel);

    this.textElement = document.createElement("p");
    this.textElement.className =
      "text-2xl font-serif tracking-wide text-center text-gray-200 min-h-[1.5em] leading-relaxed drop-shadow-md";

    // Add cursor style
    const style = document.createElement("style");
    style.textContent = `
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      .cursor::after { content: ''; display: inline-block; width: 0.6em; height: 1.2em; background: #ef4444; margin-left: 4px; vertical-align: middle; animation: blink 1s step-end infinite; }
    `;
    document.head.appendChild(style);

    this.overlay.appendChild(this.textElement);
    document.body.appendChild(this.overlay);
  }

  public register(dialogue: Dialogue): void {
    this.dialogues.set(dialogue.id, dialogue);
  }

  public play(id: string): void {
    const dialogue = this.dialogues.get(id);
    if (!dialogue) return;

    this.currentDialogue = dialogue;
    this.currentLineIndex = 0;
    this.isPlaying = true;

    // Show overlay
    if (this.overlay) {
      this.overlay.classList.remove("opacity-0");
      this.overlay.classList.add("opacity-100");
    }

    this.showNextLine();
  }

  private showNextLine(): void {
    if (
      !this.currentDialogue ||
      this.currentLineIndex >= this.currentDialogue.lines.length
    ) {
      this.end();
      return;
    }

    const line = this.currentDialogue.lines[this.currentLineIndex];
    if (!line) {
      this.end();
      return;
    }

    this.onLineStart?.(line);

    // Typewriter effect
    if (this.textElement) {
      this.textElement.textContent = "";
      this.textElement.classList.add("cursor");

      let charIndex = 0;
      const text = line.text;

      if (this.typeIntervalId) clearInterval(this.typeIntervalId);

      this.typeIntervalId = setInterval(() => {
        if (charIndex < text.length) {
          this.textElement!.textContent += text.charAt(charIndex);
          charIndex++;

          // Play typing sound
          AudioManager.getInstance().play("typing", false, 0.4);
        } else {
          if (this.typeIntervalId) clearInterval(this.typeIntervalId);
          this.textElement?.classList.remove("cursor");
        }
      }, 50) as unknown as number;
    }

    const duration = line.duration ?? 3000;
    this.timeoutId = setTimeout(() => {
      this.onLineEnd?.();
      this.currentLineIndex++;
      this.showNextLine();
    }, duration) as unknown as number;
  }

  private end(): void {
    this.isPlaying = false;
    this.onDialogueEnd?.();
    this.currentDialogue = undefined;

    // Hide overlay
    if (this.overlay) {
      this.overlay.classList.remove("opacity-100");
      this.overlay.classList.add("opacity-0");
    }
  }

  public skip(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.onLineEnd?.();
    this.currentLineIndex++;
    this.showNextLine();
  }

  public isActive(): boolean {
    return this.isPlaying;
  }

  public stop(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.typeIntervalId) clearInterval(this.typeIntervalId);
    this.end();
  }
}
