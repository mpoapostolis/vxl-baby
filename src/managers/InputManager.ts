import { KeyboardEventTypes, type Scene } from "@babylonjs/core";

export class InputManager {
  private static instance: InputManager;
  public keySet: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  public init(scene: Scene): void {
    scene.onKeyboardObservable.add((keys) => {
      if (keys.type === KeyboardEventTypes.KEYDOWN) {
        this.keySet.add(keys.event.code);
      } else if (keys.type === KeyboardEventTypes.KEYUP) {
        this.keySet.delete(keys.event.code);
      }
    });
  }

  public isKeyDown(code: string): boolean {
    return this.keySet.has(code);
  }
}
