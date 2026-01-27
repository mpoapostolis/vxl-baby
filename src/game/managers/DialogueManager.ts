/**
 * DialogueManager - Singleton for managing in-game dialogue
 * Features: rAF-based typewriter, speaker theming, choice support
 */

import { AudioManager } from "./AudioManager";
import { ScriptManager } from "./ScriptManager";

// ==================== TYPES ====================

export interface DialogueChoice {
  text: string;
  value: number;
}

export interface DialogueLine {
  speaker?: string;
  text: string;
  choices?: DialogueChoice[];
}

export interface Dialogue {
  id: string;
  lines: DialogueLine[];
  onChoice?: (value: number) => void;
  onComplete?: () => void;
}

type Theme = "default" | "demon" | "wife";

// ==================== CONSTANTS ====================

const CHARS_PER_SECOND = 20;
const TYPING_SOUND_INTERVAL = 3;

const THEME_CLASSES: Record<Theme, string> = {
  default: "",
  demon: "theme-demon",
  wife: "theme-wife",
};

// ==================== DIALOGUE MANAGER ====================

export class DialogueManager {
  private static instance: DialogueManager;

  private readonly dialogues = new Map<string, Dialogue>();
  private readonly audio = AudioManager.getInstance();

  // UI Elements (cached for performance)
  private overlay: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private speakerEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private choicesEl: HTMLElement | null = null;

  // State
  private current?: Dialogue;
  private lineIndex = 0;
  private active = false;
  private isTyping = false;
  private waitingForInput = false;
  private fullText = "";
  private isScriptMode = false;
  private scriptOnComplete?: () => void;
  private currentChoiceTargets: string[] = [];
  private currentLine: DialogueLine | null = null;

  // Animation
  private rafId: number | null = null;
  private inputListener: ((e: KeyboardEvent | MouseEvent) => void) | null =
    null;

  private constructor() {
    this.createUI();
  }

  static getInstance(): DialogueManager {
    return (DialogueManager.instance ??= new DialogueManager());
  }

  // ==================== PUBLIC API ====================

  register(dialogue: Dialogue): void {
    this.dialogues.set(dialogue.id, dialogue);
  }

  play(id: string): void {
    const dialogue = this.dialogues.get(id);
    if (!dialogue) {
      console.warn(`[Dialogue] Not found: ${id}`);
      return;
    }

    this.cleanup();
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
    this.cleanup();
    this.active = false;
    this.current = undefined;
    this.lineIndex = 0;
    this.isTyping = false;
    this.waitingForInput = false;
    this.isScriptMode = false;
    this.currentLine = null;
    this.currentChoiceTargets = [];
    this.scriptOnComplete = undefined;
    this.hide();
  }
  isDialoguePlaying(): boolean {
    // @ts-ignore
    return this.active;
  }

  startScript(source: string, onComplete?: () => void): void {
    this.cleanup();
    this.isScriptMode = true;
    this.active = true;
    this.scriptOnComplete = onComplete;

    const sm = ScriptManager.getInstance();
    sm.load(source);
    sm.start();

    this.show();
    this.advanceScript();
  }

  private advanceScript() {
    const sm = ScriptManager.getInstance();
    const line = sm.next();

    if (!line) {
      this.end();
      return;
    }

    if (line.type === "say") {
      this.setSpeaker(line.speaker);
      this.applyTheme(line.speaker);
      this.typeText({ text: line.text });
    } else if (line.type === "choice") {
      // Show choices
      // For choice lines, we might not have 'text' to say first.
      // Usually choices follow a say line.
      // If we hit a choice block immediately, we might need a prompt.
      // For now, assume choices are just buttons.
      const options = line.options.map((opt, idx) => ({
        text: opt.text,
        value: idx, // We'll store the index to look up target later?
        // No, DialogueManager passes number back.
        // We need to know THE TARGET.
        // But DialogueManager only handles simple value return.
        // Let's store the targets temporarily in ScriptManager or here.
        // We'll pass the TARGET STRING as the value if we assume value is any?
        // DialogueChoice.value is number.
        // So we need to map index -> target in ScriptManager or local state.
      }));

      // We need to persist these targets to know where to jump
      this.currentChoiceTargets = line.options.map((o) => o.target);

      this.typeText({
        text: line.prompt || "...",
        choices: options,
      });
    }
  }

  // ==================== LINE MANAGEMENT ====================

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

