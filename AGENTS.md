# Agent Development Guidelines for Bookwave

## Project Overview

**Bookwave** is an unofficial desktop application for playing Storytel and Audioteka audiobooks (Linux x64: AppImage and deb; Windows x64: NSIS), built with TypeScript, React, Fastify, and Electron.

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
│   │   ├── catalog/     # CatalogApi: the active service's search, Discover, series, book page
│   │   ├── components/  # React components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── playback/    # Provider-neutral playback: timeline, position sync, sources
│   │   ├── services/    # API services
│   │   ├── utils/       # Utility functions
│   │   └── i18n.ts      # i18next configuration
│   └── package.json
├── server/          # Fastify backend server
│   ├── fastify-common.ts # Entrypoint: Fastify app, sessions, shared routes
│   ├── storytel/        # Storytel client, session, downloads and routes
│   ├── cache.ts         # In-memory TTL cache (1 h) shared by both clients
│   ├── audioteka/       # Audioteka client, session, catalog.ts (product mapping),
│   │                    # search.ts (Algolia) and `/api/audioteka/*` routes
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
  negotiated with `negotiateLanguage` (English fallback) in main. Main's resolved
  language is authoritative: the renderer starts from `navigator.languages` and
  then adopts it. The UI language is never a manual choice, while Storytel's
  own headings follow the account's market, so the two can differ (an English OS
  with a Polish account shows an English UI with Polish headings);
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
- Storytel API integration is in `server/storytel/client.ts`
- Handle errors gracefully with user feedback

### IPC Communication

- Electron IPC handlers are in `src/modules/ipc.ts`; the bridges are exposed in `src/preload.ts`
- Frontend uses the `window.electronApi`, `window.electronAuth`, `window.electronStore`,
  `window.electronLocale`, `window.electronWindow`, `window.electronLogs` and
  `window.trayControls` bridges (typed in `client/src/types/window.d.ts`; `electronApi`
  in `client/src/utils/api.ts`, `electronStore` in `client/src/utils/storage.ts`)
- Always handle both success and error cases

## Important Notes

- **Security**: The renderer never sees a Storytel or Audioteka token, the
  password, or the Audioteka refresh id and device id. Tokens live in memory in the
  in-process server sessions (`server/storytel/session.ts`, `server/audioteka/session.ts`);
  app logs mask tokens, the account email and login replies
- **Authentication**: The main process's `AuthManager` (`src/modules/auth.ts`) logs
  in through the session and stores the credentials encrypted with Electron
  `safeStorage` (OS keyring); without a usable keyring the session lasts for the
  current run only. The renderer uses `window.electronAuth` (login/logout/state).
  Audioteka has its own `AudiotekaAuthManager` (`src/modules/audiotekaAuth.ts`):
  the user signs in on the real audioteka.com page in a Bookwave window
  (`src/modules/audiotekaLogin.ts`), so the password never reaches Bookwave; only
  the device id, refresh id, access token and its expiry are kept, encrypted with
  `safeStorage` under the `auth.audioteka` key
- **Single Instance**: App uses single instance lock (one app instance at a time)
- **Updates**: Electron updater is integrated for auto-updates
- **Offline Mode**: Support for downloading audiobooks for offline playback

## Providers

Storytel is the original provider; Audioteka is a second one. Bookwave shows one
service at a time (no merged library): the **active service**, chosen in Settings
(Service section), drives the library, search, Discover, book pages and the player.
- **Active service**: `ProvidersContext` exposes `active` / `setActive`; the choice is
  stored under `activeService` (`client/src/utils/activeService.ts`). At startup
  `resolveAndPersistActive` keeps the stored service while it is still logged in, else
  the owner of the legacy last session, else the only logged-in one (Storytel when both);
  a stored choice survives a temporary logout. Two accounts stay logged in; switching
  makes no login call and no reload
- **Switching** (`client/src/playback/serviceSwitch.ts`): pause, save the current
  position locally (not before the start position was applied, never 0), clear the
  active book, then restore the other service's last session
- **Storytel**: routes (`/api/*` without a provider segment), local keys
  (`pos:<consumableId>`, `downloads-index.json`) and the stored `auth.credentials`
  are unchanged
- **Audioteka**: routes live under `/api/audioteka/*` (`server/audioteka/routes.ts`),
  local positions under `pos:audioteka:<audiobookId>`. The client lives in
  `server/audioteka/client.ts`; read it before touching Audioteka code
- **Audioteka catalogue routes**: `search`, `discovery/chips|page/:slug|list|series/:id`,
  `book-details/:id`, `series-info/:id`, `POST library/add|remove`. Recommendation and
  book responses are cached per session for 1 h (`server/cache.ts`)
- **Club only**: Audioteka search, rows, lists, author lists and recommendations keep
  only audiobooks with `is_available_in_subscription === true` (`toCatalogBook` /
  `toCatalogBooks` in `server/audioteka/catalog.ts`, the single filter); rows left empty are not shown
- **Search (Algolia)**: Audioteka search goes through Algolia, not the app API. The
  application id and search key are public constants in `server/audioteka/search.ts`,
  copied by hand from the audioteka.com `_next/static/chunks` file that calls
  `initIndex`; they never reach the renderer and are not scraped at runtime. If
  Audioteka rotates the key, Algolia answers 401/403 and the route returns
  `503 { code: 'SEARCH_UNAVAILABLE' }`; the UI shows "search unavailable" and the rest
  keeps working. Refresh the constants from the bundle then
- **Catalog adapter** (`client/src/catalog/`): `CatalogApi` is the one interface the
  UI uses; `useCatalog()` returns the Storytel or Audioteka adapter for the active
  service. Search and Discover never branch on the provider; book pages and the
  Dashboard still do for route-bound or library-specific data (Storytel shelf entries,
  Audioteka library entries, series lookups). A book page whose route service is not
  the active one redirects to `/`. Book pages
  are `/book/:bookId` (Storytel) and `/book/audioteka/:bookId` (Audioteka)
- **User-Agent version gate**: the Audioteka API rejects outdated app versions, so
  the client sends `Audioteka/<current_version> (3550) Android/14 (Phone;Pixel 8)`
  with `<current_version>` read from `GET /v2/apps/config/android`
  (`app_version_config.current_version`), falling back to `3.55.0`
- **Playback**: the player works on a provider-neutral timeline of tracks
  (`client/src/playback/`); each provider supplies a source with its track URLs
  and position read/write. Local positions are saved every 15 s and never wait on
  the network. Audioteka positions are sent to the remote at most every 60 s
  while playing, plus on pause, book switch and app quit, and only when the
  position moved more than 1 s from the last remote-seen value (so an untouched
  book never overwrites a newer position from another device). When the remote and
  local positions differ by more than 30 s the user is asked which to use
- **Limits**: Audioteka has no offline downloads or bookmarks (download controls are
  hidden); these stay Storytel-only. Library add/remove on Audioteka is favourites
  (`AddToFavourites` / `RemoveFromFavourites`); only favourites are removable
- **Last session**: one record per service under `last_played_session:<provider>`
  (`lastSessionKey` in `client/src/playback/lastSession.ts`). Storytel keeps the shape
  `{ book, bookId, consumableId }`; an Audioteka book is stored as
  `{ provider: 'audioteka', entry }` (library entry, no secrets). The old single
  `last_played_session` is copied into its service's key on first launch and then
  removed

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
