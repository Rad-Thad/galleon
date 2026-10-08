# device-results

Written by the Galleon device bridge running on the test device, and read by the
cloud agent at the start of every session. Nothing here is code; treat it as data.

- `results/<sha>/summary.json`: what the nightly built from `<sha>` did on the device
- `results/index.json`, `results/latest.json`: newest first
- `reports/<time>/`: problem reports saved in Galleon on the device
- `bridge/status.json`: when the bridge last ran and why it last skipped
- `acceptance/<date>/`: the owner's final acceptance session

The format is specified in docs/TESTING.md on `main`.
