function showError(message: string): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0; background: #0a0a0a; color: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: system-ui, sans-serif; z-index: 9999;
  `;
  overlay.innerHTML = `
    <div style="text-align: center; max-width: 400px; padding: 2rem;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
      <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Failed to Load Game</h1>
      <p style="color: #888; margin-bottom: 1.5rem;">${message}</p>
      <button onclick="location.reload()" style="
        padding: 0.75rem 2rem; background: #333; border: 1px solid #555;
        color: #fff; border-radius: 4px; cursor: pointer; font-size: 1rem;
      ">Retry</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function initGame(): Promise<void> {
  const canvas = document.querySelector("canvas");
  if (!canvas) {
    showError("Canvas element not found. Please refresh the page.");
    return;
  }

  try {
    const { Engine } = await import("./core/Engine");
    const { LevelManager } = await import("./managers/LevelManager");
    const { LevelStore } = await import("./managers/LevelStore");

    const engine = Engine.getInstance(canvas as HTMLCanvasElement);
    await engine.init();

    const levelManager = LevelManager.getInstance();
    const store = LevelStore.getInstance();

    const firstLevel = store.getFirst();
    if (!firstLevel) {
      showError("No levels found. The game data may be corrupted.");
      return;
    }

    await levelManager.load(firstLevel.id);

    engine.runRenderLoop(() => {
      levelManager.update();
      levelManager.getCurrentLevel()?.render();
    });
  } catch (error) {
    console.error("Game initialization failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    showError(message);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initGame);
} else {
  initGame();
}
