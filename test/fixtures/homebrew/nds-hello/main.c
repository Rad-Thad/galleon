// Galleon's Nintendo DS test payload: a program that prints one line of text
// and waits, so a device check can see the emulator boot a ROM and show a
// frame without any game in the bundle.
#include <stdio.h>

#include <nds.h>

int main(void)
{
    consoleDemoInit();
    printf("Galleon Nintendo DS test payload\n");
    for (;;)
        swiWaitForVBlank();
    return 0;
}
