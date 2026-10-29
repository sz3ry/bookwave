# Changelog

## [1.5.1](https://github.com/sz3ry/bookwave/compare/v1.5.0...v1.5.1) (2026-10-28)


### Bug Fixes

* follow the storytel position moved on another device ([aa356ef](https://github.com/sz3ry/bookwave/commit/aa356efac5582c258295ba18d75b9c05316b2f82))

## [1.5.0](https://github.com/sz3ry/bookwave/compare/v1.4.0...v1.5.0) (2026-10-23)


### Features

* replace the storytel logo with the bookwave icon ([f0bbdfc](https://github.com/sz3ry/bookwave/commit/f0bbdfc4a409beb0e6b1d98b6ae17de577a831d0))


### Bug Fixes

* crop the tray icon so it fills the tray slot ([c42f19f](https://github.com/sz3ry/bookwave/commit/c42f19fe9031d76d0f5669bd9663c4961443a521))

## [1.4.0](https://github.com/sz3ry/bookwave/compare/v1.3.0...v1.4.0) (2026-10-23)


### Features

* **audioteka:** map the catalogue to the shared discovery shapes ([a9c9419](https://github.com/sz3ry/bookwave/commit/a9c9419a0cfb261b0f1bd4e265897b9e2641a4cd))
* **audioteka:** serve search, discovery and library routes ([e370d29](https://github.com/sz3ry/bookwave/commit/e370d29fb5ce1bdf6aa5e631dd364a8ca50680bf))
* **client:** add the active service and per-service last session ([f832bc1](https://github.com/sz3ry/bookwave/commit/f832bc15d06dc21d81958a2feac09b36ddfb8628))
* **client:** search and discover through the active service ([cef380f](https://github.com/sz3ry/bookwave/commit/cef380f85b35971c8f67e12da5e045d19717cc1e))
* **client:** show book pages and series for the active service ([e1f7edf](https://github.com/sz3ry/bookwave/commit/e1f7edfa196fb82aff2700598da73b1862178a5b))
* **client:** switch the active service in settings ([6be8d9b](https://github.com/sz3ry/bookwave/commit/6be8d9be111867693e71818f0610805a1f488687))
* **player:** pause and restore per service when switching ([36bc003](https://github.com/sz3ry/bookwave/commit/36bc003804fa43022f5c7ec4a515acc20d495510))


### Bug Fixes

* **audioteka:** add see-all cycle lists and keep session errors visible ([8320163](https://github.com/sz3ry/bookwave/commit/8320163b01f722ca188f07608386a0363ed919e7))
* **audioteka:** render a book page when one library list fails ([06799ba](https://github.com/sz3ry/bookwave/commit/06799ba261ee6795589b568b1816bf3872edbb2d))
* **client:** drop search results of an older query or the previous service ([f887fe8](https://github.com/sz3ry/bookwave/commit/f887fe8a23e36845607d8c69c2f23f452d937a86))
* **client:** keep the chosen service over an older state refresh ([9b9c613](https://github.com/sz3ry/bookwave/commit/9b9c613a02b6f26a23bbafaed37cdc8f89bbc5c3))
* **client:** keep the stored active service across a temporary logout ([5999779](https://github.com/sz3ry/bookwave/commit/59997795e23b81515cbd186d5ee1e5b4ca4db355))
* **client:** leave a book page of the inactive service for the library ([b05cf09](https://github.com/sz3ry/bookwave/commit/b05cf092888dd25ce6b5bee937f18428860242b7))
* **client:** show only the log-in banner for a logged-out active service ([83195d8](https://github.com/sz3ry/bookwave/commit/83195d8b2896edde6272179c647cdae304eda968))
* **player:** save no position on a switch before the start position is applied ([60fcd08](https://github.com/sz3ry/bookwave/commit/60fcd0879a0f4833cd07ebc12513735160e168f8))


### Performance Improvements

* **audioteka:** cache book data and series lookups per session ([71063a7](https://github.com/sz3ry/bookwave/commit/71063a7b2296f9f2c3f964dc9deee5c5b2f6ff8b))

## [1.3.0](https://github.com/sz3ry/bookwave/compare/v1.2.0...v1.3.0) (2026-10-23)


### Features

* **audioteka:** add API client with rotating token refresh ([bdcb980](https://github.com/sz3ry/bookwave/commit/bdcb980fa5417623eac662c1a6c80e78deae8906))
* **audioteka:** add response mappers for library, tracks and positions ([c7bcc73](https://github.com/sz3ry/bookwave/commit/c7bcc73f44ec4be4269c6fca5f6e0e7646303503))
* **audioteka:** add session and api routes ([41a16d3](https://github.com/sz3ry/bookwave/commit/41a16d3ab61334c815d8b89ae2e415f1233552c0))
* **audioteka:** log in through the audioteka.com page and keep the session ([09cfd72](https://github.com/sz3ry/bookwave/commit/09cfd722bc1fabe601fc067379fa06888bc39d1b))
* **audioteka:** play audioteka books with position sync ([fb14fe2](https://github.com/sz3ry/bookwave/commit/fb14fe274aaeeaf6e25ce95ec0a884cd4cf3a8dc))
* **dashboard:** prompt to log in again when a provider session expires ([d2e8a7b](https://github.com/sz3ry/bookwave/commit/d2e8a7bf2071e205a4b63f5027764aeedf67032e))
* pick the service at first login and manage accounts in settings ([4737066](https://github.com/sz3ry/bookwave/commit/4737066e5ea202406371321963c3a78c6b24215a))
* **player:** add timeline, track url cache and position conflict rule ([4739028](https://github.com/sz3ry/bookwave/commit/47390284d4603fdcf1f1e35e3a2d4f428cac6373))
* show one library across services with source badges ([18d699a](https://github.com/sz3ry/bookwave/commit/18d699aaa1cd1aafd1f77bedb302ad8bc9bbd09e))


### Bug Fixes

* **audioteka:** keep persisting rotations during a second login ([5e5f2e8](https://github.com/sz3ry/bookwave/commit/5e5f2e8d98c16b2fd5561fb81413ee3c00531bda))
* **audioteka:** keep remote-seen and flush the position on quit ([66259af](https://github.com/sz3ry/bookwave/commit/66259afd72d5e61b644d594bd395dd5232c7c036))
* **audioteka:** re-check the remote position when resuming a paused book ([9723318](https://github.com/sz3ry/bookwave/commit/9723318ed2d4b9cff19041973cf44e9a65955896))
* **audioteka:** send only positions Bookwave moved to the remote ([217db9e](https://github.com/sz3ry/bookwave/commit/217db9eae736b9d970610db0371182e35bd7b8ed))
* **dashboard:** log out the provider whose library failed to load ([dcb7a97](https://github.com/sz3ry/bookwave/commit/dcb7a97ea3595691351dea8896cdbbc255e845f5))
* **dashboard:** show the explore button only with a Storytel account ([bec43ac](https://github.com/sz3ry/bookwave/commit/bec43acea4182a2d832557746f15e24aa0c435bc))
* **player:** keep a newer local position after a remote write ([e00d623](https://github.com/sz3ry/bookwave/commit/e00d623d572d6652f678ddac48e2558469cb095f))
* **player:** keep multi-track switches consistent across boundaries and errors ([2bec873](https://github.com/sz3ry/bookwave/commit/2bec873fef1e057c1de5af02b78e6f889f94156d))
* **player:** restore the last audioteka book on launch ([08cfae9](https://github.com/sz3ry/bookwave/commit/08cfae967e3f9cda75f136d4a5c48f76c721d829))
* **player:** stop waiting for the Audioteka position on open after a timeout ([769f42f](https://github.com/sz3ry/bookwave/commit/769f42fe3b40ca40b88d3cea879c502705c95f92))
* **player:** unsubscribe tray play-pause and logout listeners ([932778f](https://github.com/sz3ry/bookwave/commit/932778f66722b6f028174461e3011ef102c3c062))
* **updater:** skip the quit hold when quitting to install an update ([4d06f58](https://github.com/sz3ry/bookwave/commit/4d06f58ac23a7dbae865199ccf6fcba0e137e66b))

## [1.2.0](https://github.com/sz3ry/bookwave/compare/v1.1.1...v1.2.0) (2026-10-22)


### Features

* **dashboard:** suggest the next part of finished series ([02d38a8](https://github.com/sz3ry/bookwave/commit/02d38a8a17af728b1d77a49b7f3c7a50edab5c45))
* **discovery:** add Storytel explore and series client with a per-session cache ([7674697](https://github.com/sz3ry/bookwave/commit/7674697e9bb297079d8db235376138bcd49a5993))
* **discovery:** expose explore pages, lists and series to the renderer ([d921556](https://github.com/sz3ry/bookwave/commit/d921556d786f83969ba020d6e0b34ce9d7500670))
* **discovery:** mark upcoming audiobooks as coming soon ([60d0fd6](https://github.com/sz3ry/bookwave/commit/60d0fd6cfc7bb14285073d9db00643f6983a40d2))
* **i18n:** follow the system language and remove the manual language picker ([3a18d6a](https://github.com/sz3ry/bookwave/commit/3a18d6a062b3ddcc6c6e110736cad5f25fb2b279))
* **search:** show Storytel's front page with tabs and full lists on the empty search page ([e466209](https://github.com/sz3ry/bookwave/commit/e4662092433ab15065fc00190e8d783b560a237c))
* **series:** show series parts with start-from-part-one and next-part actions ([3f011f7](https://github.com/sz3ry/bookwave/commit/3f011f706a96b946ef91be880b2caac303a49e87))


### Bug Fixes

* **api:** reject malformed discovery and book ids ([3533a8a](https://github.com/sz3ry/bookwave/commit/3533a8a3164f7a734791324ff27fdedead824f93))
* **discovery:** hide the podcast and ebook tabs ([ee566c1](https://github.com/sz3ry/bookwave/commit/ee566c14c4edafaecae1e3e72d3576f8332ef72e))
* **discovery:** keep chip probing errors visible and force kidsMode off ([c036c7a](https://github.com/sz3ry/bookwave/commit/c036c7a9ccc8a7258201392dbb71c6ff5546c73c))
* **discovery:** keep tabs whose personalised rows Storytel answers with 404 ([5f2808a](https://github.com/sz3ry/bookwave/commit/5f2808a5d73633b2761c9275c413060e37c3eb02))
* **discovery:** keep the front page when another tab fails ([50d19c3](https://github.com/sz3ry/bookwave/commit/50d19c3b4b639ff002cca3b57bebda749bc49401))
* **discovery:** treat unreleased and locked audiobooks as unplayable ([527dbf4](https://github.com/sz3ry/bookwave/commit/527dbf45ec8f2ccbd0d84bfc7b6245e66effb592))
* **i18n:** take the main process language in the renderer ([a57b20d](https://github.com/sz3ry/bookwave/commit/a57b20da9b0ee25c62dfe2ed6330f75979800894))
* **search:** keep load more reachable and report failed lazy rows ([2def9f9](https://github.com/sz3ry/bookwave/commit/2def9f9904dc29e6aa188910732e55d519cd57bb))
* **search:** mark unreleased audiobooks in search results and keep release dates on the right day ([dadd661](https://github.com/sz3ry/bookwave/commit/dadd661bbff4998150783bbc3a4484883d34835a))
* **search:** resume failed front-page loads and report failed rows ([78b6b66](https://github.com/sz3ry/bookwave/commit/78b6b6655a081acb0341d7d229b716f9d350c771))
* **search:** stop the tab bar from being squeezed and clipped ([08f4895](https://github.com/sz3ry/bookwave/commit/08f48950100828425354f1cedf1503ee03b69d52))
* **series:** never show the previous book's series ([665a115](https://github.com/sz3ry/bookwave/commit/665a115baff14216b5a613da1d42dbeed559049f))
* **series:** skip empty lookups, mark the next part as primary and clear the search handoff ([c1b76aa](https://github.com/sz3ry/bookwave/commit/c1b76aac8c407adeada205b4c11efad4beb669ae))

## [1.1.1](https://github.com/sz3ry/bookwave/compare/v1.1.0...v1.1.1) (2026-10-22)


### Bug Fixes

* **ui:** remove the upstream Discord invite from the welcome and settings dialogs ([49e8fdb](https://github.com/sz3ry/bookwave/commit/49e8fdb247fe1ed4ae2d4839325be257ef49402a))

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
