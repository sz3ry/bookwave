# Bookwave

Unofficial desktop player for Storytel and Audioteka audiobooks, built with TypeScript, React, Fastify and Electron.
Based on [debba/storytel-player](https://github.com/debba/storytel-player).

> [!NOTE]
> This is an independent project, not affiliated with Storytel or Audioteka.

## Download

Get the latest build from the [Releases page](https://github.com/sz3ry/bookwave/releases/latest):
- **Linux (x64)**: AppImage or deb
- **Windows (x64)**: NSIS installer

Bookwave checks for updates on startup and can install them automatically.

## Login

Accounts created through Google or Apple sign-in cannot log in directly. Set a password in the Storytel account panel first, then sign in to Bookwave with your email and that password.

Audioteka accounts sign in on the real audioteka.com page, opened in a Bookwave window. Bookwave never sees or stores your Audioteka password, only its session tokens (refresh and access token) and a device id, encrypted with your operating system's keyring.

## Features

- **Library**: browse your Storytel bookshelf with cover art, progress tracking and status filters
- **Catalog search**: search the active service's catalog by title, author or narrator (Ctrl+K); Storytel results are scoped to your account's market
- **Discover**: the active service's front page with its tabs and rows, right next to catalog search
- **Series hints**: see whether a book is part 1 of a series or which part comes next, and jump to it
- **Continue series**: a row on the dashboard that offers the next part of series you have finished
- **Player**: chapters, bookmarks, playback speed, sleep timer, multiple audio tracks and automatic resume
- **Background playback**: a persistent mini-player with play/pause, skip, speed, chapters and sleep timer
- **Offline listening**: download Storytel audiobooks for offline playback
- **Audioteka**: discover, search, author lists, book pages with series and recommendations, adding to and removing from your library, with position sync to your other devices (Bookwave asks which position to use when they differ by more than 30 seconds)
- **One service at a time**: if you are logged in to both, pick the active service in Settings; switching saves your position and shows the other service's last book, paused
- **Desktop integration**: system tray and single instance lock
- **Internationalization**: English, German, Spanish, Finnish, French, Italian, Polish and Swedish, with the interface language following your operating system
- **Logging**: HTTP and action logs, exportable for debugging, with automatic rotation

## Audioteka limits

- only Club audiobooks are shown (search, Discover, lists and recommendations)
- no offline downloads or bookmarks: these stay Storytel-only
- adding to and removing from your library uses Audioteka favourites; books on your shelf or recently played show as in your library but can be removed only when they are favourites
- search depends on a public Audioteka search key; if Audioteka changes it, search shows as unavailable until Bookwave is updated
- books you cannot listen to are greyed out

## Development

Requirements: [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun run electron:dev   # Electron in development mode (Vite on port 3000)
```

Build distributables (output in `dist/`):

```bash
bun run dist:linux     # AppImage + deb (x64)
bun run dist:win       # NSIS installer (x64)
```

Project layout:
- `client/` - React renderer (Vite, Tailwind CSS, i18next)
- `server/` - Fastify server bundled with esbuild, translations in `server/locales/`
- `src/` - Electron main process (window, tray, IPC, updater)

See [AGENTS.md](AGENTS.md) for engineering guidelines.

## License

MIT. See [LICENSE](LICENSE).
