import { WebGPUEngine, Engine as BabylonEngine, type AbstractEngine } from "@babylonjs/core";
import "@babylonjs/loaders";

export class Engine {
  private static instance: Engine | null = null;
  public engine!: AbstractEngine;
  public canvas: HTMLCanvasElement;
  private disposed = false;
  private isWebGPU = false;

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  public static getInstance(canvas?: HTMLCanvasElement): Engine {
    if (!Engine.instance) {
      if (!canvas) throw new Error("Canvas required for first initialization");
      Engine.instance = new Engine(canvas);
    }
    return Engine.instance;
  }

  public async init(): Promise<void> {
    if (this.engine) return;

    // Try WebGPU first, fall back to WebGL
    const webGPUSupported = await WebGPUEngine.IsSupportedAsync;

    if (webGPUSupported) {
      try {
        const gpuEngine = new WebGPUEngine(this.canvas, {
          audioEngine: true,
          powerPreference: "high-performance",
        });
        await gpuEngine.initAsync();
        this.engine = gpuEngine;
        this.isWebGPU = true;
        console.log("[Engine] Using WebGPU");
      } catch (e) {
        console.warn("[Engine] WebGPU failed, falling back to WebGL:", e);
        this.initWebGL();
      }
    } else {
      console.log("[Engine] WebGPU not supported, using WebGL");
      this.initWebGL();
    }

    window.addEventListener("resize", this.handleResize);
  }

  private initWebGL(): void {
    this.engine = new BabylonEngine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      audioEngine: true,
    });
    this.isWebGPU = false;
  }

  private handleResize = (): void => {
    if (!this.disposed) this.engine?.resize();
  };

  public runRenderLoop(callback: () => void): void {
    this.engine.runRenderLoop(callback);
  }

  public stopRenderLoop(): void {
    this.engine.stopRenderLoop();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener("resize", this.handleResize);
    this.engine?.stopRenderLoop();
    this.engine?.dispose();
    Engine.instance = null;
  }

  public get usingWebGPU(): boolean {
    return this.isWebGPU;
  }
}
