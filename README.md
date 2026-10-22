# Bookwave

Unofficial desktop player for Storytel audiobooks, built with TypeScript, React, Fastify and Electron.
Based on [debba/storytel-player](https://github.com/debba/storytel-player).

> [!NOTE]
> This is an independent project, not affiliated with Storytel.

## Download

Get the latest build from the [Releases page](https://github.com/sz3ry/bookwave/releases/latest):
- **Linux (x64)**: AppImage or deb
- **Windows (x64)**: NSIS installer

Bookwave checks for updates on startup and can install them automatically.

## Login

Accounts created through Google or Apple sign-in cannot log in directly. Set a password in the Storytel account panel first, then sign in to Bookwave with your email and that password.

## Features

- **Library**: browse your Storytel bookshelf with cover art, progress tracking and status filters
- **Catalog search**: search the whole catalog by title, author or narrator (Ctrl+K), scoped to your Storytel market
- **Player**: chapters, bookmarks, playback speed, sleep timer, multiple audio tracks and automatic resume
- **Background playback**: a persistent mini-player with play/pause, skip, speed, chapters and sleep timer
- **Offline listening**: download audiobooks for offline playback
- **Desktop integration**: system tray and single instance lock
- **Internationalization**: English, German, Spanish, Finnish, French, Italian, Polish and Swedish, with the interface language following your operating system
- **Logging**: HTTP and action logs, exportable for debugging, with automatic rotation

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
