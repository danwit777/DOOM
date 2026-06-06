#include <SDL.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

extern "C" {
#include "doomstat.h"
#include "i_sound.h"
#include "i_system.h"
#include "w_wad.h"
#include "z_zone.h"
}

namespace
{
constexpr int kSampleCount = 512;
constexpr int kNumChannels = 8;
constexpr int kSampleRate = 11025;
constexpr int kMaxVolume = 127;

SDL_AudioDeviceID audio_device = 0;
bool sound_ready = false;
bool channels_initialized = false;

int lengths[NUMSFX]{};
unsigned int channelstep[kNumChannels]{};
unsigned int channelstepremainder[kNumChannels]{};
unsigned char* channels[kNumChannels]{};
unsigned char* channelsend[kNumChannels]{};
int channelstart[kNumChannels]{};
int channelhandles[kNumChannels]{};
int channelids[kNumChannels]{};
int steptable[256]{};
int vol_lookup[128 * 256]{};
int* channelleftvol_lookup[kNumChannels]{};
int* channelrightvol_lookup[kNumChannels]{};

void lock_audio()
{
    if (audio_device)
        SDL_LockAudioDevice(audio_device);
}

void unlock_audio()
{
    if (audio_device)
        SDL_UnlockAudioDevice(audio_device);
}

int fallback_sfx_lump(const char* sfxname)
{
    char name[20];
    std::snprintf(name, sizeof(name), "ds%s", sfxname);

    const int lump = W_CheckNumForName(name);
    if (lump != -1)
        return lump;

    return W_GetNumForName("dspistol");
}

void* cache_sfx(const char* sfxname, int* len)
{
    const int sfxlump = fallback_sfx_lump(sfxname);
    const int size = W_LumpLength(sfxlump);
    auto* sfx = static_cast<unsigned char*>(W_CacheLumpNum(sfxlump, PU_STATIC));

    const int payload_size = std::max(0, size - 8);
    const int paddedsize = ((payload_size + (kSampleCount - 1)) / kSampleCount) * kSampleCount;
    auto* paddedsfx = static_cast<unsigned char*>(Z_Malloc(paddedsize + 8, PU_STATIC, 0));

    std::memcpy(paddedsfx, sfx, size);
    for (int i = size; i < paddedsize + 8; ++i)
        paddedsfx[i] = 128;

    Z_Free(sfx);
    *len = paddedsize;
    return paddedsfx + 8;
}

void ensure_sfx_cached(int sfxid)
{
    if (sfxid <= 0 || sfxid >= NUMSFX)
        return;

    if (S_sfx[sfxid].data)
        return;

    if (!S_sfx[sfxid].link)
    {
        S_sfx[sfxid].data = cache_sfx(S_sfx[sfxid].name, &lengths[sfxid]);
        return;
    }

    const int linked = static_cast<int>(S_sfx[sfxid].link - S_sfx);
    ensure_sfx_cached(linked);
    S_sfx[sfxid].data = S_sfx[sfxid].link->data;
    lengths[sfxid] = lengths[linked];
}

void set_channel_params(int slot, int volume, int separation, int pitch)
{
    volume = std::clamp(volume, 0, kMaxVolume);
    pitch = std::clamp(pitch, 0, 255);

    separation += 1;
    int leftvol = volume - ((volume * separation * separation) >> 16);
    separation -= 257;
    int rightvol = volume - ((volume * separation * separation) >> 16);

    leftvol = std::clamp(leftvol, 0, kMaxVolume);
    rightvol = std::clamp(rightvol, 0, kMaxVolume);

    channelstep[slot] = steptable[pitch];
    channelleftvol_lookup[slot] = &vol_lookup[leftvol * 256];
    channelrightvol_lookup[slot] = &vol_lookup[rightvol * 256];
}

int add_sfx(int sfxid, int volume, int pitch, int separation)
{
    static unsigned short handlenums = 100;

    ensure_sfx_cached(sfxid);
    if (!S_sfx[sfxid].data || lengths[sfxid] <= 0)
        return sfxid;

    if (sfxid == sfx_sawup
        || sfxid == sfx_sawidl
        || sfxid == sfx_sawful
        || sfxid == sfx_sawhit
        || sfxid == sfx_stnmov
        || sfxid == sfx_pistol)
    {
        for (int i = 0; i < kNumChannels; ++i)
        {
            if (channels[i] && channelids[i] == sfxid)
                channels[i] = nullptr;
        }
    }

    int oldest = gametic;
    int oldestnum = 0;
    int slot = 0;
    for (; slot < kNumChannels && channels[slot]; ++slot)
    {
        if (channelstart[slot] < oldest)
        {
            oldestnum = slot;
            oldest = channelstart[slot];
        }
    }

    if (slot == kNumChannels)
        slot = oldestnum;

    channels[slot] = static_cast<unsigned char*>(S_sfx[sfxid].data);
    channelsend[slot] = channels[slot] + lengths[sfxid];
    channelstepremainder[slot] = 0;
    channelstart[slot] = gametic;
    channelids[slot] = sfxid;

    if (!handlenums)
        handlenums = 100;
    channelhandles[slot] = handlenums++;

    set_channel_params(slot, volume, separation, pitch);
    return channelhandles[slot];
}

void mix_audio(Sint16* out, int frames)
{
    for (int frame = 0; frame < frames; ++frame)
    {
        int dl = 0;
        int dr = 0;

        for (int chan = 0; chan < kNumChannels; ++chan)
        {
            if (!channels[chan])
                continue;

            const unsigned int sample = *channels[chan];
            dl += channelleftvol_lookup[chan][sample];
            dr += channelrightvol_lookup[chan][sample];

            channelstepremainder[chan] += channelstep[chan];
            channels[chan] += channelstepremainder[chan] >> 16;
            channelstepremainder[chan] &= 65536 - 1;

            if (channels[chan] >= channelsend[chan])
                channels[chan] = nullptr;
        }

        *out++ = static_cast<Sint16>(std::clamp(dl, -0x8000, 0x7fff));
        *out++ = static_cast<Sint16>(std::clamp(dr, -0x8000, 0x7fff));
    }
}

void audio_callback(void*, Uint8* stream, int len)
{
    if (!channels_initialized)
    {
        std::memset(stream, 0, len);
        return;
    }

    mix_audio(reinterpret_cast<Sint16*>(stream), len / (2 * static_cast<int>(sizeof(Sint16))));
}
}

