// Galleon's PS2 test payload: a program that draws one line of text and
// waits, so a device check can see the emulator boot a disc and show a frame
// without any game in the bundle.
#include <debug.h>
#include <kernel.h>

int main(void)
{
    init_scr();
    scr_printf("Galleon PS2 test payload\n");
    SleepThread();
    return 0;
}
