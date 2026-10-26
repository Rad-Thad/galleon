// Galleon's PSP test payload: a program that draws one line of text and
// waits, so a device check can see the emulator boot an EBOOT.PBP and show a
// frame without any game in the bundle.
#include <pspkernel.h>
#include <pspdebug.h>
#include <pspdisplay.h>

PSP_MODULE_INFO("galleon-psp-hello", 0, 1, 0);
PSP_MAIN_THREAD_ATTR(THREAD_ATTR_USER);

int main(void)
{
    pspDebugScreenInit();
    pspDebugScreenPrintf("\n\n  Galleon PSP test payload\n");
    for (;;)
        sceDisplayWaitVblankStart();
    return 0;
}
