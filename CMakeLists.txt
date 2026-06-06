cmake_minimum_required(VERSION 3.22)

project(experimental_doom_macos LANGUAGES C CXX OBJCXX)

set(CMAKE_C_STANDARD 90)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED sdl2)

set(DOOM_DIR "${CMAKE_CURRENT_SOURCE_DIR}/linuxdoom-1.10")

set(DOOM_ENGINE_SOURCES
    ${DOOM_DIR}/doomdef.c
    ${DOOM_DIR}/doomstat.c
    ${DOOM_DIR}/dstrings.c
    ${DOOM_DIR}/tables.c
    ${DOOM_DIR}/f_finale.c
    ${DOOM_DIR}/f_wipe.c
    ${DOOM_DIR}/d_main.c
    ${DOOM_DIR}/d_net.c
    ${DOOM_DIR}/d_items.c
    ${DOOM_DIR}/g_game.c
    ${DOOM_DIR}/m_menu.c
    ${DOOM_DIR}/m_misc.c
    ${DOOM_DIR}/m_argv.c
    ${DOOM_DIR}/m_bbox.c
    ${DOOM_DIR}/m_fixed.c
    ${DOOM_DIR}/m_swap.c
    ${DOOM_DIR}/m_cheat.c
    ${DOOM_DIR}/m_random.c
    ${DOOM_DIR}/am_map.c
    ${DOOM_DIR}/p_ceilng.c
    ${DOOM_DIR}/p_doors.c
    ${DOOM_DIR}/p_enemy.c
    ${DOOM_DIR}/p_floor.c
    ${DOOM_DIR}/p_inter.c
    ${DOOM_DIR}/p_lights.c
    ${DOOM_DIR}/p_map.c
    ${DOOM_DIR}/p_maputl.c
    ${DOOM_DIR}/p_plats.c
    ${DOOM_DIR}/p_pspr.c
    ${DOOM_DIR}/p_setup.c
    ${DOOM_DIR}/p_sight.c
    ${DOOM_DIR}/p_spec.c
    ${DOOM_DIR}/p_switch.c
    ${DOOM_DIR}/p_mobj.c
    ${DOOM_DIR}/p_telept.c
    ${DOOM_DIR}/p_tick.c
    ${DOOM_DIR}/p_saveg.c
    ${DOOM_DIR}/p_user.c
    ${DOOM_DIR}/r_bsp.c
    ${DOOM_DIR}/r_data.c
    ${DOOM_DIR}/r_draw.c
    ${DOOM_DIR}/r_main.c
    ${DOOM_DIR}/r_plane.c
    ${DOOM_DIR}/r_segs.c
    ${DOOM_DIR}/r_sky.c
    ${DOOM_DIR}/r_things.c
    ${DOOM_DIR}/w_wad.c
    ${DOOM_DIR}/wi_stuff.c
    ${DOOM_DIR}/v_video.c
    ${DOOM_DIR}/st_lib.c
    ${DOOM_DIR}/st_stuff.c
    ${DOOM_DIR}/hu_stuff.c
    ${DOOM_DIR}/hu_lib.c
    ${DOOM_DIR}/s_sound.c
    ${DOOM_DIR}/z_zone.c
    ${DOOM_DIR}/info.c
    ${DOOM_DIR}/sounds.c
)

add_library(doom-core STATIC
    ${DOOM_ENGINE_SOURCES}
)

target_compile_definitions(doom-core PUBLIC
    NORMALUNIX
    DOOM_EXPERIMENTAL_MACOS
)

target_include_directories(doom-core PUBLIC
    ${DOOM_DIR}
)

add_executable(doom-macos
    macos/i_av_midi.mm
    macos/i_main_macos.cpp
    macos/i_net_stub.cpp
    macos/i_sdl_sound.cpp
    macos/i_sdl_system.cpp
    macos/i_sdl_video.cpp
)

target_include_directories(doom-macos PRIVATE
    ${SDL2_INCLUDE_DIRS}
)

target_link_directories(doom-macos PRIVATE ${SDL2_LIBRARY_DIRS})
target_link_libraries(doom-macos PRIVATE
    doom-core
    ${SDL2_LIBRARIES}
    m
    "-framework Foundation"
    "-framework AVFoundation"
)
target_compile_options(doom-macos PRIVATE
    ${SDL2_CFLAGS_OTHER}
    $<$<COMPILE_LANGUAGE:CXX>:-Wno-write-strings>
    $<$<COMPILE_LANGUAGE:CXX>:-Wno-format>
    $<$<COMPILE_LANGUAGE:CXX>:-Wno-deprecated-declarations>
    $<$<COMPILE_LANGUAGE:CXX>:-Wno-deprecated-non-prototype>
    $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>
    $<$<COMPILE_LANGUAGE:OBJCXX>:-Wno-deprecated-declarations>
)
