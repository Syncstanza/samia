# Sami'a

Live Quran recitation display for masjids. Sami'a listens to the imam,
follows which verse is being recited, and shows the Arabic text with a
translation on the masjid TV. Free and fully offline.

By **Syncstanza**.

## Structure

| Folder | Purpose |
|---|---|
| `src/main` | Electron main process (kiosk window, startup) |
| `src/renderer` | TV display UI |
| `src/engine` | Speech recognition + verse matcher (worker) |
| `src/remote` | Phone remote page (local network) |
| `data/quran` | Quran text and translation (see ATTRIBUTION.md) |
| `models` | ASR models (downloaded, not committed) |
| `tools` | Test and benchmark scripts |
| `tests/audio` | Local test recordings (not committed) |
| `docs` | Spec and volunteer setup guide |

## License

Code: Apache-2.0. Quran text and translations keep their own licenses (see ATTRIBUTION.md).
