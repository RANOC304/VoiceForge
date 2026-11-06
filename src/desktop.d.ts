export {};
declare global {
  interface Window {
    voiceforge?: {
      saveAudio: (request: {
        name: string;
        format: "wav" | "mp3";
        data: ArrayBuffer;
      }) => Promise<{ canceled: boolean; path?: string }>;
      version: string;
    };
  }
}
