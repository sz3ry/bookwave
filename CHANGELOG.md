# Changelog

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
