// Αν θες να κρατήσεις και 3D ήχους μελλοντικά, κράτα τα imports, αλλιώς δεν χρειάζονται για το παρακάτω fix.

export class AudioManager {
  private static instance: AudioManager;

  // Εδώ κρατάμε τα paths
  // All audio files converted to MP3 for optimal compression
  private soundRegistry: Map<string, string> = new Map([
    ["teleport", "/assets/sounds/teleport.mp3"],
    ["demon_voice", "/assets/sounds/i_see_you_voice.mp3"],
    ["level_1", "/assets/sounds/level_1.mp3"],
    ["level_2", "/assets/sounds/level_2.mp3"],
    ["typing", "/assets/sounds/beep.wav"],
  ]);

  // Εδώ κρατάμε τους active native ήχους για να μπορούμε να κάνουμε stop αν χρειαστεί
  private activeGlobalSounds: Map<string, HTMLAudioElement> = new Map();

  private constructor() {}

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Παίζει ήχο GLOBAL (χωρίς Scene).
   * Αυτός ο ήχος ΔΕΝ σταματάει όταν αλλάζει η πίστα.
   */
  public play(name: string, loop: boolean = false, volume: number = 1.0): void {
    const path = this.soundRegistry.get(name);
    if (!path) {
      console.warn(`Sound "${name}" not found in registry.`);
      return;
    }

    // Δημιουργούμε native HTML Audio element
    // Αυτό είναι τελείως ανεξάρτητο από το Babylon Scene
    const audio = new Audio(path);
    audio.loop = loop;
    audio.volume = volume;

    // Το βάζουμε να παίξει
    audio.play().catch((error) => {
      console.error("Error playing audio:", error);
    });

    // Το αποθηκεύουμε αν θέλουμε να το σταματήσουμε χειροκίνητα
    this.activeGlobalSounds.set(name, audio);

    // Καθαρισμός όταν τελειώσει (αν δεν λουπάρει)
    if (!loop) {
      audio.onended = () => {
        this.activeGlobalSounds.delete(name);
      };
    }
  }

  public stop(name: string): void {
    const audio = this.activeGlobalSounds.get(name);
    if (audio) {
      audio.pause();
      audio.currentTime = 0; // Reset στην αρχή
      this.activeGlobalSounds.delete(name);
    }
  }
  public stopAll(): void {
    this.activeGlobalSounds.delete("teleport");
    this.activeGlobalSounds.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    this.activeGlobalSounds.clear();
  }

  public addSoundToRegistry(name: string, path: string): void {
    this.soundRegistry.set(name, path);
  }
}
