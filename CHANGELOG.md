# Changelog

## [1.2.0](https://github.com/sz3ry/bookwave/compare/v1.1.0...v1.2.0) (2026-10-22)


### Features

* add audio tracks support, market-scoped search, clean playback teardown, and ebook filtering ([8a6b35d](https://github.com/sz3ry/bookwave/commit/8a6b35d7ae191927e11bb16a8c24b8e5b75dca06))
* add session expiration handling across client and server ([09c12ca](https://github.com/sz3ry/bookwave/commit/09c12ca90800803907e56f4738c94645e085715b))
* **auth:** keep credentials in safeStorage in the main process ([6fe3e47](https://github.com/sz3ry/bookwave/commit/6fe3e47e0e73a94793d08da9addd5927153f942b))
* **auth:** log in through the main process and drop token storage ([55ac53a](https://github.com/sz3ry/bookwave/commit/55ac53a673bb01660b2c61c31294b260cd7a8dd5))
* **bookshelf:** add timestamps for sorting books by listening recency ([d467a29](https://github.com/sz3ry/bookwave/commit/d467a298e8b9f557b4759b80776d3f4cad5af447))
* **client:** add logs modal and search hotkeys, increase timeouts ([cda8c45](https://github.com/sz3ry/bookwave/commit/cda8c45179c13622abfcd16076326fdc84ea6daf))
* **client:** add welcome and settings modals with i18n ([ce56fda](https://github.com/sz3ry/bookwave/commit/ce56fdae4ddf3fa7f2efd1d54d907004bd88e2db))
* **core:** add action logging and multi-language support ([8cdfdbf](https://github.com/sz3ry/bookwave/commit/8cdfdbfd5cda1837d3248090a7dae88b7f0b68ca))
* **dashboard:** show downloaded books with an offline notice when Storytel is unreachable ([79185cd](https://github.com/sz3ry/bookwave/commit/79185cd0f4e539a5f30c191218ec49b38902c1d8))
* **docs:** add separate macOS Intel and Apple Silicon downloads ([091c8b5](https://github.com/sz3ry/bookwave/commit/091c8b5d47bc251c4c4489508f7789e32d4fa733))
* **download:** name downloaded files after the audiobook title ([2ca1e2d](https://github.com/sz3ry/bookwave/commit/2ca1e2d71e7cf4f74755c37483229820c3627bdb))
* **download:** name downloaded files after the audiobook title ([cc2f553](https://github.com/sz3ry/bookwave/commit/cc2f55384710d276071630d9fa7ad49b338430cf)), closes [#42](https://github.com/sz3ry/bookwave/issues/42)
* **electron:** add development scripts and improve server startup ([064dede](https://github.com/sz3ry/bookwave/commit/064dede3110522135da098dd9aba51393ef36fec))
* **error:** keep header visible and add logout on bookshelf error ([465ee99](https://github.com/sz3ry/bookwave/commit/465ee997adb82dd5fd28f38829181d7bc04a327b))
* **error:** keep header visible and add logout on bookshelf error ([1f91d0e](https://github.com/sz3ry/bookwave/commit/1f91d0e539c3581ee197297e7d84a057b764ba25))
* **http:** add fetch-based Storytel request wrapper ([7486146](https://github.com/sz3ry/bookwave/commit/748614621095bc21ae7fd4305bd0b846c17dbefa))
* **i18n:** add Polish translation ([017145f](https://github.com/sz3ry/bookwave/commit/017145f3589dfc25085888f663369fa6056f4d82))
* manage download removal ([afd366d](https://github.com/sz3ry/bookwave/commit/afd366dd5dee119a6bc91227a5a22b4b6e45fc3a))
* modern UI redesign, global background playback, and catalog search ([070158b](https://github.com/sz3ry/bookwave/commit/070158bc8f4b28aa862e5d8304b63dd7aa7b01a3))
* modern UI redesign, global background playback, and catalog search ([3ef3904](https://github.com/sz3ry/bookwave/commit/3ef3904ccf22866e05aa3dfd45b84b04a3a628c1))
* **offline:** index downloaded books and serve them from an offline bookshelf route ([503d8ed](https://github.com/sz3ry/bookwave/commit/503d8ed45c06445b72c332bd801129540f9a66ff))
* **server:** add /api/account endpoint and email translation ([1215db1](https://github.com/sz3ry/bookwave/commit/1215db1b99f7bfa1c05add42d0c14a8e2a060bcc))
* **server:** add log rotation and size limit for logger ([37e75a5](https://github.com/sz3ry/bookwave/commit/37e75a57c1a52ed0b0606b3540a403c3bb006fcc))
* **settings-modal:** add toggle for always-on-top window setting ([0bf0c31](https://github.com/sz3ry/bookwave/commit/0bf0c3133b9f69e7d5dbb964652660f8857ea1b7))
* **sso:** add SSO login flow and offline fallbacks ([abdbe98](https://github.com/sz3ry/bookwave/commit/abdbe98e8edb4477ad909e033c5b12aee8661377))
* **storytel:** migrate bookshelf and book details to api.storytel.net ([45e98fc](https://github.com/sz3ry/bookwave/commit/45e98fcee9bbbc937193b9520d385f8571cdd493))
* **storytel:** stream audio via api.storytel.net assets endpoint ([de62e46](https://github.com/sz3ry/bookwave/commit/de62e46af97eb3a7e82c8f5d38bbb21a5e551435))
* **tray:** add platform-specific tray icons and use nativeImage ([058087c](https://github.com/sz3ry/bookwave/commit/058087cf97ce1eeb20298668242b40d2429a167b))
* **ui:** implement modern desktop layout, 3-column catalog search, and 1280x800 window sizing ([22abfdb](https://github.com/sz3ry/bookwave/commit/22abfdb062f079a0200878d136d1fc6d1315d5cb))


### Bug Fixes

* always show action buttons in BookInfo component ([fefc49a](https://github.com/sz3ry/bookwave/commit/fefc49a2459bcf94bed7d6b4c2015754facb5abe))
* **api:** fail a Storytel login that returns no token without ending the session ([d588235](https://github.com/sz3ry/bookwave/commit/d5882354057dd66172ee4b5ca13c2ce60fe1e7fc))
* **api:** never retry after the login itself rejects the credentials ([6cd1ab7](https://github.com/sz3ry/bookwave/commit/6cd1ab7c261520e774c28f1985fb4fc8d94b4ee3))
* **auth:** add static token caching, automatic session refresh, and transparent 401 retry ([be8a022](https://github.com/sz3ry/bookwave/commit/be8a02281541995f55678cfa29d6687e376ba414))
* **auth:** keep stored credentials when the keyring cannot decrypt them ([2f02a7c](https://github.com/sz3ry/bookwave/commit/2f02a7ce571f54321133e8b94a65a50b819e6f40))
* **auth:** leave KWallet detection to Electron on KDE desktops ([a7129a0](https://github.com/sz3ry/bookwave/commit/a7129a067f80c5c0a23331a56ba7374132fac626))
* **auth:** register auth IPC before the window loads and answer once credentials are restored ([bb63ff2](https://github.com/sz3ry/bookwave/commit/bb63ff2dc25cf8d3c75eba8222af74650652e72e))
* **auth:** restore Firebase token refresh ([e9a5cef](https://github.com/sz3ry/bookwave/commit/e9a5cef78ca6aea5cf27452915d3cae4bb16765f))
* **auth:** use libsecret on unknown Linux desktops and never drop credentials on a fallback backend ([e5f04f8](https://github.com/sz3ry/bookwave/commit/e5f04f846dc6b445779d1f5ccb306ecfff5dbe4b))
* **bookmarks:** close create bookmark modal on cancel/close ([d130f52](https://github.com/sz3ry/bookwave/commit/d130f52c6f85225a4ed8d28359ddb004247d9179))
* **bookshelf:** correct status mapping for API states ([5b05a53](https://github.com/sz3ry/bookwave/commit/5b05a53e9742a1156683dd7c383835c2034a62c0))
* changed README assets ([ae0fbab](https://github.com/sz3ry/bookwave/commit/ae0fbabcdebc942433a178faddb78e1262005934))
* **ci:** bump electron-builder to fix macOS signing ([97d4c3d](https://github.com/sz3ry/bookwave/commit/97d4c3dd9c0f1631cc09905a53eca45cea9c3b07))
* **ci:** bump electron-builder to fix macOS signing on newer runners ([cf87d17](https://github.com/sz3ry/bookwave/commit/cf87d17b032869776f46dbb5263bcb0662cf4eaf))
* **core:** improve 401 handling and error propagation across IPC ([006fa5b](https://github.com/sz3ry/bookwave/commit/006fa5bfcbf83b43779483f87ae3d97098c4d146))
* correct status mapping and add book sorting by timestamps ([9573836](https://github.com/sz3ry/bookwave/commit/957383690edfffbeef883ccd20f043cddb218e52))
* **dashboard:** ignore stale bookshelf loads and fall back offline only on network errors ([3a3ea7e](https://github.com/sz3ry/bookwave/commit/3a3ea7eaa31d1f52c2b7a8eb2d3a978fc4a1df3c))
* **dashboard:** return to the online bookshelf automatically when Storytel is reachable again ([4b4435e](https://github.com/sz3ry/bookwave/commit/4b4435e7d8345cf04b4bfdfe0d9db7720c3e5964))
* **download:** keep a newer download tracked when a cancelled one finishes ([4b88bfb](https://github.com/sz3ry/bookwave/commit/4b88bfb46cce1a23c391da5a904441ffc066fb08))
* **electron:** set quitting flag and always quit on window close ([b15345b](https://github.com/sz3ry/bookwave/commit/b15345ba2777dc31bd58721699c1dac2c1ba278c))
* emit error in case of network issue ([7858388](https://github.com/sz3ry/bookwave/commit/7858388da5fc87258636c84d772a21e5d042cded))
* ensure workflow does not create multiple draft releases ([88d606d](https://github.com/sz3ry/bookwave/commit/88d606d39d88c9981859b219027797181ad4eea2))
* ensure workflow does not create multiple draft releases ([6641782](https://github.com/sz3ry/bookwave/commit/6641782ca00e3c1d7ba9d5e97e2d522ee6b5b0c8))
* filteredBooks don't take care about ebooks ([3403687](https://github.com/sz3ry/bookwave/commit/3403687909bc846db18395e1a5e43122c2734890))
* filteredBooks don't take care about ebooks ([b0c2ce9](https://github.com/sz3ry/bookwave/commit/b0c2ce9ac629b6783c74a4de18ed41e7d1687a75))
* goToPosition sometimes did not work as expected ([f44745f](https://github.com/sz3ry/bookwave/commit/f44745f614242c7e51a82d756c92a295fb132074))
* **http:** parse JSON-looking bodies and let caller headers override ([8def447](https://github.com/sz3ry/bookwave/commit/8def447757759fc63b722c7130f34c08957f46ef))
* **i18n:** localize remaining UI strings ([ce4f91d](https://github.com/sz3ry/bookwave/commit/ce4f91de694d95f567416c228c72c78ca541e19b))
* **i18n:** localize remaining UI strings ([90b4fea](https://github.com/sz3ry/bookwave/commit/90b4feac575bcfdc34c76d7443beee7290423994))
* **i18n:** translate remaining chapter time in player ([b6116cb](https://github.com/sz3ry/bookwave/commit/b6116cb655961b914d886625eb2b30fbc28c1143))
* **i18n:** translate remaining chapter time in player ([d3a1a03](https://github.com/sz3ry/bookwave/commit/d3a1a0329e5857a219bd91ab4c9e9f6ea7046cab)), closes [#41](https://github.com/sz3ry/bookwave/issues/41)
* **i18n:** translate the 'All' library filter pill ([26faa40](https://github.com/sz3ry/bookwave/commit/26faa40e484733ed922b3de61f140ad71e9d6085))
* JWT token check ([e630de0](https://github.com/sz3ry/bookwave/commit/e630de08b8aa46dcf6e54370664523201ebb7819))
* **linux:** use registered freedesktop categories (1.4.1) ([5340276](https://github.com/sz3ry/bookwave/commit/53402761fef54a044b0939e4b9386a93df814782))
* **linux:** use registered freedesktop categories in the desktop entry ([4932233](https://github.com/sz3ry/bookwave/commit/49322330e49edd3efd6fa542be1948ea0f1490fb))
* **logs:** redact tokens, account email and login replies from app logs ([9ced2e0](https://github.com/sz3ry/bookwave/commit/9ced2e00c144347e6f79ce4f592013acb027baab))
* **player:** fix switching audiobooks from search results while playing ([66c2979](https://github.com/sz3ry/bookwave/commit/66c29798ed08acdc6ab20e249f8af7616aaf127b))
* **player:** serve downloaded books over a custom protocol so they play in dev and packaged builds ([fbd411d](https://github.com/sz3ry/bookwave/commit/fbd411dee9a9df3d501deae679ef6bae0905c954))
* README.md ([1c7bfb8](https://github.com/sz3ry/bookwave/commit/1c7bfb8a7923b4a540d9cc9c61e102dc8f3e2a5d))
* **release:** restore docs site and fix macOS download links ([87bc555](https://github.com/sz3ry/bookwave/commit/87bc5553d59b6cc70c100321e2b4a6422f438897))
* remove unused ts-expect-error directives ([83f492a](https://github.com/sz3ry/bookwave/commit/83f492a03a0dd1d40223f66485e95415517fcaff))
* **server:** encode Storytel login params ([da15430](https://github.com/sz3ry/bookwave/commit/da15430f6b5e5bfc53c916c0c3f1158d04022eeb))
* **server:** encode Storytel login params and propagate 401 errors ([6a776ec](https://github.com/sz3ry/bookwave/commit/6a776ec10965eec93cf469aba1b46a6852a074fd))
* **server:** guard session against stale logins and log in before URL-token calls ([bcdd0b7](https://github.com/sz3ry/bookwave/commit/bcdd0b7b73df9e5d96d63bde4ec87306f68092d8))
* **server:** propagate Storytel 401 login errors ([6cbcd17](https://github.com/sz3ry/bookwave/commit/6cbcd1760d493639facf26454b8e9aa0888a7cfe))
* **server:** remove duplicate Italian translation import and response ([f5981f5](https://github.com/sz3ry/bookwave/commit/f5981f54c1138feeb3ef8a25f621ec4c143977ab))
* set timeout for external API calls ([ab4f09b](https://github.com/sz3ry/bookwave/commit/ab4f09be4d43d8f439ec2e6cd20d2cbd60498f4b))
* **sso:** add retry logic and error logging for firebase token extraction ([a6cf8d5](https://github.com/sz3ry/bookwave/commit/a6cf8d5d9e0d953d526d669ad8ef715f873de3f7))
* **sso:** add retry logic and error logging for firebase token extraction ([ff020bf](https://github.com/sz3ry/bookwave/commit/ff020bf9ad0d6f84fef6a888346e6e6d73b21054))
* **tray:** set template image on macOS tray icon ([27ae4d1](https://github.com/sz3ry/bookwave/commit/27ae4d132de810b634064c68f57a79f50aa2fcd3))
* **ui:** label the floating play button by its action and give book cards singular status labels ([c273c6f](https://github.com/sz3ry/bookwave/commit/c273c6f82db68442eccc52f3d26e105f35b37dc4))
* updated README.md ([2aa501b](https://github.com/sz3ry/bookwave/commit/2aa501b106477310aef2359f5665e8198a433b5c))
* use new Storytel assets endpoint for audiobook download ([0abc0ff](https://github.com/sz3ry/bookwave/commit/0abc0ff899d302539562508b72cbea8cc03526af)), closes [#26](https://github.com/sz3ry/bookwave/issues/26)
* workflow ([cbf5973](https://github.com/sz3ry/bookwave/commit/cbf59732dadce80e1dd5c42c59913431f483ff69))

## [1.1.0](https://github.com/sz3ry/bookwave/compare/v1.0.0...v1.1.0) (2026-10-22)


### Features

* **i18n:** add Polish translation ([017145f](https://github.com/sz3ry/bookwave/commit/017145f3589dfc25085888f663369fa6056f4d82))


### Bug Fixes

* **ui:** label the floating play button by its action and give book cards singular status labels ([c273c6f](https://github.com/sz3ry/bookwave/commit/c273c6f82db68442eccc52f3d26e105f35b37dc4))

## 1.0.0 (2026-10-22)


### Features

* **auth:** keep credentials in safeStorage in the main process ([6fe3e47](https://github.com/sz3ry/bookwave/commit/6fe3e47e0e73a94793d08da9addd5927153f942b))
* **auth:** log in through the main process and drop token storage ([55ac53a](https://github.com/sz3ry/bookwave/commit/55ac53a673bb01660b2c61c31294b260cd7a8dd5))
* **dashboard:** show downloaded books with an offline notice when Storytel is unreachable ([79185cd](https://github.com/sz3ry/bookwave/commit/79185cd0f4e539a5f30c191218ec49b38902c1d8))
* **http:** add fetch-based Storytel request wrapper ([7486146](https://github.com/sz3ry/bookwave/commit/748614621095bc21ae7fd4305bd0b846c17dbefa))
* **offline:** index downloaded books and serve them from an offline bookshelf route ([503d8ed](https://github.com/sz3ry/bookwave/commit/503d8ed45c06445b72c332bd801129540f9a66ff))


### Bug Fixes

* **api:** fail a Storytel login that returns no token without ending the session ([d588235](https://github.com/sz3ry/bookwave/commit/d5882354057dd66172ee4b5ca13c2ce60fe1e7fc))
* **api:** never retry after the login itself rejects the credentials ([6cd1ab7](https://github.com/sz3ry/bookwave/commit/6cd1ab7c261520e774c28f1985fb4fc8d94b4ee3))
* **auth:** keep stored credentials when the keyring cannot decrypt them ([2f02a7c](https://github.com/sz3ry/bookwave/commit/2f02a7ce571f54321133e8b94a65a50b819e6f40))
* **auth:** leave KWallet detection to Electron on KDE desktops ([a7129a0](https://github.com/sz3ry/bookwave/commit/a7129a067f80c5c0a23331a56ba7374132fac626))
* **auth:** register auth IPC before the window loads and answer once credentials are restored ([bb63ff2](https://github.com/sz3ry/bookwave/commit/bb63ff2dc25cf8d3c75eba8222af74650652e72e))
* **auth:** use libsecret on unknown Linux desktops and never drop credentials on a fallback backend ([e5f04f8](https://github.com/sz3ry/bookwave/commit/e5f04f846dc6b445779d1f5ccb306ecfff5dbe4b))
* **dashboard:** ignore stale bookshelf loads and fall back offline only on network errors ([3a3ea7e](https://github.com/sz3ry/bookwave/commit/3a3ea7eaa31d1f52c2b7a8eb2d3a978fc4a1df3c))
* **dashboard:** return to the online bookshelf automatically when Storytel is reachable again ([4b4435e](https://github.com/sz3ry/bookwave/commit/4b4435e7d8345cf04b4bfdfe0d9db7720c3e5964))
* **download:** keep a newer download tracked when a cancelled one finishes ([4b88bfb](https://github.com/sz3ry/bookwave/commit/4b88bfb46cce1a23c391da5a904441ffc066fb08))
* **http:** parse JSON-looking bodies and let caller headers override ([8def447](https://github.com/sz3ry/bookwave/commit/8def447757759fc63b722c7130f34c08957f46ef))
* **logs:** redact tokens, account email and login replies from app logs ([9ced2e0](https://github.com/sz3ry/bookwave/commit/9ced2e00c144347e6f79ce4f592013acb027baab))
* **player:** serve downloaded books over a custom protocol so they play in dev and packaged builds ([fbd411d](https://github.com/sz3ry/bookwave/commit/fbd411dee9a9df3d501deae679ef6bae0905c954))
* remove unused ts-expect-error directives ([83f492a](https://github.com/sz3ry/bookwave/commit/83f492a03a0dd1d40223f66485e95415517fcaff))
* **server:** guard session against stale logins and log in before URL-token calls ([bcdd0b7](https://github.com/sz3ry/bookwave/commit/bcdd0b7b73df9e5d96d63bde4ec87306f68092d8))

## Changelog

Bookwave is based on [debba/storytel-player](https://github.com/debba/storytel-player); its history up to v1.4.1 lives there.
