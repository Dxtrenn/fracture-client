# Fracture Client

A Minecraft PvP launcher for Windows and macOS.

- Microsoft login with multiple accounts (popup or code/QR link)
- Any Minecraft version, Vanilla or Fabric, with automatic Java
- Modrinth mod browser, drag-and-drop mods, mod icons
- Import profiles from Dawn, Feather, Prism, Modrinth App and Lunar
- "Game crashed" screen with one-click fixes for missing or broken mods
- Accessories: skin library, skin creator (SkinMC), skin finder (NameMC), capes
- TikTok, Spotify and Instagram in the side panel

## Download

Grab the latest `Fracture Client Setup.exe` from the [Releases](../../releases) page.
- **Windows:** `Fracture-Client-Setup-x.y.z.exe`. SmartScreen may warn because the installer isn't code-signed: click **More info → Run anyway**.
- **macOS:** `…-mac-arm64.dmg` for Apple Silicon (M1/M2/M3/M4), `…-mac-x64.dmg` for Intel Macs. Drag the app to Applications, then the first time **right-click it → Open → Open** (the app isn't notarized by Apple yet). If macOS says the app "is damaged", run `xattr -cr "/Applications/Fracture Client.app"` in Terminal and open it again.

## Building from source

```bash
npm install
npm start          # run in development
npm run dist       # Windows installer into dist/
npm run dist:mac   # macOS .dmg files (must run on a Mac)
```

Pushing to `main` or publishing a GitHub release builds both automatically (see `.github/workflows/build.yml`).
```bash
```
