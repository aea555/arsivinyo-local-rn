# CLAUDE.md

Guidance for the whole repository. Each app keeps its own `CLAUDE.md` with the detail
that applies to it — read `mobile/CLAUDE.md` before touching anything under `mobile/`.

## Layout

```
mobile/     Android app (Expo + a Kotlin native module). The only app that exists today.
desktop/    Desktop app. Not started.
shared/     Anything both apps must agree on, chiefly the device-pairing protocol.
```

`mobile/` is a self-contained Expo project: its `package.json`, `node_modules`,
`.gitignore` and scripts all live there, so npm commands run from `mobile/`, not from the
repository root.

The subfolder is `mobile/` and not `android/` because Expo generates an `android/`
directory inside the app itself (`mobile/android/`), and the two names would collide.

## The rule that matters most

> **NEVER run Android builds.** Do not invoke `expo run:android`, `npm run android`,
> `gradlew assemble*`/`install*`, or any background Gradle build. The maintainer runs all
> builds locally on the device. Make the changes, run the non-build checks, then hand the
> build command over. Only build if the maintainer explicitly says to. (`expo prebuild` is
> fine — it starts no Gradle daemon.)

`mobile/CLAUDE.md` explains why, along with the adb recovery steps for when the adb server
wedges.

## Versioning

`mobile/app.config.js` is the single source of truth for the Android app's `version` and
`versionCode`. A desktop app, when it exists, versions independently; only a change to the
pairing protocol in `shared/` needs the two to move together.

The app's identity on the device is `com.arsivinyo.local`. **Never change it.** The vault,
the music index, cookie profiles and settings all live under that package name, so a change
means the next install is a different app and the user's data is orphaned.
