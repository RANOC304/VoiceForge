"use strict";

const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

function safeFileName(name, format) {
  let stem = name
    .trim()
    .replace(/\.(wav|mp3)$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim()
    .slice(0, 100)
    .trim();
  stem = stem || "Recording";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
    stem = "_" + stem;
  return stem + "." + format;
}

function validateExport(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).some(
      (key) => !["name", "format", "data"].includes(key),
    ) ||
    typeof payload.name !== "string" ||
    payload.name.length > 500 ||
    !["wav", "mp3"].includes(payload.format) ||
    !(payload.data instanceof ArrayBuffer) ||
    payload.data.byteLength < 4 ||
    payload.data.byteLength > MAX_EXPORT_BYTES
  ) {
    throw new Error("Invalid audio export request.");
  }
  const bytes = Buffer.from(payload.data);
  if (payload.format === "wav") {
    if (
      bytes.length < 44 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE" ||
      bytes.readUInt32LE(4) + 8 > bytes.length
    )
      throw new Error("Invalid WAV audio.");
  } else {
    const id3 = bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3";
    const mpeg =
      bytes[0] === 255 &&
      (bytes[1] & 224) === 224 &&
      (bytes[1] & 24) !== 8 &&
      (bytes[1] & 6) !== 0 &&
      (bytes[2] & 240) !== 0 &&
      (bytes[2] & 240) !== 240 &&
      (bytes[2] & 12) !== 12;
    if (!id3 && !mpeg) throw new Error("Invalid MP3 audio.");
  }
  return {
    name: safeFileName(payload.name, payload.format),
    format: payload.format,
    bytes,
  };
}

function isTrustedSender(event, owner, trustedUrl) {
  return Boolean(
    owner &&
    !owner.isDestroyed() &&
    event?.sender === owner &&
    event.senderFrame === owner.mainFrame &&
    event.senderFrame?.url === trustedUrl &&
    owner.getURL() === trustedUrl,
  );
}

// Check both Electron permission hooks: https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler
function allowMediaPermission(
  contents,
  permission,
  details,
  owner,
  trustedUrl,
  check = false,
) {
  if (
    !owner ||
    owner.isDestroyed() ||
    contents !== owner ||
    permission !== "media" ||
    owner.getURL() !== trustedUrl ||
    details?.requestingUrl !== trustedUrl ||
    details?.isMainFrame !== true
  )
    return false;
  if (check) return details.mediaType === "audio";
  return (
    Array.isArray(details.mediaTypes) &&
    details.mediaTypes.length === 1 &&
    details.mediaTypes[0] === "audio"
  );
}

function isAllowedRequest(rawUrl, distRoot, development) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "blob:" || url.protocol === "data:") return true;
    if (
      development &&
      (url.origin === "http://127.0.0.1:5173" ||
        url.origin === "ws://127.0.0.1:5173")
    )
      return true;
    return (
      url.protocol === "file:" &&
      url.href.startsWith(distRoot) &&
      !/%2f|%5c|%2e/i.test(url.href)
    );
  } catch {
    return false;
  }
}

module.exports = {
  MAX_EXPORT_BYTES,
  safeFileName,
  validateExport,
  isTrustedSender,
  allowMediaPermission,
  isAllowedRequest,
};
