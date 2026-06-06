# Experimental macOS Port

This branch adds a minimal macOS build for the original Linux DOOM 1.10
source release.

The current port is intentionally conservative:

- the original game core is still compiled as C;
- the macOS platform layer is C++ and SDL2 based;
- video, palette upload, input, timing, SDL sound effects, AVFoundation music playback, and single-player startup are wired;
- networking is disabled for now;
- save/load still needs a 64-bit audit before it should be considered reliable.

## Build

Install SDL2 once:

```sh
brew install sdl2
```

Configure and build:

```sh
cmake -S . -B build/macos -DCMAKE_BUILD_TYPE=Debug
cmake --build build/macos -j 8
```

The executable is:

```sh
build/macos/doom-macos
```

## Run

The source release does not include game data. Run with a legal IWAD:

```sh
./build/macos/doom-macos -iwad /path/to/DOOM.WAD
```

The macOS port skips built-in title demos because some IWAD demo lumps do not
match this source version. To test gameplay directly, warp into the first map:

```sh
./build/macos/doom-macos -iwad ./DOOM.WAD -warp 1 1
```

Running without an IWAD should end cleanly with:

```text
Error: W_InitFiles: no files found
```

## Next Steps

The most useful next step is a 64-bit audit of save/load. After that, the core
can be migrated module-by-module to C++ while keeping the behavior close to the
released source.
