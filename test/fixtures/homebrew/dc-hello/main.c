// Galleon's Dreamcast test payload: a program that draws one line of text and
// waits, so a device check can see the emulator boot an ELF and show a frame
// without any game in the bundle. The text comes from the BIOS font, which
// Flycast's HLE BIOS provides too.
#include <dc/biosfont.h>
#include <dc/video.h>

int main(void)
{
    vid_clear(0, 0, 0);
    bfont_set_encoding(BFONT_CODE_ISO8859_1);
    bfont_draw_str(vram_s + 640 * BFONT_HEIGHT * 2 + BFONT_THIN_WIDTH * 2, 640, 1,
                   "Galleon Dreamcast test payload");
    for (;;)
        vid_waitvbl();
    return 0;
}
