interface ScriptCondition {
  key: string;
  val: number;
  op: ">=" | "<=" | "==" | ">" | "<";
}

interface ScriptBlock {
  name: string;
  lines: ScriptLine[];
}

export type ScriptLine =
  | { type: "say"; speaker: string; text: string }
  | {
      type: "choice";
      options: { text: string; target: string; condition?: ScriptCondition }[];
    }
  | { type: "goto"; target: string }
  | { type: "action"; command: string; args: string[] };

export class ScriptManager {
  private static instance: ScriptManager;
  private blocks: Map<string, ScriptBlock> = new Map();
  private variables: Record<string, number> = {};
  private currentBlock: string | null = null;
  private currentIndex: number = 0;
  private _active: boolean = false;

  private constructor() {}

  public static getInstance(): ScriptManager {
    if (!ScriptManager.instance) {
      ScriptManager.instance = new ScriptManager();
    }
    return ScriptManager.instance;
  }

  // ==================== PARSER ====================

  public load(source: string) {
    this.blocks.clear();
    this.currentBlock = null;
    this.currentIndex = 0;
    this._active = false;

    const lines = source.split("\n");
    let currentBlockName = "START";
    let currentBlockLines: ScriptLine[] = [];

    const flushBlock = () => {
      if (currentBlockLines.length > 0 || currentBlockName === "START") {
        this.blocks.set(currentBlockName, {
          name: currentBlockName,
          lines: [...currentBlockLines],
        });
      }
      currentBlockLines = [];
    };

    let pendingChoice: {
      options: { text: string; target: string; condition?: ScriptCondition }[];
    } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      if (!rawLine || rawLine.startsWith("//")) continue;

      // 1. Block Header: # NAME
      if (rawLine.startsWith("#")) {
        if (pendingChoice) {
          currentBlockLines.push({ type: "choice", ...pendingChoice });
          pendingChoice = null;
        }
        flushBlock();
        currentBlockName = rawLine.replace("#", "").trim();
        continue;
      }

      // 2. Choice: * Text (need 5 x) -> TARGET
      if (rawLine.startsWith("*")) {
        if (!pendingChoice) pendingChoice = { options: [] };

        // Parse: * Text [(need 5 gold)] -> TARGET
        // Regex: * (Text) [(need 5 gold)] -> (TARGET)
        const parts = rawLine.substring(1).split("->");
        if (parts.length === 2) {
          let textPart = parts[0].trim();
          const target = parts[1].trim();
          let condition: ScriptCondition | undefined;

          // Check for (need 5 gold)
          const condMatch = textPart.match(
            /\(need\s+(\d+)\s+([a-zA-Z0-9_]+)\)$/,
          );
          if (condMatch) {
            // Found condition
            condition = {
              val: parseInt(condMatch[1]),
              key: condMatch[2],
              op: ">=",
            };
            // Remove condition from text
            textPart = textPart.replace(condMatch[0], "").trim();
          }

          pendingChoice.options.push({ text: textPart, target, condition });
        }
        continue;
      }

      // Flush choice if handling other lines
      if (pendingChoice) {
        currentBlockLines.push({ type: "choice", ...pendingChoice });
        pendingChoice = null;
      }

      // 3. Actions: [give sword], [set flag 1]
      // Matches [cmd args...]
      const actionMatch = rawLine.match(/^\[([a-zA-Z0-9_]+)(?:\s+(.+))?\]$/);
      if (actionMatch) {
        const command = actionMatch[1].toLowerCase(); // give, take, set
        const argsStr = actionMatch[2] || "";
        const args = argsStr.split(" ").filter((s) => s);
        currentBlockLines.push({ type: "action", command, args });
        continue;
      }

      // 4. Goto: -> TARGET
      if (rawLine.startsWith("->")) {
        const target = rawLine.substring(2).trim();
        currentBlockLines.push({ type: "goto", target });
        continue;
      }

      // 5. Dialogue: Speaker: Text
      if (rawLine.includes(":")) {
        const firstColon = rawLine.indexOf(":");
        const speaker = rawLine.substring(0, firstColon).trim();
        const text = rawLine.substring(firstColon + 1).trim();
        currentBlockLines.push({ type: "say", speaker, text });
      } else {
        // Narrator
        currentBlockLines.push({
          type: "say",
          speaker: "Narrator",
          text: rawLine,
        });
      }
    }

    if (pendingChoice) {
      currentBlockLines.push({ type: "choice", ...pendingChoice });
    }
    flushBlock();
    console.log(
      `[ScriptManager] Loaded ${this.blocks.size} blocks (Standard v2).`,
    );
  }

  // ==================== RUNTIME ====================

  public start() {
    this.currentBlock = "START";
    this.currentIndex = 0;
    this._active = true;
  }

  public get isActive() {
    return this._active;
  }

  public next(): ScriptLine | null {
    if (!this._active || !this.currentBlock) return null;

    const block = this.blocks.get(this.currentBlock);
    if (!block || this.currentIndex >= block.lines.length) {
      this._active = false;
      return null;
    }

    const line = block.lines[this.currentIndex];
    this.currentIndex++;

    // Handle Goto
    if (line.type === "goto") {
      if (line.target === "END") {
        this._active = false;
        return null;
      }
      this.currentBlock = line.target;
      this.currentIndex = 0;
      return this.next();
    }

    // Handle Action
    if (line.type === "action") {
      this.handleAction(line.command, line.args);
      return this.next();
    }

    // Handle Choice (Filter by condition)
    if (line.type === "choice") {
      const validOptions = line.options.filter((opt) =>
        this.checkCondition(opt.condition),
      );
      // If no valid options, what do we do? Skip? Stop?
      // Ideally scripts shouldn't dead-end yourself.
      // But for now, we return only valid ones.
      return { ...line, options: validOptions };
    }

    // Interpolate Text
    if (line.type === "say") {
      return {
        ...line,
        text: line.text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
          return (this.variables[key] || 0).toString();
        }),
      };
    }

    return line;
  }

  public jumpTo(target: string) {
    if (target === "END") {
      this._active = false;
    } else {
      this.currentBlock = target;
      this.currentIndex = 0;
    }
  }

  // ==================== HELPERS ====================

  private handleAction(cmd: string, args: string[]) {
    // [give sword]
    // [set quest_done 1]
    const varName = args[0];
    const val = parseInt(args[1]) || 1;

    if (cmd === "set") {
      this.variables[varName] = val;
    } else if (cmd === "give") {
      this.variables[varName] = (this.variables[varName] || 0) + val;
      window.dispatchEvent(
        new CustomEvent("game:give-item", {
          detail: { itemId: varName, amount: val },
        }),
      );
    } else if (cmd === "take") {
      this.variables[varName] = (this.variables[varName] || 0) - val;
      if (this.variables[varName] < 0) this.variables[varName] = 0;
      window.dispatchEvent(
        new CustomEvent("game:take-item", {
          detail: { itemId: varName, amount: val },
        }),
      );
    }
  }

  private checkCondition(cond?: ScriptCondition): boolean {
    if (!cond) return true;
    const current = this.variables[cond.key] || 0;
    switch (cond.op) {
      case ">=":
        return current >= cond.val;
      case "<=":
        return current <= cond.val;
      case "==":
        return current === cond.val;
      case ">":
        return current > cond.val;
      case "<":
        return current < cond.val;
      default:
        return true;
    }
  }
}
