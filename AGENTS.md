# Agent Development Guidelines for Bookwave

## Project Overview

**Bookwave** is an unofficial desktop application for playing Storytel audiobooks (Linux x64: AppImage and deb; Windows x64: NSIS), built with TypeScript, React, Fastify, and Electron.

### Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite
- **Backend**: Fastify 5 + TypeScript
- **Desktop**: Electron 43
- **Internationalization**: i18next (multi-language support)
- **State Management**: electron-store for persistent storage
- **Build Tools**: Vite, esbuild, electron-builder

### Architecture

```
bookwave/
├── client/          # React frontend application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── services/    # API services
│   │   ├── utils/       # Utility functions
│   │   └── i18n.ts      # i18next configuration
│   └── package.json
├── server/          # Fastify backend server
│   ├── storytelApi.ts   # Storytel API integration
│   ├── session.ts       # In-process Storytel session (one account)
│   ├── locales/         # Translation files
│   └── package.json
├── src/             # Electron main process
│   ├── modules/         # Electron modules (IPC, window, tray, etc.)
│   ├── main.ts          # Electron entry point
│   └── preload.ts       # Electron preload script
└── package.json     # Root package.json
```

## Development Guidelines

### Language Requirements

#### Code and Documentation

- **ALL documentation files** (README, CONTRIBUTING, AGENTS.md, etc.) **MUST be written in English**
- **ALL code comments** MUST be written in English
- **ALL commit messages** MUST be written in English
- **ALL variable names, function names, and identifiers** MUST be in English

#### User-Facing Content

- **ALL user-facing text** (UI labels, messages, errors) MUST use the i18n translation system
- Never hardcode user-facing strings in components
- Always add new strings to translation files in `server/locales/`

#### Translation System

- **Location**: Translation files are in `server/locales/`
  - `server/locales/en.json` - English translations (default)
  - `server/locales/it.json` - Italian translations
  - Add more languages as needed

- **Usage in Frontend**:

  ```typescript
  import { useTranslation } from 'react-i18next';

  function MyComponent() {
    const { t } = useTranslation();
    return <div>{t('key.name')}</div>;
  }
  ```

- **Usage in Backend**:

  ```typescript
  // Server automatically provides translations via API
  // Use i18next instance configured in server
  ```

- **Adding New Translations**:
  1. Add the key to `server/locales/en.json`
  2. Add translations to all other language files (`it.json`, etc.)
  3. Use the key in your component with `t('your.new.key')`

- **Adding a New Language**: the supported-language list exists once per build
  target, because the renderer (Vite), the Electron main process (tsc) and the
  server (esbuild) do not share a module graph. Update all four in lockstep:
  1. `server/locales/<code>.json` — full key parity with `en.json`
  2. `server/fastify-common.ts` — add the loader to `LOCALE_LOADERS`
  3. `client/src/config/languages.ts` — add code + endonym to `APP_LANGUAGES`
  4. `src/i18n/languages.ts` — add the code to `SUPPORTED_LANGUAGES`

- **UI Language vs. Catalog Language**: they are unrelated and must not be
  conflated. The UI language follows the OS only: `app.getPreferredSystemLanguages()`
  in main and `navigator.languages` in the renderer, negotiated with
  `negotiateLanguage` (English fallback). There is no manual picker, so the app
  never mixes a chosen UI language with the account's market headings;
  which books exist, and in which languages, is decided by the country of the
  logged-in Storytel account. Never derive one from the other — a `sv-FI`
  system locale means "Swedish speaker in Finland", not "Finnish catalog".
  Language _names_ shown in the UI are produced locally with
  `Intl.DisplayNames` (see `localizedLanguageName` in `client/src/utils/helpers.ts`);
  the `languageName` the Storytel API returns is localized for the account's
  market, not for the app UI, so it is only a last-resort fallback.

### Code Style

- **TypeScript**: Strict mode enabled, use proper typing
- **React**: Functional components with hooks
- **CSS**: Tailwind CSS utility classes
- **Formatting and linting**: Biome (`bun run check`); the pre-commit hook runs
  `biome check --write` on staged files and CI runs `bunx biome ci .`

