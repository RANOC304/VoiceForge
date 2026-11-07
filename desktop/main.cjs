"use strict";

const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  createPreferences,
  validatePreferencePatch,
  writeFastExport,
} = require("./preferences.cjs");
const {
  validateExport,
  isTrustedSender,
  allowMediaPermission,
  isAllowedRequest,
} = require("./security.cjs");

app.setName("VoiceForge");
const development = !app.isPackaged && process.env.VOICEFORGE_DEV === "1";
const distRoot = pathToFileURL(
  path.join(__dirname, "..", "dist") + path.sep,
).href;
const trustedUrl = development
  ? "http://127.0.0.1:5173/"
  : distRoot + "index.html";
let mainWindow = null;
let exporting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 680,
    title: "VoiceForge",
    backgroundColor: "#111113",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: "persist:voiceforge",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });

  const contents = mainWindow.webContents;
  // Renderer isolation and sender validation follow Electron's security checklist.
  // https://www.electronjs.org/docs/latest/tutorial/security
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // Electron keeps a prevented beforeunload open until the main process resolves it.
  // https://www.electronjs.org/docs/latest/api/web-contents#event-will-prevent-unload
  contents.on("will-prevent-unload", (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      title: "Keep your recording?",
      message:
        "Your current take has unsaved changes or recording is still in progress.",
      detail:
        "Keep recording to save or export your take, or leave and discard the unsaved changes.",
      buttons: ["Keep recording", "Leave"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  contents.on("render-process-gone", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "VoiceForge needs to restart",
        "The audio workspace stopped unexpectedly. Reopen VoiceForge to restore recordings you saved to your library.",
      );
      mainWindow.close();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  contents.loadURL(trustedUrl).catch(() => {
    dialog.showErrorBox(
      "Could not open VoiceForge",
      development
        ? "Start the development server with npm run dev, then reopen the app."
        : "The application files could not be loaded. Rebuild or reinstall VoiceForge.",
    );
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      const workspace = session.fromPartition("persist:voiceforge");
      workspace.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          callback(
            allowMediaPermission(
              contents,
              permission,
              details,
              mainWindow?.webContents,
              trustedUrl,
            ),
          );
        },
      );
      workspace.setPermissionCheckHandler(
        (contents, permission, _origin, details) => {
          return allowMediaPermission(
            contents,
            permission,
            details,
            mainWindow?.webContents,
            trustedUrl,
            true,
          );
        },
      );
      workspace.setDevicePermissionHandler(() => false);
      workspace.on("will-download", (event) => event.preventDefault());
      workspace.webRequest.onBeforeRequest((details, callback) => {
        callback({
          cancel: !isAllowedRequest(details.url, distRoot, development),
        });
      });

      const preferences = createPreferences(
        path.join(app.getPath("userData"), "studio-preferences.json"),
      );
      // https://www.electronjs.org/docs/latest/api/ipc-main#ipcmainhandlechannel-listener
      const handle = (channel, run) =>
        ipcMain.handle(`voiceforge:${channel}`, (event, payload) => {
          if (!isTrustedSender(event, mainWindow?.webContents, trustedUrl))
            throw new Error("Untrusted studio request.");
          return run(payload);
        });
      handle("get-preferences", () => preferences.read());
      handle("save-preferences", (patch) =>
        preferences.update(validatePreferencePatch(patch)),
      );
      handle("choose-export-folder", async () => {
        if (exporting) throw new Error("A file dialog is already open.");
        exporting = true;
        try {
          // The renderer never supplies a path. Only the native folder picker can authorize one.
          // https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogwindow-options
          const { exportFolder } = await preferences.read();
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Choose your default export folder",
            defaultPath: exportFolder ?? app.getPath("music"),
            properties: ["openDirectory"],
          });
          if (result.canceled || !result.filePaths[0])
            return preferences.read();
          const folder = await fs.realpath(result.filePaths[0]);
          if (!(await fs.stat(folder)).isDirectory())
            throw new Error("Choose an existing folder.");
          return await preferences.update({ exportFolder: folder });
        } finally {
          exporting = false;
        }
      });

      handle("save-audio", async (payload) => {
        if (exporting) throw new Error("An export dialog is already open.");
        const audio = validateExport(payload);
        exporting = true;
        try {
          const { exportFolder } = await preferences.read();
          if (audio.fast)
            return {
              canceled: false,
              path: await writeFastExport(exportFolder, audio),
            };
          const selection = await dialog.showSaveDialog(mainWindow, {
            title: "Export your recording",
            defaultPath: path.join(
              exportFolder ?? app.getPath("music"),
              audio.name,
            ),
            buttonLabel: "Export audio",
            filters: [
              {
                name: audio.format === "wav" ? "WAV audio" : "MP3 audio",
                extensions: [audio.format],
              },
            ],
            properties: ["showOverwriteConfirmation", "createDirectory"],
          });
          if (selection.canceled || !selection.filePath)
            return { canceled: true };
          // Only the native dialog supplies a destination. Never accept a renderer path.
          if (
            path.extname(selection.filePath).toLowerCase() !==
            "." + audio.format
          ) {
            throw new Error(
              "Use the selected audio format as the file extension.",
            );
          }
          await fs.writeFile(selection.filePath, audio.bytes);
          return { canceled: false, path: selection.filePath };
        } catch (error) {
          if (audio.fast) throw error;
          if (
            error?.message ===
            "Use the selected audio format as the file extension."
          )
            throw error;
          throw new Error(
            "The audio could not be saved. Choose a writable folder and try again.",
          );
        } finally {
          exporting = false;
        }
      });

      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        "VoiceForge could not start",
        "Close other copies of VoiceForge and try again.",
      );
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
}
