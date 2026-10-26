// Galleon's GameCube test payload: a program that draws one line of text and
// waits, so a device check can see the emulator boot a .dol and show a frame
// without any game in the bundle.
#include <gccore.h>
#include <stdio.h>

int main(void)
{
    VIDEO_Init();
    GXRModeObj *mode = VIDEO_GetPreferredMode(NULL);
    void *frame = MEM_K0_TO_K1(SYS_AllocateFramebuffer(mode));
    console_init(frame, 20, 20, mode->fbWidth, mode->xfbHeight,
                 mode->fbWidth * VI_DISPLAY_PIX_SZ);
    VIDEO_Configure(mode);
    VIDEO_SetNextFramebuffer(frame);
    VIDEO_SetBlack(FALSE);
    VIDEO_Flush();
    printf("\n\n  Galleon GameCube test payload\n");
    for (;;)
        VIDEO_WaitVSync();
    return 0;
}
