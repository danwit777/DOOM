#include <SDL.h>

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>

extern "C" {
#include "d_main.h"
#include "doomdef.h"
#include "doomstat.h"
#include "i_system.h"
#include "i_video.h"
#include "m_argv.h"
#include "v_video.h"
}

namespace
{
constexpr int kScale = 3;

SDL_Window* window = nullptr;
SDL_Renderer* renderer = nullptr;
SDL_Texture* texture = nullptr;
std::array<SDL_Color, 256> palette{};
std::array<Uint32, SCREENWIDTH * SCREENHEIGHT> rgba_buffer{};
boolean graphics_initialized = false;

int translate_key(SDL_Keycode key)
{
    switch (key)
    {
    case SDLK_LEFT: return KEY_LEFTARROW;
    case SDLK_RIGHT: return KEY_RIGHTARROW;
    case SDLK_DOWN: return KEY_DOWNARROW;
    case SDLK_UP: return KEY_UPARROW;
    case SDLK_ESCAPE: return KEY_ESCAPE;
    case SDLK_RETURN: return KEY_ENTER;
    case SDLK_TAB: return KEY_TAB;
    case SDLK_F1: return KEY_F1;
    case SDLK_F2: return KEY_F2;
    case SDLK_F3: return KEY_F3;
    case SDLK_F4: return KEY_F4;
    case SDLK_F5: return KEY_F5;
    case SDLK_F6: return KEY_F6;
    case SDLK_F7: return KEY_F7;
    case SDLK_F8: return KEY_F8;
    case SDLK_F9: return KEY_F9;
    case SDLK_F10: return KEY_F10;
    case SDLK_F11: return KEY_F11;
    case SDLK_F12: return KEY_F12;
    case SDLK_BACKSPACE:
    case SDLK_DELETE:
        return KEY_BACKSPACE;
    case SDLK_PAUSE: return KEY_PAUSE;
    case SDLK_EQUALS: return KEY_EQUALS;
    case SDLK_MINUS: return KEY_MINUS;
    case SDLK_LSHIFT:
    case SDLK_RSHIFT:
        return KEY_RSHIFT;
    case SDLK_LCTRL:
    case SDLK_RCTRL:
        return KEY_RCTRL;
    case SDLK_LALT:
    case SDLK_RALT:
    case SDLK_LGUI:
    case SDLK_RGUI:
        return KEY_RALT;
    default:
        break;
    }

    if (key >= SDLK_SPACE && key <= SDLK_z)
        return static_cast<int>(key);

    return 0;
}

void post_key_event(evtype_t type, SDL_Keycode key)
{
    const int translated = translate_key(key);
    if (!translated)
        return;

    event_t event;
    event.type = type;
    event.data1 = translated;
    event.data2 = 0;
    event.data3 = 0;
    D_PostEvent(&event);
}
}

extern "C" void I_StartFrame(void) {}

extern "C" void I_StartTic(void)
{
    SDL_Event sdl_event;
    while (SDL_PollEvent(&sdl_event))
    {
        switch (sdl_event.type)
        {
        case SDL_QUIT:
            I_Quit();
            break;
        case SDL_KEYDOWN:
            post_key_event(ev_keydown, sdl_event.key.keysym.sym);
            break;
        case SDL_KEYUP:
            post_key_event(ev_keyup, sdl_event.key.keysym.sym);
            break;
        case SDL_MOUSEMOTION:
        {
            event_t event;
            event.type = ev_mouse;
            event.data1 = SDL_GetMouseState(nullptr, nullptr) & 0x7;
            event.data2 = sdl_event.motion.xrel << 2;
            event.data3 = -sdl_event.motion.yrel << 2;
            D_PostEvent(&event);
            break;
        }
        case SDL_MOUSEBUTTONDOWN:
        case SDL_MOUSEBUTTONUP:
        {
            event_t event;
            event.type = ev_mouse;
            event.data1 = SDL_GetMouseState(nullptr, nullptr) & 0x7;
            event.data2 = 0;
            event.data3 = 0;
            D_PostEvent(&event);
            break;
        }
        default:
            break;
        }
    }
}

