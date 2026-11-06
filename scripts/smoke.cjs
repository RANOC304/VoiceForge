"use strict";

// Native integration test: synthetic microphone only, isolated disposable app data.
// Run with: npm run test:desktop
const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = path.join(os.tmpdir(), "voiceforge-desktop-smoke-" + Date.now());
app.setPath("userData", path.join(output, "profile"));
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const errors = [];
let window;
let exportFormat = "wav";
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(output, "voiceforge-test." + exportFormat),
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
});
require("../desktop/main.cjs");

async function evaluate(code) {
  return window.webContents.executeJavaScript(code, true);
}
async function waitFor(expression, timeout = 15000) {
  return evaluate(
    `new Promise((resolve, reject) => { const end=performance.now()+${timeout};const check=()=>{if(${expression})return resolve(true);if(performance.now()>end)return reject(Error('Timed out: '+${JSON.stringify(expression)}));setTimeout(check,40)};check();})`,
  );
}
async function click(selector) {
  await evaluate(
    `(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(!target||target.disabled)throw Error('Unavailable control '+${JSON.stringify(selector)});target.click();})()`,
  );
}
async function button(text) {
  await evaluate(
    `(()=>{const target=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!target||target.disabled)throw Error('Unavailable button '+${JSON.stringify(text)});target.click();})()`,
  );
}
const settle = () =>
  waitFor(
    `!document.querySelector('.processing-line') && document.querySelector('[aria-label="Play audio"]:not(:disabled)')`,
  );

app
  .whenReady()
  .then(async () => {
    await fs.mkdir(output, { recursive: true });
    window = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => {
      if (!window.webContents.isLoading()) resolve();
      else window.webContents.once("did-finish-load", resolve);
    });
    await waitFor(`document.querySelector('[aria-label="Recording name"]')`);
    assert.equal(await evaluate(`window.voiceforge.version`), "1.0.0");
    await button("Try a sound demo");
    await settle();
    await click('[aria-label="Apply Demon"]');
    await settle();
    await click('[aria-label="Play audio"]');
    await waitFor(`document.querySelector('[aria-label="Pause playback"]')`);
    await click('[aria-label="Stop playback"]');
    await button("Save");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('saved on this computer')`,
    );
    await button("Export");
    await button("Export WAV");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('Exported')`,
    );
    const wav = await fs.readFile(path.join(output, "voiceforge-test.wav"));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.ok(wav.length > 576000);
    await button("Export");
    await click(".export-format-options button:nth-child(2)");
    exportFormat = "mp3";
    await button("Export MP3");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('Exported') && !document.querySelector('[role="dialog"]')`,
    );
    const mp3 = await fs.readFile(path.join(output, "voiceforge-test.mp3"));
    assert.equal(mp3[0], 255);
    assert.ok(mp3.length > 100000);
    // Decode both files independently of the encoder using Chromium's media decoder.
    for (const file of [wav, mp3]) {
      const values = [...file];
      const duration = await evaluate(
        `(async()=>{const ctx=new AudioContext();try{const b=await ctx.decodeAudioData(new Uint8Array(${JSON.stringify(values)}).buffer);return b.duration;}finally{await ctx.close();}})()`,
      );
      assert.ok(
        duration > 6 && duration < 15,
        "Encoded file decodes with the effect tail",
      );
    }
    window.webContents.reload();
    await waitFor(
      `document.querySelector('[aria-label="My recordings"] .nav-count')?.textContent==='1'`,
    );
    await click('[aria-label="My recordings"]');
    await button("Open");
    await settle();
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Apply Demon"]').getAttribute('aria-pressed')`,
      ),
      "true",
    );
    // The fake Chromium microphone still traverses our real audio-only permission handlers.
    await button("Record");
    await waitFor(`document.querySelector('[title="Pause recording"]')`);
    await waitFor(
      `document.querySelector('.time-display')?.textContent.includes('00:01')`,
    );
    await click('[title="Pause recording"]');
    await waitFor(`document.querySelector('[title="Resume recording"]')`);
    await click('[title="Resume recording"]');
    await click('[title="Stop recording"]');
    await settle();
    assert.ok(
      await evaluate(`!document.querySelector('[title="Pause recording"]')`),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native preload",
          "demo",
          "demon processing",
          "playback",
          "WAV native export and decode",
          "MP3 native export and decode",
          "saved session reload",
          "synthetic microphone recording",
          "pause/resume",
        ],
        output,
      }),
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.stack);
    console.error(errors.join("\n"));
    app.exit(1);
  });
setTimeout(() => {
  console.error("Desktop smoke test timed out.");
  app.exit(1);
}, 90000).unref();