extern "C" {

void I_InitSound(void)
{
    if ((SDL_WasInit(SDL_INIT_AUDIO) & SDL_INIT_AUDIO) == 0)
    {
        if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0)
        {
            std::fprintf(stderr, "I_InitSound: SDL audio unavailable: %s\n", SDL_GetError());
            return;
        }
    }

    SDL_AudioSpec desired{};
    desired.freq = kSampleRate;
    desired.format = AUDIO_S16SYS;
    desired.channels = 2;
    desired.samples = kSampleCount;
    desired.callback = audio_callback;

    SDL_AudioSpec obtained{};
    audio_device = SDL_OpenAudioDevice(nullptr, 0, &desired, &obtained, 0);
    if (!audio_device)
    {
        std::fprintf(stderr, "I_InitSound: SDL_OpenAudioDevice failed: %s\n", SDL_GetError());
        return;
    }

    if (obtained.freq != desired.freq
        || obtained.format != desired.format
        || obtained.channels != desired.channels)
    {
        std::fprintf(stderr, "I_InitSound: SDL audio device did not accept DOOM format\n");
        SDL_CloseAudioDevice(audio_device);
        audio_device = 0;
        return;
    }

    for (int i = 1; i < NUMSFX; ++i)
        ensure_sfx_cached(i);

    std::fprintf(stderr, "I_InitSound: SDL audio ready, pre-cached sound data\n");
    sound_ready = true;
}

void I_ShutdownSound(void)
{
    if (!audio_device)
        return;

    SDL_PauseAudioDevice(audio_device, 1);
    SDL_CloseAudioDevice(audio_device);
    audio_device = 0;
    sound_ready = false;
    channels_initialized = false;
}

void I_UpdateSound(void) {}
void I_SubmitSound(void) {}

void I_SetChannels(void)
{
    int* steptablemid = steptable + 128;

    for (int i = 0; i < kNumChannels; ++i)
    {
        channels[i] = nullptr;
        channelsend[i] = nullptr;
        channelhandles[i] = 0;
        channelids[i] = 0;
    }

    for (int i = -128; i < 128; ++i)
        steptablemid[i] = static_cast<int>(std::pow(2.0, i / 64.0) * 65536.0);

    for (int i = 0; i < 128; ++i)
    {
        for (int j = 0; j < 256; ++j)
            vol_lookup[i * 256 + j] = (i * (j - 128) * 256) / 127;
    }

    channels_initialized = true;

    if (sound_ready && audio_device)
        SDL_PauseAudioDevice(audio_device, 0);
}

int I_GetSfxLumpNum(sfxinfo_t* sfxinfo)
{
    return fallback_sfx_lump(sfxinfo->name);
}

int I_StartSound(int id, int vol, int sep, int pitch, int priority)
{
    (void)priority;

    if (!sound_ready)
        return id;

    lock_audio();
    const int handle = add_sfx(id, vol, pitch, sep);
    unlock_audio();

    return handle;
}

void I_StopSound(int handle)
{
    lock_audio();
    for (int i = 0; i < kNumChannels; ++i)
    {
        if (channelhandles[i] == handle)
            channels[i] = nullptr;
    }
    unlock_audio();
}

int I_SoundIsPlaying(int handle)
{
    int playing = 0;

    lock_audio();
    for (int i = 0; i < kNumChannels; ++i)
    {
        if (channels[i] && channelhandles[i] == handle)
        {
            playing = 1;
            break;
        }
    }
    unlock_audio();

    return playing;
}

void I_UpdateSoundParams(int handle, int vol, int sep, int pitch)
{
    lock_audio();
    for (int i = 0; i < kNumChannels; ++i)
    {
        if (channels[i] && channelhandles[i] == handle)
            set_channel_params(i, vol, sep, pitch);
    }
    unlock_audio();
}

}
