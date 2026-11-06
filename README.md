# VoiceForge

A Windows voice recording studio. Record a take, choose a voice effect, adjust it, and export a WAV or MP3. Audio stays on your computer; there is no account, cloud processing, or telemetry.

## Use the app

Open `VoiceForge-1.0.0-Windows.exe` from the `release` folder. The portable app needs no installer. The executable is unsigned, so Windows may show its standard unknown-publisher prompt.

1. Choose your microphone, then press **Record**. Pause and resume within the same take, or stop when finished.
2. Choose an effect from the library. Search or filter the categories to find character voices, spaces, musical effects, and creative treatments.
3. Play the result. Compare it with the original, adjust effect strength and pitch, or trim the beginning and end.
4. Save the take to your local recording library, or export a WAV or MP3 to a folder you choose.

You can also import an existing audio file or try the synthetic sound demo before recording.

Takes can be up to 10 minutes. Imported files must be under 100 MB. VoiceForge mixes audio to mono at 48 kHz, suited to a single voice. MP3 export offers 128, 192, or 320 kbps.

## Effects

The preset library includes demon and monster voices, robot and radio treatments, chipmunk-style pitch, reverb spaces, echo, chorus, distortion, tremolo, bit crushing, and scale-based pitch correction. Presets combine actual audio processing; they are not cloud voice models.

The pitch correction effect is a lightweight creative auto-tune effect for a single voice. Choose a key and scale for musical material. Noisy recordings, breathy speech, chords, and multiple speakers can cause pitch-detection artifacts. It is not the Antares Auto-Tune product. Extreme pitch and distortion settings are intentionally stylized.

Effects are applied after recording. The original take remains available for comparison and further changes. The app does not install a virtual microphone or change your voice in other applications.

## Local storage and privacy

- Microphone access starts only when recording begins. Windows microphone permission must be enabled for desktop apps.
- Saved takes and their effect settings live in this application's local Chromium storage. Use the recording library's delete action to remove a saved take.
- Exports are ordinary audio files stored only where you choose in the Windows save dialog.
- Saving a take to the library and exporting a file are separate actions. Keep exported copies of important recordings before clearing app data or moving to another computer.
- Local recordings are not encrypted by the app. Protect your Windows account and disk if the recordings are sensitive.

## Run from source

Use Node.js 24 LTS and npm 11 on Windows. Dependencies are pinned by `package-lock.json`. Dependency install scripts are disabled in `.npmrc`.

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm start
```

The explicit Electron install step downloads the Electron runtime from its official release distribution. It is the only dependency install script needed to run the app. See [development notes](docs/DEVELOPMENT.md) before changing dependencies.

```powershell
npm test
npm run build
npm run test:desktop
npm run package
```

`npm run package` creates a Windows x64 portable executable in `release`. `npm run package:dir` creates an unpacked application directory for local testing.

For UI development with hot reload, run `npm run dev` in one terminal, then launch Electron in another:

```powershell
$env:VOICEFORGE_DEV = '1'
npx electron .
```

Only the fixed local development address `http://127.0.0.1:5173/` is accepted. A packaged build always opens its bundled local files.

## Troubleshooting

- **No microphone:** Check Windows **Settings → Privacy & security → Microphone**, enable microphone access for desktop apps, and make sure another app is not using the microphone exclusively. Reopen VoiceForge after changing Windows permissions.
- **Recording is quiet:** Select the correct input device and increase its level in Windows sound settings. Output gain and normalization can raise the saved result, but cannot restore an input that clipped during recording.
- **Effects sound rough:** Lower the intensity, make a cleaner dry recording, and keep the microphone away from speakers. The strongest character presets deliberately distort the signal.
- **Export fails:** Choose a writable folder, keep the `.wav` or `.mp3` extension matching the selected format, and close applications that have locked the destination file.
- **Electron is missing after installing dependencies:** Run the explicit `node node_modules/electron/install.js` step above, then start again.

## Technical notes

The interface uses React and TypeScript, bundled by Vite. A sandboxed Electron renderer captures microphone audio. A worker applies local digital signal processing and encodes exports; MP3 encoding uses LAME through `@breezystack/lamejs`. The native bridge exposes only an audio save dialog and validates its sender and payload.

See [audio processing details](docs/AUDIO.md), [development notes](docs/DEVELOPMENT.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
