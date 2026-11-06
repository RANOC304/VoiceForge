import { describe, expect, it } from "vitest";
import security from "./security.cjs";

const {
  validateExport,
  safeFileName,
  isTrustedSender,
  allowMediaPermission,
  isAllowedRequest,
} = security;

function wav() {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (const [offset, value] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const) {
    [...value].forEach((char, i) => {
      bytes[offset + i] = char.charCodeAt(0);
    });
  }
  view.setUint32(4, 38, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 2, true);
  return buffer;
}

describe("native audio export boundary", () => {
  it("accepts real PCM WAV data and returns a safe display name", () => {
    const value = validateExport({
      name: "  My voice.wav  ",
      format: "wav",
      data: wav(),
    });
    expect(value.name).toBe("My voice.wav");
    expect(value.bytes.length).toBe(46);
    expect(value.format).toBe("wav");
  });
  it("accepts MPEG audio frames for MP3", () => {
    expect(
      validateExport({
        name: "Demon",
        format: "mp3",
        data: new Uint8Array([255, 251, 144, 192, 0, 0]).buffer,
      }).name,
    ).toBe("Demon.mp3");
  });
  it.each(["exe", "WAV", "", null])(
    "rejects an unsupported output format: %s",
    (format) => {
      expect(() =>
        validateExport({ name: "Voice", format, data: wav() }),
      ).toThrow();
    },
  );
  it("rejects a path supplied outside the native dialog", () => {
    expect(() =>
      validateExport({
        name: "Voice",
        format: "wav",
        data: wav(),
        path: "C:/target.wav",
      }),
    ).toThrow();
  });
  it("rejects executable or mismatched bytes despite an audio extension", () => {
    expect(() =>
      validateExport({
        name: "voice.wav",
        format: "wav",
        data: new Uint8Array([77, 90, 0, 0]).buffer,
      }),
    ).toThrow();
    expect(() =>
      validateExport({ name: "voice.mp3", format: "mp3", data: wav() }),
    ).toThrow();
  });
  it("rejects truncated WAV containers and non-buffer data", () => {
    const data = wav();
    new DataView(data).setUint32(4, 1000000, true);
    expect(() =>
      validateExport({ name: "Voice", format: "wav", data }),
    ).toThrow();
    expect(() =>
      validateExport({ name: "Voice", format: "wav", data: "<script>" }),
    ).toThrow();
  });
  it("turns untrusted titles into ordinary Windows filenames", () => {
    expect(safeFileName("../../Demon:take?1", "wav")).toBe("Demon take 1.wav");
    expect(safeFileName("CON", "mp3")).toBe("_CON.mp3");
    expect(safeFileName("", "wav")).toBe("Recording.wav");
    expect(safeFileName("a".repeat(500), "mp3").length).toBeLessThanOrEqual(
      104,
    );
  });
});

describe("trusted renderer boundary", () => {
  const url = "file:///C:/VoiceForge/dist/index.html";
  function owner() {
    const mainFrame = { url };
    return { mainFrame, getURL: () => url, isDestroyed: () => false };
  }
  it("accepts only the exact main frame of the application window", () => {
    const contents = owner();
    expect(
      isTrustedSender(
        { sender: contents, senderFrame: contents.mainFrame },
        contents,
        url,
      ),
    ).toBe(true);
    expect(
      isTrustedSender(
        { sender: owner(), senderFrame: contents.mainFrame },
        contents,
        url,
      ),
    ).toBe(false);
    expect(
      isTrustedSender(
        { sender: contents, senderFrame: { url } },
        contents,
        url,
      ),
    ).toBe(false);
    expect(
      isTrustedSender({ sender: contents, senderFrame: null }, contents, url),
    ).toBe(false);
  });
  it("rejects a navigated renderer even when the webContents still matches", () => {
    const contents = owner();
    contents.mainFrame.url = "https://example.com";
    expect(
      isTrustedSender(
        { sender: contents, senderFrame: contents.mainFrame },
        contents,
        url,
      ),
    ).toBe(false);
  });
  it("allows microphone permission only for the trusted main document", () => {
    const contents = owner();
    expect(
      allowMediaPermission(
        contents,
        "media",
        { requestingUrl: url, isMainFrame: true, mediaTypes: ["audio"] },
        contents,
        url,
      ),
    ).toBe(true);
    expect(
      allowMediaPermission(
        contents,
        "media",
        { requestingUrl: url, isMainFrame: true, mediaType: "audio" },
        contents,
        url,
        true,
      ),
    ).toBe(true);
  });
  it("rejects camera, mixed media, subframes and all other permissions", () => {
    const contents = owner();
    for (const details of [
      { requestingUrl: url, isMainFrame: true, mediaTypes: ["video"] },
      { requestingUrl: url, isMainFrame: true, mediaTypes: ["audio", "video"] },
      { requestingUrl: url, isMainFrame: false, mediaTypes: ["audio"] },
      {
        requestingUrl: "https://example.com",
        isMainFrame: true,
        mediaTypes: ["audio"],
      },
      { requestingUrl: url, isMainFrame: true, mediaTypes: [] },
    ])
      expect(
        allowMediaPermission(contents, "media", details, contents, url),
      ).toBe(false);
    expect(
      allowMediaPermission(
        contents,
        "geolocation",
        { requestingUrl: url, isMainFrame: true },
        contents,
        url,
      ),
    ).toBe(false);
  });
  it("allows packaged assets and blob audio while blocking network and adjacent files", () => {
    const root = "file:///C:/VoiceForge/dist/";
    expect(isAllowedRequest(root + "assets/index.js", root, false)).toBe(true);
    expect(isAllowedRequest("blob:file:///session-id", root, false)).toBe(true);
    expect(isAllowedRequest("https://example.com/upload", root, false)).toBe(
      false,
    );
    expect(isAllowedRequest("file:///C:/VoiceForge/secret", root, false)).toBe(
      false,
    );
    expect(isAllowedRequest(root + "../secret", root, false)).toBe(false);
    expect(
      isAllowedRequest("http://127.0.0.1:5173/src/main.tsx", root, true),
    ).toBe(true);
    expect(isAllowedRequest("http://127.0.0.1:9999/", root, true)).toBe(false);
  });
});
