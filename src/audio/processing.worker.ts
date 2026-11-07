/// <reference lib="webworker" />
import { renderAudio } from "./engine";
import { encodeMp3, encodeWav } from "./export";
import { mixTracks, type MixTrack } from "./mix";
import type { AudioData, StudioSettings } from "./types";

self.onmessage = (
  event: MessageEvent<
    | { operation: "mix"; tracks: MixTrack[] }
    | { operation: "render"; audio: AudioData; settings: StudioSettings }
    | { operation: "wav" | "mp3"; audio: AudioData; bitrate?: number }
  >,
) => {
  try {
    const request = event.data;
    const { operation } = request;
    if (operation === "mix") {
      const output = mixTracks(request.tracks);
      self.postMessage({ ok: true, audio: output }, [output.samples.buffer]);
      return;
    }
    if (operation === "render") {
      const output = renderAudio(request.audio, request.settings);
      self.postMessage({ ok: true, audio: output }, [output.samples.buffer]);
    } else {
      const data =
        operation === "mp3"
          ? encodeMp3(request.audio, request.bitrate)
          : encodeWav(request.audio);
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