extern "C" void I_ShutdownGraphics(void)
{
    if (!graphics_initialized)
        return;

    if (texture)
    {
        SDL_DestroyTexture(texture);
        texture = nullptr;
    }
    if (renderer)
    {
        SDL_DestroyRenderer(renderer);
        renderer = nullptr;
    }
    if (window)
    {
        SDL_DestroyWindow(window);
        window = nullptr;
    }

    graphics_initialized = false;
}

extern "C" void I_UpdateNoBlit(void) {}

extern "C" void I_FinishUpdate(void)
{
    if (!graphics_initialized || !screens[0])
        return;

    if (devparm)
    {
        static int lasttic = 0;
        int tics = I_GetTime() - lasttic;
        lasttic = I_GetTime();
        if (tics > 20)
            tics = 20;

        int i = 0;
        for (; i < tics * 2; i += 2)
            screens[0][(SCREENHEIGHT - 1) * SCREENWIDTH + i] = 0xff;
        for (; i < 20 * 2; i += 2)
            screens[0][(SCREENHEIGHT - 1) * SCREENWIDTH + i] = 0x0;
    }

    for (int i = 0; i < SCREENWIDTH * SCREENHEIGHT; ++i)
    {
        const SDL_Color color = palette[screens[0][i]];
        rgba_buffer[i] = 0xff000000u
            | (static_cast<Uint32>(color.r) << 16)
            | (static_cast<Uint32>(color.g) << 8)
            | static_cast<Uint32>(color.b);
    }

    SDL_UpdateTexture(texture, nullptr, rgba_buffer.data(), SCREENWIDTH * sizeof(Uint32));
    SDL_RenderClear(renderer);
    SDL_RenderCopy(renderer, texture, nullptr, nullptr);
    SDL_RenderPresent(renderer);
}

extern "C" void I_ReadScreen(byte* scr)
{
    std::memcpy(scr, screens[0], SCREENWIDTH * SCREENHEIGHT);
}

extern "C" void I_SetPalette(byte* new_palette)
{
    for (int i = 0; i < 256; ++i)
    {
        palette[i].r = gammatable[usegamma][*new_palette++];
        palette[i].g = gammatable[usegamma][*new_palette++];
        palette[i].b = gammatable[usegamma][*new_palette++];
        palette[i].a = 255;
    }
}

extern "C" void I_InitGraphics(void)
{
    if (graphics_initialized)
        return;

    if ((SDL_WasInit(SDL_INIT_VIDEO) & SDL_INIT_VIDEO) == 0)
    {
        if (SDL_InitSubSystem(SDL_INIT_VIDEO) != 0)
            I_Error("SDL video init failed: %s", SDL_GetError());
    }

    window = SDL_CreateWindow(
        "Experimental DOOM macOS",
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        SCREENWIDTH * kScale,
        SCREENHEIGHT * kScale,
        SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);

    if (!window)
        I_Error("SDL_CreateWindow failed: %s", SDL_GetError());

    renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!renderer)
        I_Error("SDL_CreateRenderer failed: %s", SDL_GetError());

    SDL_RenderSetLogicalSize(renderer, SCREENWIDTH, SCREENHEIGHT);

    texture = SDL_CreateTexture(
        renderer,
        SDL_PIXELFORMAT_ARGB8888,
        SDL_TEXTUREACCESS_STREAMING,
        SCREENWIDTH,
        SCREENHEIGHT);

    if (!texture)
        I_Error("SDL_CreateTexture failed: %s", SDL_GetError());

    screens[0] = static_cast<byte*>(std::malloc(SCREENWIDTH * SCREENHEIGHT));
    if (!screens[0])
        I_Error("Unable to allocate primary screen");

    std::memset(screens[0], 0, SCREENWIDTH * SCREENHEIGHT);
    graphics_initialized = true;
}
