#include <SDL.h>

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>

extern "C" {
#include "d_net.h"
#include "doomdef.h"
#include "g_game.h"
#include "i_sound.h"
#include "i_system.h"
#include "i_video.h"
#include "m_misc.h"
}

extern "C" {
int mb_used = 6;

void I_Tactile(int on, int off, int total)
{
    (void)on;
    (void)off;
    (void)total;
}

ticcmd_t emptycmd;

ticcmd_t* I_BaseTiccmd(void)
{
    return &emptycmd;
}

int I_GetHeapSize(void)
{
    return mb_used * 1024 * 1024;
}

byte* I_ZoneBase(int* size)
{
    *size = mb_used * 1024 * 1024;
    return static_cast<byte*>(std::malloc(*size));
}

int I_GetTime(void)
{
    static Uint64 base_counter = 0;
    const Uint64 counter = SDL_GetPerformanceCounter();
    const Uint64 frequency = SDL_GetPerformanceFrequency();

    if (!base_counter)
        base_counter = counter;

    return static_cast<int>(((counter - base_counter) * TICRATE) / frequency);
}

void I_Init(void)
{
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER | SDL_INIT_EVENTS) != 0)
        I_Error("SDL_Init failed: %s", SDL_GetError());

    I_InitSound();
}

void I_Quit(void)
{
    D_QuitNetGame();
    I_ShutdownSound();
    I_ShutdownMusic();
    M_SaveDefaults();
    I_ShutdownGraphics();
    SDL_Quit();
    std::exit(0);
}

void I_WaitVBL(int count)
{
    SDL_Delay(static_cast<Uint32>(count * (1000 / 70)));
}

void I_BeginRead(void) {}
void I_EndRead(void) {}

byte* I_AllocLow(int length)
{
    byte* mem = static_cast<byte*>(std::malloc(length));
    std::memset(mem, 0, length);
    return mem;
}

extern boolean demorecording;

void I_Error(char* error, ...)
{
    va_list argptr;

    std::fprintf(stderr, "Error: ");
    va_start(argptr, error);
    std::vfprintf(stderr, error, argptr);
    va_end(argptr);
    std::fprintf(stderr, "\n");
    std::fflush(stderr);

    if (demorecording)
        G_CheckDemoStatus();

    D_QuitNetGame();
    I_ShutdownGraphics();
    SDL_Quit();
    std::exit(-1);
}
}
