#include <cstdlib>
#include <cstring>

extern "C" {
#include "d_net.h"
#include "doomstat.h"
#include "i_net.h"
}

extern "C"
void I_InitNetwork(void)
{
    doomcom = static_cast<doomcom_t*>(std::malloc(sizeof(*doomcom)));
    std::memset(doomcom, 0, sizeof(*doomcom));

    netgame = false;
    doomcom->id = DOOMCOM_ID;
    doomcom->ticdup = 1;
    doomcom->extratics = 0;
    doomcom->deathmatch = false;
    doomcom->consoleplayer = 0;
    doomcom->numplayers = 1;
    doomcom->numnodes = 1;
}

extern "C"
void I_NetCmd(void)
{
    doomcom->remotenode = -1;
}
