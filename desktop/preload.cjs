"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose one operation, never ipcRenderer itself.
// https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations
contextBridge.exposeInMainWorld(
  "voiceforge",
  Object.freeze({
    version: "1.1.1",
    saveAudio: (request) =>
      ipcRenderer.invoke("voiceforge:save-audio", {
        name: request?.name,
        format: request?.format,
        data: request?.data,
      }),
  }),
);