### Component Patterns

- Use existing modal components as reference (see `client/src/components/*Modal.tsx`)
- Follow existing hook patterns (see `client/src/hooks/`)
- Maintain consistent UI/UX with Tailwind classes already in use
- Reuse common components when possible

### State Management

- **Local State**: React hooks (useState, useEffect, etc.)
- **Persistent Storage**: Use `electron-store` via IPC for desktop persistence
- **API State**: Direct API calls through the `window.electronApi` IPC bridge (see `client/src/utils/api.ts`)

### Development Workflow

1. **Install dependencies**: `bun install` (Bun workspaces: `bookwave-client`, `bookwave-server`)
2. **Electron dev**: `bun run electron:dev` (builds server and main process, starts Vite on :3000)
3. **Build**: `bun run build:all` (client, server and Electron main process)
4. **Typecheck**: `bun run typecheck`
5. **Tests**: `bun run test` (Bun test runner, `*.test.ts` next to the code)
6. **Lint/format**: `bun run check`
7. **Distribution**: `bun run dist:linux` / `bun run dist:win` (x64 only)

### Release Flow

Releases are cut by release-please from `develop`: Conventional Commits pushed
to `develop` keep a release PR up to date (version bump, `CHANGELOG.md`,
`src/version.ts`). Merging that PR publishes a GitHub release, which triggers
`build.yml` to build the Linux and Windows packages and upload them to the
release. A manual run of `build.yml` only builds and never publishes.

There is no browser mode: the app only runs inside Electron (from the Electron-only restructuring onward). The Fastify server runs in-process inside the Electron main process.

### Testing Strategy

- Unit tests with `bun run test` (server, Storytel client, session, main-process auth)
- Manual testing in development mode
- Test across platforms (Windows, Linux)
- Verify i18n translations for all supported languages
- Test both online and offline modes

## Project-Specific Patterns

### Modal Components

- Follow the pattern in existing modal components
- Use proper state management with hooks
- Include proper TypeScript interfaces
- Ensure proper i18n integration

### Storage Keys

- Use descriptive names for storage keys
- Document storage schema in code comments
- Use TypeScript interfaces for stored data structures

### API Integration

- Backend API calls go through `client/src/utils/api.ts`
- Storytel API integration is in `server/storytelApi.ts`
- Handle errors gracefully with user feedback

### IPC Communication

- Electron IPC handlers are in `src/modules/ipc.ts`; the bridges are exposed in `src/preload.ts`
- Frontend uses the `window.electronApi`, `window.electronAuth`, `window.electronStore`,
  `window.electronLocale`, `window.electronWindow`, `window.electronLogs` and
  `window.trayControls` bridges (typed in `client/src/types/window.d.ts`; `electronApi`
  in `client/src/utils/api.ts`, `electronStore` in `client/src/utils/storage.ts`)
- Always handle both success and error cases

## Important Notes

- **Security**: The renderer never sees a Storytel token or the password. Storytel
  tokens live in memory in the in-process server session (`server/session.ts`);
  app logs mask tokens, the account email and login replies
- **Authentication**: The main process's `AuthManager` (`src/modules/auth.ts`) logs
  in through the session and stores the credentials encrypted with Electron
  `safeStorage` (OS keyring); without a usable keyring the session lasts for the
  current run only. The renderer uses `window.electronAuth` (login/logout/state)
- **Single Instance**: App uses single instance lock (one app instance at a time)
- **Updates**: Electron updater is integrated for auto-updates
- **Offline Mode**: Support for downloading audiobooks for offline playback

## Git Repository

- **Repository**: https://github.com/sz3ry/bookwave
- **Issues**: https://github.com/sz3ry/bookwave/issues
- **Releases**: https://github.com/sz3ry/bookwave/releases

## License

MIT License - see LICENSE file for details

---

**Remember**:
1. Documentation and code in English
2. User-facing content via i18n system
3. Follow existing patterns in the codebase
4. Test thoroughly before committing
