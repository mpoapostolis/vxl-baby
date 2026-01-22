/**
 * DialogueManager - Singleton for managing in-game dialogue
 * Optimized: rAF-based typewriter, efficient DOM updates, proper cleanup
 */

import { AudioManager } from "./AudioManager";

export interface DialogueLine {
  speaker?: string;
  text: string;
  duration?: number;
}

export interface Dialogue {
  id: string;
  lines: DialogueLine[];
}

type Theme = "default" | "demon" | "wife";

const CHARS_PER_SECOND = 20;
const DEFAULT_LINE_DURATION_MS = 3000;
const TYPING_SOUND_INTERVAL = 3;

const THEME_CLASSES: Record<Theme, string> = {
  default: "",
  demon: "theme-demon",
  wife: "theme-wife",
};

export class DialogueManager {
  private static instance: DialogueManager;

  private readonly dialogues = new Map<string, Dialogue>();
  private readonly audio = AudioManager.getInstance();

  private overlay: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private speakerEl: HTMLElement | null = null;

  private current?: Dialogue;
  private lineIndex = 0;
  private active = false;

  private rafId: number | null = null;
  private lineTimer: number | null = null;

  private constructor() {
    this.createUI();
  }

  static getInstance(): DialogueManager {
    return (DialogueManager.instance ??= new DialogueManager());
  }

  register(dialogue: Dialogue): void {
    this.dialogues.set(dialogue.id, dialogue);
  }

  play(id: string): void {
    const dialogue = this.dialogues.get(id);
    if (!dialogue) return;

    this.clearTimers();
    this.current = dialogue;
    this.lineIndex = 0;
    this.active = true;

    const speaker = dialogue.lines[0]?.speaker ?? "Unknown";
    this.setSpeaker(speaker);
    this.applyTheme(speaker);
    this.show();
    this.nextLine();
  }

  stop(): void {
    this.end();
  }

  isActive(): boolean {
    return this.active;
  }

  private nextLine(): void {
    if (!this.current || this.lineIndex >= this.current.lines.length) {
      this.end();
      return;
    }

    const line = this.current.lines[this.lineIndex];
    if (!line) {
      this.end();
      return;
    }

    this.typeText(line.text);
    this.scheduleNextLine(line.duration ?? DEFAULT_LINE_DURATION_MS);
  }

