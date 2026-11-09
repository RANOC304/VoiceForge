"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose specific studio operations through the isolated bridge.
// https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations
contextBridge.exposeInMainWorld(
  "voiceforge",
  Object.freeze({
    version: "1.3.1",
    getPreferences: () => ipcRenderer.invoke("voiceforge:get-preferences"),
    savePreferences: (patch) =>
      ipcRenderer.invoke("voiceforge:save-preferences", patch),
    chooseExportFolder: () =>
      ipcRenderer.invoke("voiceforge:choose-export-folder"),
    saveAudio: (request) =>
      ipcRenderer.invoke("voiceforge:save-audio", {
        name: request?.name,
        format: request?.format,
        data: request?.data,
        fast: request?.fast,
      }),
  }),
);
