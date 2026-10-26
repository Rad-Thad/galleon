# Buildbot core index

`linux-aarch64-cores.txt` lists the core files the libretro buildbot publishes for Linux on aarch64, one per line: the file names in `https://buildbot.libretro.com/nightly/linux/aarch64/latest/.index-extended`, without their dates, hashes or `.zip`. It was read on 2026-10-26.

`registry.test.ts` checks every RetroArch launch variant against it, so the player is never offered a core RetroArch cannot load on the Nova. To refresh it:

```sh
curl -sS https://buildbot.libretro.com/nightly/linux/aarch64/latest/.index-extended \
  | awk '{print $3}' | sed 's/\.zip$//' | sort -u > test/fixtures/buildbot/linux-aarch64-cores.txt
```