  private typeText(text: string): void {
    if (!this.textEl) return;

    this.textEl.textContent = "";
    this.textEl.classList.add("cursor");

    let charIndex = 0;
    let lastTime = performance.now();
    let soundCounter = 0;

    const animate = (now: number) => {
      const delta = now - lastTime;
      const charsToAdd = Math.floor((delta / 1000) * CHARS_PER_SECOND);

      if (charsToAdd > 0) {
        lastTime = now;
        charIndex = Math.min(charIndex + charsToAdd, text.length);
        this.textEl!.textContent = text.slice(0, charIndex);

        // Sound feedback
        soundCounter += charsToAdd;
        if (soundCounter >= TYPING_SOUND_INTERVAL) {
          this.audio.play("typing", false, 0.4);
          soundCounter = 0;
        }
      }

      if (charIndex < text.length) {
        this.rafId = requestAnimationFrame(animate);
      } else {
        this.textEl?.classList.remove("cursor");
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(animate);
  }

  private scheduleNextLine(duration: number): void {
    this.lineTimer = window.setTimeout(() => {
      this.lineIndex++;
      this.nextLine();
    }, duration);
  }

  private clearTimers(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.lineTimer !== null) {
      clearTimeout(this.lineTimer);
      this.lineTimer = null;
    }
  }

  private end(): void {
    this.clearTimers();
    this.active = false;
    this.current = undefined;
    this.lineIndex = 0;
    this.hide();
  }

  private setSpeaker(name: string): void {
    if (this.speakerEl) this.speakerEl.textContent = name;
  }

  private applyTheme(speaker: string): void {
    if (!this.overlay) return;

    // Remove all themes
    for (const cls of Object.values(THEME_CLASSES)) {
      if (cls) this.overlay.classList.remove(cls);
    }

    // Apply speaker-specific theme
    const theme: Theme = speaker === "Demon" ? "demon" : speaker === "Wife" ? "wife" : "default";
    const themeClass = THEME_CLASSES[theme];
    if (themeClass) this.overlay.classList.add(themeClass);
  }

  private show(): void {
    this.overlay?.classList.remove("opacity-0", "translate-y-4");
    this.overlay?.classList.add("opacity-100", "translate-y-0");
  }

  private hide(): void {
    this.overlay?.classList.remove("opacity-100", "translate-y-0");
    this.overlay?.classList.add("opacity-0", "translate-y-4");
  }

  private createUI(): void {
    if (typeof document === "undefined") return;

    this.overlay = document.createElement("div");
    this.overlay.id = "dialogue-overlay";
    this.overlay.className = `
      fixed bottom-12 left-1/2 transform -translate-x-1/2 w-[90%] max-w-3xl
      bg-gradient-to-b from-black/95 to-gray-900/95 border-y-4 text-white
      p-8 rounded-sm shadow-2xl pointer-events-none opacity-0 translate-y-4
      transition-all duration-500 z-50 backdrop-blur-xl flex flex-col items-center gap-4
    `.trim();

    this.speakerEl = document.createElement("span");
    this.speakerEl.id = "speaker-label";
    this.speakerEl.className = "font-bold uppercase tracking-[0.3em] text-sm mb-2 opacity-90 font-sans";
    this.speakerEl.textContent = "UNKNOWN";
    this.overlay.appendChild(this.speakerEl);

    this.textEl = document.createElement("p");
    this.textEl.className = "text-xl md:text-2xl font-mono tracking-wide text-center min-h-[1.5em] leading-relaxed drop-shadow-md";
    this.overlay.appendChild(this.textEl);

    this.injectStyles();
    document.body.appendChild(this.overlay);
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes pulse-red {
        0% { border-color: rgba(127, 29, 29, 0.6); box-shadow: 0 0 15px rgba(127, 29, 29, 0.1); }
        50% { border-color: rgba(220, 38, 38, 1); box-shadow: 0 0 30px rgba(220, 38, 38, 0.4); }
        100% { border-color: rgba(127, 29, 29, 0.6); box-shadow: 0 0 15px rgba(127, 29, 29, 0.1); }
      }
      @keyframes pulse-cyan {
        0% { border-color: rgba(6, 182, 212, 0.6); box-shadow: 0 0 15px rgba(6, 182, 212, 0.1); }
        50% { border-color: rgba(34, 211, 238, 1); box-shadow: 0 0 30px rgba(34, 211, 238, 0.4); }
        100% { border-color: rgba(6, 182, 212, 0.6); box-shadow: 0 0 15px rgba(6, 182, 212, 0.1); }
      }
      @keyframes glitch {
        0% { text-shadow: 2px 2px 0px #ff0000, -2px -2px 0px #00ff00; transform: translate(0); }
        20% { text-shadow: -2px 2px 0px #ff0000, 2px -2px 0px #00ff00; transform: translate(-1px, 1px); }
        40% { text-shadow: 2px -2px 0px #ff0000, -2px 2px 0px #00ff00; transform: translate(1px, -1px); }
        100% { text-shadow: 2px 2px 0px #ff0000, -2px -2px 0px #00ff00; transform: translate(0); }
      }

      .cursor::after {
        content: '';
        display: inline-block;
        width: 0.6em;
        height: 1.2em;
        background: currentColor;
        margin-left: 4px;
        vertical-align: middle;
        animation: blink 1s step-end infinite;
      }

      #dialogue-overlay::before {
        content: " ";
        display: block;
        position: absolute;
        top: 0; left: 0; bottom: 0; right: 0;
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%),
                    linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
        z-index: 2;
        background-size: 100% 2px, 3px 100%;
        pointer-events: none;
      }

      .theme-demon { animation: pulse-red 3s infinite; }
      .theme-demon #speaker-label { color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68, 0.8); }
      .theme-demon p { color: #fecaca; text-shadow: 2px 0 #7f1d1d; animation: glitch 3s infinite alternate-reverse; }
      .theme-demon .cursor::after { background: #ef4444; box-shadow: 0 0 10px #ef4444; }

      .theme-wife { animation: pulse-cyan 4s infinite; }
      .theme-wife #speaker-label { color: #67e8f9; text-shadow: 0 0 10px rgba(103, 232, 249, 0.8); }
      .theme-wife p { color: #ecfeff; text-shadow: 0 0 5px rgba(34, 211, 238, 0.6); }
      .theme-wife .cursor::after { background: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
    `;
    document.head.appendChild(style);
  }
}
