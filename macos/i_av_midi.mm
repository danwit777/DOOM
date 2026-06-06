#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

#include <cstdint>
#include <cstdio>
#include <algorithm>
#include <unordered_map>
#include <vector>

extern "C" {
#include "doomstat.h"
}

namespace
{
constexpr uint16_t kMidiDivision = 70;
constexpr int kMusPercussionChannel = 15;
constexpr int kMidiPercussionChannel = 9;

const char* kDlsSoundBank = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls";

struct Song
{
    std::vector<uint8_t> midi;
};

std::unordered_map<int, Song> songs;
int next_handle = 1;
int current_handle = 0;
bool current_looping = false;
int music_volume = 8;
NSTimeInterval pause_position = 0.0;
static __strong AVMIDIPlayer* current_player = nil;

uint16_t read_le16(const uint8_t* ptr)
{
    return static_cast<uint16_t>(ptr[0] | (ptr[1] << 8));
}

void put_u16(std::vector<uint8_t>& out, uint16_t value)
{
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
    out.push_back(static_cast<uint8_t>(value & 0xff));
}

void put_u32(std::vector<uint8_t>& out, uint32_t value)
{
    out.push_back(static_cast<uint8_t>((value >> 24) & 0xff));
    out.push_back(static_cast<uint8_t>((value >> 16) & 0xff));
    out.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
    out.push_back(static_cast<uint8_t>(value & 0xff));
}

void put_var_len(std::vector<uint8_t>& out, uint32_t value)
{
    uint8_t buffer[5];
    int count = 0;

    buffer[count++] = static_cast<uint8_t>(value & 0x7f);
    while ((value >>= 7) != 0)
        buffer[count++] = static_cast<uint8_t>((value & 0x7f) | 0x80);

    while (count--)
        out.push_back(buffer[count]);
}

uint32_t read_mus_var_len(const uint8_t*& in)
{
    uint32_t value = 0;
    uint8_t byte = 0;

    do
    {
        byte = *in++;
        value = value * 128 + (byte & 0x7f);
    } while (byte & 0x80);

    return value;
}

uint32_t read_midi_var_len(const uint8_t*& in)
{
    uint32_t value = 0;
    uint8_t byte = 0;

    do
    {
        byte = *in++;
        value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);

    return value;
}

uint8_t scaled_midi_value(uint8_t value)
{
    const double scale = (static_cast<double>(music_volume) / 15.0) * 0.75;
    int scaled = static_cast<int>(value * scale + 0.5);
    if (value > 0 && music_volume > 0 && scaled == 0)
        scaled = 1;
    if (music_volume == 0)
        scaled = 0;
    return static_cast<uint8_t>(std::max(0, std::min(127, scaled)));
}

int midi_event_data_length(uint8_t status)
{
    switch (status & 0xf0)
    {
    case 0xc0:
    case 0xd0:
        return 1;
    default:
        return 2;
    }
}

int midi_channel_for_mus(int mus_channel, int channel_map[16], int& next_channel)
{
    if (mus_channel == kMusPercussionChannel)
        return kMidiPercussionChannel;

    if (channel_map[mus_channel] < 0)
    {
        while (next_channel == kMidiPercussionChannel)
            ++next_channel;
        channel_map[mus_channel] = next_channel++;
    }

    return channel_map[mus_channel];
}

void midi_event(std::vector<uint8_t>& track, uint32_t& pending_delta, uint8_t status, uint8_t a, uint8_t b)
{
    put_var_len(track, pending_delta);
    pending_delta = 0;
    track.push_back(status);
    track.push_back(a);
    track.push_back(b);
}

void midi_event1(std::vector<uint8_t>& track, uint32_t& pending_delta, uint8_t status, uint8_t a)
{
    put_var_len(track, pending_delta);
    pending_delta = 0;
    track.push_back(status);
    track.push_back(a);
}

bool mus_to_midi(const void* mus_data, std::vector<uint8_t>& midi)
{
    static const uint8_t controller_map[15] = {
        0, 32, 1, 7, 10, 11, 91, 93, 64, 67, 120, 123, 126, 127, 121
    };

    auto* mus = static_cast<const uint8_t*>(mus_data);
    if (!mus || mus[0] != 'M' || mus[1] != 'U' || mus[2] != 'S' || mus[3] != 0x1a)
        return false;

    const uint16_t score_start = read_le16(mus + 6);
    const uint8_t* in = mus + score_start;

    std::vector<uint8_t> track;
    uint32_t pending_delta = 0;
    int channel_map[16];
    int channel_volume[16];
    int next_channel = 0;

    for (int i = 0; i < 16; ++i)
    {
        channel_map[i] = -1;
        channel_volume[i] = 64;
    }

    put_var_len(track, 0);
    track.push_back(0xff);
    track.push_back(0x51);
    track.push_back(0x03);
    track.push_back(0x07);
    track.push_back(0xa1);
    track.push_back(0x20);

    bool done = false;
    while (!done)
    {
        bool last_in_group = false;

        while (!last_in_group && !done)
        {
            const uint8_t descriptor = *in++;
            const int mus_channel = descriptor & 0x0f;
            const int event_type = (descriptor >> 4) & 0x07;
            const int midi_channel = midi_channel_for_mus(mus_channel, channel_map, next_channel);
            last_in_group = (descriptor & 0x80) != 0;

            switch (event_type)
            {
            case 0:
            {
                const uint8_t note = static_cast<uint8_t>(*in++ & 0x7f);
                midi_event(track, pending_delta, static_cast<uint8_t>(0x80 | midi_channel), note, 64);
                break;
            }
            case 1:
            {
                uint8_t note = *in++;
                if (note & 0x80)
                {
                    note &= 0x7f;
                    channel_volume[mus_channel] = *in++ & 0x7f;
                }
                midi_event(track, pending_delta, static_cast<uint8_t>(0x90 | midi_channel), note, static_cast<uint8_t>(channel_volume[mus_channel]));
                break;
            }
            case 2:
            {
                const uint8_t wheel = *in++;
                const uint8_t lsb = static_cast<uint8_t>((wheel & 1) << 6);
                const uint8_t msb = static_cast<uint8_t>((wheel >> 1) & 0x7f);
                midi_event(track, pending_delta, static_cast<uint8_t>(0xe0 | midi_channel), lsb, msb);
                break;
            }
            case 3:
            {
                const uint8_t controller = *in++;
                if (controller < 15)
                    midi_event(track, pending_delta, static_cast<uint8_t>(0xb0 | midi_channel), controller_map[controller], 0);
                break;
            }
            case 4:
            {
                const uint8_t controller = *in++;
                const uint8_t value = static_cast<uint8_t>(*in++ & 0x7f);
                if (controller == 0)
                {
                    midi_event1(track, pending_delta, static_cast<uint8_t>(0xc0 | midi_channel), value);
                }
                else if (controller < 15)
                {
                    midi_event(track, pending_delta, static_cast<uint8_t>(0xb0 | midi_channel), controller_map[controller], value);
                }
                break;
            }
            case 6:
                done = true;
                break;
            default:
                return false;
            }
        }

        if (last_in_group && !done)
            pending_delta += read_mus_var_len(in);
    }

    put_var_len(track, pending_delta);
    track.push_back(0xff);
    track.push_back(0x2f);
    track.push_back(0x00);

    midi.clear();
    midi.insert(midi.end(), {'M', 'T', 'h', 'd'});
    put_u32(midi, 6);
    put_u16(midi, 0);
    put_u16(midi, 1);
    put_u16(midi, kMidiDivision);
    midi.insert(midi.end(), {'M', 'T', 'r', 'k'});
    put_u32(midi, static_cast<uint32_t>(track.size()));
    midi.insert(midi.end(), track.begin(), track.end());

    return true;
}

std::vector<uint8_t> build_playback_midi(const std::vector<uint8_t>& base)
{
    if (base.size() < 22)
        return base;

    const uint8_t* in = base.data() + 22;
    const uint8_t* end = base.data() + base.size();
    std::vector<uint8_t> track;

    while (in < end)
    {
        const uint32_t delta = read_midi_var_len(in);
        if (in >= end)
            break;

        const uint8_t status = *in++;
        put_var_len(track, delta);
        track.push_back(status);

        if (status == 0xff)
        {
            if (in >= end)
                break;

            const uint8_t meta_type = *in++;
            const uint32_t length = read_midi_var_len(in);
            track.push_back(meta_type);
            put_var_len(track, length);

            for (uint32_t i = 0; i < length && in < end; ++i)
                track.push_back(*in++);
            continue;
        }

        const int data_len = midi_event_data_length(status);
        if (in + data_len > end)
            break;

        if ((status & 0xf0) == 0x90)
        {
            const uint8_t note = *in++;
            const uint8_t velocity = *in++;
            track.push_back(note);
            track.push_back(scaled_midi_value(velocity));
        }
        else if ((status & 0xf0) == 0xb0 && data_len == 2)
        {
            const uint8_t controller = *in++;
            const uint8_t value = *in++;
            track.push_back(controller);
            track.push_back(value);
        }
        else
        {
            for (int i = 0; i < data_len; ++i)
                track.push_back(*in++);
        }
    }

    std::vector<uint8_t> midi;
    midi.insert(midi.end(), base.begin(), base.begin() + 14);
    midi.insert(midi.end(), {'M', 'T', 'r', 'k'});
    put_u32(midi, static_cast<uint32_t>(track.size()));
    midi.insert(midi.end(), track.begin(), track.end());
    return midi;
}

NSURL* sound_bank_url()
{
    NSString* path = [NSString stringWithUTF8String:kDlsSoundBank];
    if ([[NSFileManager defaultManager] fileExistsAtPath:path])
        return [NSURL fileURLWithPath:path];

    return nil;
}

void play_current_player()
{
    AVMIDIPlayer* player = current_player;
    if (!player)
        return;

    [player prepareToPlay];
    [player play:^{
        if (current_looping && current_player == player)
        {
            current_player.currentPosition = 0.0;
            play_current_player();
        }
    }];
}

void start_song(int handle, bool looping, NSTimeInterval position)
{
    auto it = songs.find(handle);
    if (it == songs.end())
        return;

    if (current_player)
        [current_player stop];

    const std::vector<uint8_t> playback_midi = build_playback_midi(it->second.midi);
    NSData* data = [NSData dataWithBytes:playback_midi.data() length:playback_midi.size()];
    NSError* error = nil;
    current_player = [[AVMIDIPlayer alloc] initWithData:data soundBankURL:sound_bank_url() error:&error];
    if (!current_player)
    {
        std::fprintf(stderr, "I_PlaySong: AVMIDIPlayer failed: %s\n", [[error localizedDescription] UTF8String]);
        current_handle = 0;
        return;
    }

    current_handle = handle;
    current_looping = looping;
    pause_position = position;
    current_player.currentPosition = position;
    play_current_player();
}
}

