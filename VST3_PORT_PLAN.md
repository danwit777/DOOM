# DOOM VST3 Embedding Plan

The current macOS port now builds the original game code as `doom-core` and
links the standalone SDL/AVFoundation host separately as `doom-macos`.

The VST3 plugin should become a second host for the same core.

## Target Shape

The plugin host should own one DOOM instance and drive it from the DAW:

```cpp
class DoomInstance {
public:
    bool init(const char* iwadPath);
    void shutdown();

    void stepFrame();
    const unsigned char* framebuffer8() const;
    const unsigned int* paletteArgb() const;

    void keyDown(int doomKey);
    void keyUp(int doomKey);
    void mouseMove(int dx, int dy);
    void mouseButton(int buttonMask);

    void renderAudio(float** outputs, int numChannels, int numFrames);
};
```

## Required Core Cuts

1. Split `D_DoomMain()` into one-time startup and loop entry.
2. Split `D_DoomLoop()` into `D_DoomFrame()` so a host can call one frame/tick.
3. Replace `I_FinishUpdate()` ownership of the window with a framebuffer handoff.
4. Replace SDL audio device ownership with a host-provided render callback.
5. Replace `I_Quit()` / `I_Error()` process exits with host-visible status.
6. Keep network disabled for the plugin MVP.
7. Audit save/load pointer serialization before exposing save slots in a DAW.

## VST3 Host Mapping

- Processor:
  - Owns/starts `DoomInstance`.
  - Calls `renderAudio()` in `process()`.
  - Exposes parameters for music volume, SFX volume, pause, reset, IWAD path.

- Editor:
  - Draws the 320x200 indexed framebuffer scaled to the plugin view.
  - Sends keyboard/mouse events to `DoomInstance`.
  - Does not create a separate SDL window.

## First VST3 MVP

1. Add the Steinberg VST3 SDK as a CMake dependency.
2. Build `doom-vst3` linking `doom-core`.
3. Stub the editor with a black 320x200 surface.
4. Add a fake `D_DoomFrame()` that initially delegates to current code shape.
5. Replace the standalone-only video/audio paths with host adapters.

The MVP is done when a DAW opens the plugin editor and can render the DOOM
title/menu framebuffer inside the plugin window.
