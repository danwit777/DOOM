extern "C" {
#include "d_main.h"
#include "doomdef.h"
#include "m_argv.h"
}

int main(int argc, char** argv)
{
    myargc = argc;
    myargv = argv;

    D_DoomMain();
    return 0;
}