extern "C" {

void I_InitMusic(void)
{
}

void I_ShutdownMusic(void)
{
    if (current_player)
        [current_player stop];
    current_player = nil;
    songs.clear();
    current_handle = 0;
}

void I_SetMusicVolume(int volume)
{
    if (volume > 15)
        return;

    music_volume = std::max(0, std::min(15, volume));
    snd_MusicVolume = music_volume;

    if (current_player && current_handle)
        start_song(current_handle, current_looping, current_player.currentPosition);
}

void I_PauseSong(int handle)
{
    if (handle != current_handle || !current_player)
        return;

    pause_position = current_player.currentPosition;
    [current_player stop];
}

void I_ResumeSong(int handle)
{
    if (handle != current_handle || !current_player)
        return;

    current_player.currentPosition = pause_position;
    play_current_player();
}

int I_RegisterSong(void* data)
{
    Song song;
    if (!mus_to_midi(data, song.midi))
    {
        std::fprintf(stderr, "I_RegisterSong: could not convert MUS lump to MIDI\n");
        return 0;
    }

    const int handle = next_handle++;
    songs.emplace(handle, std::move(song));
    return handle;
}

void I_PlaySong(int handle, int looping)
{
    start_song(handle, looping != 0, 0.0);
}

void I_StopSong(int handle)
{
    if (handle != current_handle)
        return;

    if (current_player)
        [current_player stop];

    current_player = nil;
    current_handle = 0;
    current_looping = false;
}

void I_UnRegisterSong(int handle)
{
    songs.erase(handle);
}

}
