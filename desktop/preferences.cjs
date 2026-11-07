"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const defaults = {
  microphoneId: "",
  microphoneLabel: "",
  exportFolder: null,
  exportFormat: "wav",
  exportBitrate: 192,
};

function validatePreferencePatch(patch) {
  const fields = {
    microphoneId: (value) => typeof value === "string" && value.length <= 512,
    microphoneLabel: (value) =>
      typeof value === "string" && value.length <= 256,
    exportFormat: (value) => value === "wav" || value === "mp3",
    exportBitrate: (value) => [128, 192, 320].includes(value),
  };
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.entries(patch).some(
      ([key, value]) => !Object.hasOwn(fields, key) || !fields[key](value),
    )
  )
    throw new Error("Invalid studio preferences.");
  return patch;
}

function createPreferences(file) {
  let pending = Promise.resolve();
  const read = async () => {
    try {
      const stored = JSON.parse(await fs.readFile(file, "utf8"));
      if (!stored || typeof stored !== "object" || Array.isArray(stored))
        return { ...defaults };
      const { exportFolder, ...patch } = stored;
      return {
        ...defaults,
        ...validatePreferencePatch(patch),
        exportFolder:
          typeof exportFolder === "string" && path.isAbsolute(exportFolder)
            ? exportFolder
            : null,
      };
    } catch (error) {
      if (
        error.code === "ENOENT" ||
        error instanceof SyntaxError ||
        error.message === "Invalid studio preferences."
      )
        return { ...defaults };
      throw error;
    }
  };
  return {
    read: () => pending.then(read),
    update(patch) {
      const saved = pending.then(async () => {
        const next = { ...(await read()), ...patch };
        await fs.writeFile(file + ".tmp", JSON.stringify(next), "utf8");
        await fs.rename(file + ".tmp", file);
        return next;
      });
      pending = saved.then(
        () => {},
        () => {},
      );
      return saved;
    },
  };
}

async function writeFastExport(folder, audio) {
  if (!folder)
    throw new Error("Choose a default export folder in Settings first.");
  let canonical;
  try {
    canonical = await fs.realpath(folder);
    if (canonical !== folder || !(await fs.stat(canonical)).isDirectory())
      throw new Error();
  } catch {
    throw new Error(
      "The default export folder is unavailable. Choose it again in Settings.",
    );
  }
  const { name, ext } = path.parse(audio.name);
  for (let copy = 1; copy <= 1000; copy++) {
    const file = path.join(
      canonical,
      copy === 1 ? audio.name : `${name} (${copy})${ext}`,
    );
    try {
      await fs.writeFile(file, audio.bytes, { flag: "wx" });
      return file;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw new Error(
          "Could not write to the default export folder. Choose a writable folder in Settings.",
        );
    }
  }
  throw new Error(
    "Too many exports share this name. Rename the recording and try again.",
  );
}

module.exports = {
  createPreferences,
  validatePreferencePatch,
  writeFastExport,
};
