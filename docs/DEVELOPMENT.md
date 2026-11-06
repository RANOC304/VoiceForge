# Development

## Application boundaries

- `src/`: React interface, recording state, local saved recordings, and typed audio contracts.
- `src/audio/`: pure audio processing, presets, export encoders, and the processing worker.
- `desktop/main.cjs`: Electron lifecycle, microphone permission checks, and native audio export.
- `desktop/preload.cjs`: the isolated `window.voiceforge` bridge. It exposes `saveAudio` and an application version string.
- `desktop/security.cjs`: independently testable sender, payload, filename, and request validation.

The renderer has `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. It has no general filesystem, shell, credential, or arbitrary IPC access. The packaged app blocks outbound requests, new windows, navigation, embedded webviews, and permissions other than audio capture from its own main document. Development permits only the fixed Vite loopback endpoint.

Audio export accepts a bounded `ArrayBuffer` and an allowlisted format. The main process checks WAV/MPEG signatures and derives a safe filename. The renderer cannot supply a destination path: only the native save dialog can choose one. The native dialog handles overwrite confirmation.

The important assets are the user's microphone audio and local saved takes. The principal trust boundaries are microphone/file input, renderer-to-main IPC, and the native save destination. Keep audio local, validate data at these boundaries, and avoid adding network services or broader preload APIs as conveniences.

The renderer marks an active or unsaved take before unloading. Electron's `will-prevent-unload` handler presents a native **Keep recording / Leave** dialog, with keeping the workspace open as both the default and cancel choice. Only an explicit Leave choice bypasses the renderer's unload guard.

## Dependency installation

`.npmrc` disables dependency lifecycle scripts. Start with `npm ci --ignore-scripts`, then review a package's declared scripts and their source before running any explicitly. The Electron package's `install.js` uses its published downloader to retrieve the matching Electron release; run it with `node node_modules/electron/install.js` after that review. No blanket script approval is required.

Use `npm audit` before a release, investigate advisories against the actual execution paths, and update dependencies without forced major-version remediation. Commit the npm lockfile. Do not keep another package manager's lockfile alongside it.

The version-scoped minimatch override upgrades only versions 7 through 11.0.0 to 11.0.1 to resolve GHSA-g3hv-75wg-m249 in packaging dependencies. Older minimatch consumers retain compatible versions. Verify packaging as well as tests when changing this override.

`npm run test:desktop` runs native integration checks using Chromium's synthetic microphone and an isolated temporary profile. Build current assets with `npm run build` first. It checks recording, pause/resume, persistence, both native exports, and independent decoding of both files. It does not capture the physical microphone or modify normal saved takes.

The native feature scenarios in `scripts/feature-checks.cjs` also check the 90-preset total and exactly 30 Rap presets, preview-only card borders and descriptions, the separate Add action, rapid auditions, ordered effect slots, bypass/removal/reordering, saved chains and legacy sessions, mouse-driven source trimming with numeric synchronization, and sticky waveform positioning while scrolling. A test-only audio-source probe records source starts, durations, and active nodes; this catches overlapping players and verifies that Stop cancels a queued preview. Saving/exporting while auditioning Original must retain the actual stack; independent decoding distinguishes the dry audition from the applied effect tail. The production application does not install that probe.

## Verification and packaging

```powershell
npm test
npm run build
npm audit
npm run package
```

Before distributing a release, test the built Electron application itself:

1. Record microphone audio, pause/resume, stop, and replay.
2. Click several cards quickly, including Original. Confirm only the latest audition plays and the rack stays unchanged. Confirm Stop cancels a pending preview and Back to stack restores the chain.
3. Use the separate Add buttons to stack Demon and Cathedral, bypass one slot, reorder them, and adjust their intensities independently. Save while auditioning another preset, close and reopen the app, and verify only the actual rack is restored.
4. Drag both trim edges and the selection, then type exact seconds. Confirm the handles stay on the source timeline even when effects add a tail. Scroll through the library with the waveform still visible.
5. Export WAV and MP3, cancel the save dialog, and export again.
6. Play both files in an independent audio player.
7. Verify the microphone is released after recording stops.

Unit tests check application logic and security boundaries. They cannot prove physical microphone quality, Windows privacy settings, or perceived effect quality. The portable executable currently has no signing certificate; signing and automated updates are separate distribution work.

The local library tests use `fake-indexeddb` to exercise real IndexedDB requests and transactions. They check PCM and effect-setting round trips, independence from unsaved editor changes, ordering and replacement, targeted deletion, concurrent writes, transaction rollback after a request succeeds, and connection cleanup after an unclonable write. Keep transaction completion as the success boundary: a successful `put` request can still be rolled back before commit.

## Official references

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security): sandboxing, context isolation, navigation restrictions, and IPC sender validation.
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations): exposing one narrow operation through `contextBridge`.
- [Session permission hooks](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler): both request and check handlers are required for complete permission handling.
- [Media permission details](https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request): distinguish audio-only capture from video and display capture.
- [Native save dialog](https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogwindow-options): user-selected export destinations and overwrite confirmation.
- [Prevented unload handling](https://www.electronjs.org/docs/latest/api/web-contents#event-will-prevent-unload): a main-process handler must explicitly resolve Electron's renderer unload prevention.
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder): microphone recording, pause/resume, and completed recording data.
