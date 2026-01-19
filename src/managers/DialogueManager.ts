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
      "fixed bottom-12 left-1/2 transform -translate-x-1/2 w-[90%] max-w-3xl bg-black/95 border-y-4 text-white p-8 rounded-sm shadow-2xl pointer-events-none opacity-0 translate-y-4 transition-all duration-500 z-50 backdrop-blur-xl flex flex-col items-center gap-4";

    // Speaker Label
    const speakerLabel = document.createElement("span");
    speakerLabel.id = "speaker-label";
    speakerLabel.className =
      "font-bold uppercase tracking-[0.3em] text-sm mb-2 opacity-90";
    speakerLabel.textContent = "UNKNOWN";
    this.overlay.appendChild(speakerLabel);

    this.textElement = document.createElement("p");
    this.textElement.className =
      "text-2xl font-serif tracking-wide text-center min-h-[1.5em] leading-relaxed drop-shadow-md";

    // Add cursor style & themes
    const style = document.createElement("style");
    style.textContent = `
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      .cursor::after { content: ''; display: inline-block; width: 0.6em; height: 1.2em; background: currentColor; margin-left: 4px; vertical-align: middle; animation: blink 1s step-end infinite; }
      
      /* DEMON THEME */
      .theme-demon {
        border-color: rgba(127, 29, 29, 0.8);
        box-shadow: 0 0 30px rgba(127, 29, 29, 0.2);
      }
      .theme-demon #speaker-label { color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.5); }
      .theme-demon p { color: #fee2e2; }
      .theme-demon .cursor::after { background: #ef4444; }

      /* WIFE THEME */
      .theme-wife {
        border-color: rgba(6, 182, 212, 0.8);
        box-shadow: 0 0 30px rgba(6, 182, 212, 0.2);
      }
      .theme-wife #speaker-label { color: #22d3ee; text-shadow: 0 0 10px rgba(34, 211, 238, 0.5); }
      .theme-wife p { color: #ecfeff; }
      .theme-wife .cursor::after { background: #22d3ee; }
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

    // Apply Theme & Speaker
    const speaker = this.currentDialogue.lines[0]?.speaker || "Unknown";
    const speakerLabel = this.overlay?.querySelector("#speaker-label");
    if (speakerLabel) speakerLabel.textContent = speaker;

    // Reset themes
    this.overlay?.classList.remove("theme-demon", "theme-wife");

    // Set Theme
    if (speaker === "Demon") {
      this.overlay?.classList.add("theme-demon");
    } else if (speaker === "Wife") {
      this.overlay?.classList.add("theme-wife");
    } else {
      this.overlay?.classList.add("theme-demon"); // Fallback
    }

    // Show overlay with animation
    if (this.overlay) {
      this.overlay.classList.remove("opacity-0", "translate-y-4");
      this.overlay.classList.add("opacity-100", "translate-y-0");
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
      this.overlay.classList.remove("opacity-100", "translate-y-0");
      this.overlay.classList.add("opacity-0", "translate-y-4");
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
