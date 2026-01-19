# vxl-baby 👶🎮

[**Play the Demo**](https://horror-game-vid.mpoapostolis.workers.dev/) 🕹️

A web-based 3D horror/exploration game built with **Astro**, **Babylon.js**, and **Havok Physics**.

## 🚀 Overview

This project is a modern web game experiment leveraging **WebGPU** (via Babylon.js) for high-performance rendering and **Havok** for realistic physics. It features a modular level system, atmospheric effects, and character interaction.

## 🛠️ Tech Stack

- **Framework:** [Astro](https://astro.build)
- **3D Engine:** [Babylon.js](https://www.babylonjs.com/) (WebGPU)
- **Physics:** [Havok Physics](https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Language:** TypeScript

## 📂 Project Structure

- **`src/core`**: Main engine initialization (`WebGPUEngine`).
- **`src/levels`**: Level logic. `BaseLevel` handles common setups (lights, camera, physics).
  - `Level_1`: Initial apartment scene.
  - `Level_2`: Darker scene with Demon NPC.
- **`src/entities`**: Game objects.
  - `Player`: 3D Character controller with physics-based movement.
  - `Demon`: Interactive NPC.
  - `Portal`: Triggers level transitions.
- **`src/managers`**:
  - `AssetManager`: Async GLB model loading.
  - `AudioManager`: Sound effects and background tracks.
  - `InputManager`: Unified input handling.
  - `DialogueManager`: In-game UI for conversations.

## 🕹️ Controls

- **WASD**: Move Character
- **Mouse**: Look around
- **Interaction**: Context-sensitive (e.g., proximity to Demon)

## 🏃 Getting Started

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Run Development Server**

   ```bash
   npm run dev
   ```

3. **Build for Production**
   ```bash
   npm run build
   ```

## ⚠️ Notes

- **Assets**: 3D models and generic assets are located in `public/assets`.
- **Physics**: Requires `HavokPhysics.wasm` (automatically loaded from assets).

---

_Built by StruggleCoder_