    this.typeText(line);
  }

  private typeText(line: DialogueLine): void {
    if (!this.textEl) return;

    this.currentLine = line; // Store for finishTyping in script mode
    this.textEl.textContent = "";
    this.isTyping = true;
    this.waitingForInput = false;
    this.fullText = line.text;
    this.updateHint(false);
    this.clearChoices();

    let charIndex = 0;
    let charAccumulator = 0;
    let lastTime = performance.now();
    let soundCounter = 0;

    const animate = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      charAccumulator += (delta / 1000) * CHARS_PER_SECOND;

      const charsToAdd = Math.floor(charAccumulator);
      if (charsToAdd > 0) {
        charAccumulator -= charsToAdd;
        charIndex = Math.min(charIndex + charsToAdd, this.fullText.length);
        this.textEl!.textContent = this.fullText.slice(0, charIndex);

        soundCounter += charsToAdd;
        if (soundCounter >= TYPING_SOUND_INTERVAL) {
          this.audio.play("typing", false, 0.4);
          soundCounter = 0;
        }
      }

      if (charIndex < this.fullText.length) {
        this.rafId = requestAnimationFrame(animate);
      } else {
        this.finishTyping(line);
      }
    };

    this.setupInputListener();
    this.rafId = requestAnimationFrame(animate);
  }

  private finishTyping(line?: DialogueLine): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Use passed line, stored currentLine, or fall back to dialogue lines
    const activeLine = line ?? this.currentLine ?? this.current?.lines[this.lineIndex];
    if (!activeLine) return;

    if (this.textEl) this.textEl.textContent = activeLine.text;
    this.isTyping = false;

    if (activeLine.choices?.length) {
      this.showChoices(activeLine.choices);
      this.waitingForInput = false;
      this.updateHint(false);
    } else {
      this.waitingForInput = true;
      this.updateHint(true);
    }
  }

  // ==================== INPUT HANDLING ====================

  private handleInput(e: KeyboardEvent | MouseEvent): void {
    if (!this.active) return;

    // Ignore clicks on choice buttons (they have their own handlers)
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;

    // Only handle Space and Enter for keyboard
    if (e instanceof KeyboardEvent) {
      if (e.code !== "Space" && e.code !== "Enter") return;
      e.preventDefault();
    }

    if (this.isTyping) {
      this.finishTyping();
      return;
    }

    if (this.waitingForInput) {
      if (this.isScriptMode) {
        this.advanceScript();
      } else {
        this.lineIndex++;
        this.nextLine();
      }
    }
  }

  private setupInputListener(): void {
    if (this.inputListener) return;

    this.inputListener = (e) => this.handleInput(e);
    window.addEventListener("keydown", this.inputListener);
    window.addEventListener("click", this.inputListener);
  }

  private removeInputListener(): void {
    if (this.inputListener) {
      window.removeEventListener("keydown", this.inputListener);
      window.removeEventListener("click", this.inputListener);
      this.inputListener = null;
    }
  }

  // ==================== CHOICES ====================

  private showChoices(choices: DialogueChoice[]): void {
    if (!this.overlay) return;

    this.clearChoices();

    const container = document.createElement("div");
    container.id = "dialogue-choices";
    container.className =
      "flex flex-wrap justify-center gap-3 mt-4 w-full animate-fade-in";

    for (const choice of choices) {
      const btn = document.createElement("button");
      btn.textContent = choice.text;
      btn.className = `
        px-6 py-2 bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/50
        rounded text-sm font-bold uppercase tracking-wide transition-all
        hover:scale-105 active:scale-95 backdrop-blur-md shadow-lg
      `.trim();

      btn.onclick = (e) => {
        e.stopPropagation();
        this.handleChoiceSelection(choice.value);
      };

      container.appendChild(btn);
    }

    this.choicesEl = container;
    this.overlay.appendChild(container);
  }

  private handleChoiceSelection(value: number): void {
    if (this.isScriptMode) {
      // value is index
      const target = this.currentChoiceTargets[value];
      if (target) {
        ScriptManager.getInstance().jumpTo(target);
        this.advanceScript();
      }
      return;
    }

    const previousId = this.current?.id;

    if (this.current?.onChoice) {
      try {
        this.current.onChoice(value);
      } catch (e) {
        console.error("[DialogueManager] Error in onChoice callback:", e);
      }
    }

    // Only advance if the dialogue hasn't changed (e.g. onChoice didn't start a new dialogue)
    if (this.current && this.current.id === previousId) {
      this.lineIndex++;
      this.nextLine();
    }
  }

  private clearChoices(): void {
    if (this.choicesEl) {
      this.choicesEl.remove();
      this.choicesEl = null;
    }
  }

  // ==================== UI UPDATES ====================

  private updateHint(show: boolean): void {
    if (this.hintEl) {
      this.hintEl.classList.toggle("opacity-0", !show);
    }
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
    const theme: Theme =
      speaker === "Demon" ? "demon" : speaker === "Wife" ? "wife" : "default";
    const themeClass = THEME_CLASSES[theme];
    if (themeClass) this.overlay.classList.add(themeClass);
  }

  private show(): void {
    if (!this.overlay) return;
    this.overlay.style.display = "flex";
    // Force reflow
    void this.overlay.offsetWidth;

    this.overlay.classList.remove(
      "opacity-0",
      "translate-y-8",
      "scale-95",
      "pointer-events-none",
    );
    this.overlay.classList.add("opacity-100", "translate-y-0", "scale-100");
  }

  private hide(): void {
    if (!this.overlay) return;
    this.overlay.classList.remove("opacity-100", "translate-y-0", "scale-100");
    this.overlay.classList.add(
      "opacity-0",
      "translate-y-8",
      "scale-95",
      "pointer-events-none",
    );

    // Re-focus canvas so player can move with WASD
    const canvas = document.querySelector("canvas");
    if (canvas) {
      (canvas as HTMLCanvasElement).focus();
    }

    // Optional: Hide display after transition
    setTimeout(() => {
      if (!this.active && this.overlay) {
        this.overlay.style.display = "none";
      }
    }, 500);
  }

  // ==================== LIFECYCLE ====================

  private cleanup(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.removeInputListener();
    this.clearChoices();
  }

  private end(): void {
    const callback = this.isScriptMode
      ? this.scriptOnComplete
      : this.current?.onComplete;

    // Clear ALL state BEFORE calling onComplete so a new dialogue can be started
    this.cleanup();
    this.active = false;
    this.current = undefined;
    this.lineIndex = 0;
    this.isTyping = false;
    this.waitingForInput = false;
    this.isScriptMode = false;
    this.currentLine = null;
    this.currentChoiceTargets = [];
    this.scriptOnComplete = undefined;

    // Call onComplete - this may start a new dialogue
    if (callback) {
      try {
        callback();
      } catch (e) {
        console.error("[DialogueManager] Error in onComplete callback:", e);
      }
    }

    // Only hide if no new dialogue was started during onComplete
    if (!this.active) {
      this.hide();
    }
  }

  // ==================== UI CREATION ====================

  private createUI(): void {
    if (typeof document === "undefined") return;

    this.overlay = document.createElement("div");
    this.overlay.id = "dialogue-overlay";
    this.overlay.className = `
      fixed bottom-12 left-1/2 transform -translate-x-1/2 w-[90%] max-w-2xl
      bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl
      p-6 flex flex-col gap-4 text-white opacity-0 translate-y-8 scale-95
      transition-all duration-500 ease-out z-50
    `.trim();

    // Header
    const header = document.createElement("div");
    header.className = "flex items-center gap-3";

    const speakerBadge = document.createElement("div");
    speakerBadge.className =
      "w-2 h-8 rounded-full bg-gradient-to-b from-[var(--accent-primary)] to-[var(--accent-secondary)]";
    speakerBadge.id = "speaker-accent";

    this.speakerEl = document.createElement("span");
    this.speakerEl.id = "speaker-label";
    this.speakerEl.className =
      "text-xs font-bold uppercase tracking-widest text-white/50 font-sans";
    this.speakerEl.textContent = "UNKNOWN";

    header.appendChild(speakerBadge);
    header.appendChild(this.speakerEl);
    this.overlay.appendChild(header);

    // Text
    this.textEl = document.createElement("p");
    this.textEl.className =
      "text-lg md:text-xl font-sans font-medium leading-relaxed text-white/90 drop-shadow-sm min-h-[3rem]";
    this.overlay.appendChild(this.textEl);

    // Hint
    this.hintEl = document.createElement("div");
    this.hintEl.id = "dialogue-hint";
    this.hintEl.className =
      "absolute bottom-4 right-6 text-[10px] text-white/30 font-sans uppercase tracking-widest animate-pulse transition-opacity duration-300 opacity-0";
    this.hintEl.textContent = "Press Space";
    this.overlay.appendChild(this.hintEl);

    this.injectStyles();
    document.body.appendChild(this.overlay);
  }

  private injectStyles(): void {
    if (document.getElementById("dialogue-styles")) return;

    const style = document.createElement("style");
    style.id = "dialogue-styles";
    style.textContent = `
      /* Demon Theme */
      .theme-demon {
        background-color: rgba(20, 0, 0, 0.85) !important;
        border-color: rgba(239, 68, 68, 0.3) !important;
        box-shadow: 0 0 50px rgba(220, 38, 38, 0.15) !important;
      }
      .theme-demon #speaker-accent {
        background: linear-gradient(to bottom, #ef4444, #7f1d1d) !important;
      }
      .theme-demon #speaker-label {
        color: #fca5a5 !important;
        text-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
      }
      .theme-demon p {
        color: #fecaca !important;
      }

      /* Wife Theme */
      .theme-wife {
        background-color: rgba(0, 20, 30, 0.85) !important;
        border-color: rgba(34, 211, 238, 0.3) !important;
        box-shadow: 0 0 50px rgba(6, 182, 212, 0.15) !important;
      }
      .theme-wife #speaker-accent {
        background: linear-gradient(to bottom, #22d3ee, #0e7490) !important;
      }
      .theme-wife #speaker-label {
        color: #67e8f9 !important;
        text-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
      }
      .theme-wife p {
        color: #ecfeff !important;
      }

      @keyframes fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-fade-in {
        animation: fade-in 0.3s ease-out;
      }
    `;
    document.head.appendChild(style);
  }
}
