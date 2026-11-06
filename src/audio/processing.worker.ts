/// <reference lib="webworker" />
import { renderAudio } from "./engine";
import { encodeMp3, encodeWav } from "./export";
import type { AudioData, StudioSettings } from "./types";

self.onmessage = (
  event: MessageEvent<{
    operation: "render" | "wav" | "mp3";
    audio: AudioData;
    settings?: StudioSettings;
    bitrate?: number;
  }>,
) => {
  try {
    const { operation, audio, settings, bitrate } = event.data;
    if (operation === "render") {
      if (!settings) throw new Error("Missing effect settings.");
      const output = renderAudio(audio, settings);
      self.postMessage({ ok: true, audio: output }, [output.samples.buffer]);
    } else {
      const data =
        operation === "mp3" ? encodeMp3(audio, bitrate) : encodeWav(audio);
      self.postMessage({ ok: true, data }, [data]);
    }
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error ? error.message : "Audio processing failed.",
    });
  }
};
