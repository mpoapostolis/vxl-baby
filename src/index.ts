async function initGame(): Promise<void> {
  const canvas = document.querySelector("canvas");
  if (!canvas) {
    console.error("Canvas element not found");
    return;
  }

  try {
    const { Engine } = await import("./core/Engine");
    const { LevelManager } = await import("./managers/LevelManager");
    const { LevelStore } = await import("./managers/LevelStore");
    const { Level } = await import("./levels/Level");

    const engine = Engine.getInstance(canvas as HTMLCanvasElement);
    await engine.init();

    const levelManager = LevelManager.getInstance();
    const store = LevelStore.getInstance();

    // Load the first available level
    const firstLevel = store.getFirst();
    if (!firstLevel) {
      console.error("No levels found!");
      return;
    }
    await levelManager.load(firstLevel.id);

    engine.runRenderLoop(() => {
      levelManager.update();
      levelManager.getCurrentLevel()?.render();
    });
  } catch (error) {
    console.error("Game initialization failed:", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initGame);
} else {
  initGame();
}
