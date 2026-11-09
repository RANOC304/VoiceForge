"use strict";

// Native integration test: synthetic microphone only, isolated disposable app data.
// Run with: npm run test:desktop
const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const features = require("./feature-checks.cjs");
const output = path.join(os.tmpdir(), "voiceforge-desktop-smoke-" + Date.now());
const fastFolder = path.join(output, "fast exports");
app.setPath("userData", path.join(output, "profile"));
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const errors = [];
let window;
let exportFormat = "wav";
let saveDialogs = 0;
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(options.properties.includes("openDirectory"));
  return { canceled: false, filePaths: [fastFolder] };
};
dialog.showSaveDialog = async () => {
  saveDialogs++;
  return {
    canceled: false,
    filePath: path.join(output, "voiceforge-test." + exportFormat),
  };
};
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
    `!document.querySelector('.processing-line') && document.querySelector('[aria-label="Play audio"]:not(:disabled), [aria-label="Pause playback"]:not(:disabled)')`,
  );

app
  .whenReady()
  .then(async () => {
    await fs.mkdir(fastFolder, { recursive: true });
    window = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => {
      if (!window.webContents.isLoading()) resolve();
      else window.webContents.once("did-finish-load", resolve);
    });
    await waitFor(`document.querySelector('[aria-label="Recording name"]')`);
    assert.equal(
      await evaluate(`window.voiceforge.version`),
      require("../package.json").version,
    );
    assert.equal(
      await evaluate(`typeof window.voiceforge.chooseExportFolder`),
      "function",
      "The desktop app can remember a user-chosen export folder",
    );
    await features.installAudioProbe(evaluate);
    const featureApi = { evaluate, waitFor, click, button, window, settle };
    await button("Try a sound demo");
    await settle();
    await features.testEffects(featureApi);
    await features.testQueuedStop(featureApi);
    await features.testTrim(featureApi);
    await features.testSticky(featureApi);
    await click('[aria-label="Stop playback"]');
    await features.auditionForPersistence(featureApi);
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
        duration > 6 && duration < 30,
        "Export uses the actual effect stack with its tail, while the Original audition is only six seconds",
      );
    }
    assert.equal(
      await evaluate(
        `window.voiceforge.savePreferences({exportFolder:'C:/elsewhere'}).then(()=>false,()=>true)`,
      ),
      true,
    );
    await click('[aria-label="Studio settings"]');
    await button("Detect microphones");
    await waitFor(
      `document.querySelector('[aria-label="Default microphone"]:not(:disabled) option:nth-child(2)')`,
    );
    const microphoneId = await evaluate(`(() => {
      const microphone = document.querySelector('[aria-label="Default microphone"]');
      microphone.value = microphone.options[1].value;
      microphone.dispatchEvent(new Event('change', { bubbles: true }));
      return microphone.value;
    })()`);
    await button("Choose folder");
    await waitFor(
      `document.querySelector('.preferences-folder')?.textContent.includes('fast exports') && document.querySelector('[aria-label="Fast export format"]:not(:disabled)')`,
    );
    await evaluate(`(() => {
      const format = document.querySelector('[aria-label="Fast export format"]');
      format.value = 'mp3';
      format.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await button("Save preferences");
    await waitFor(`!document.querySelector('[role="dialog"]')`);
    await fs.writeFile(
      path.join(fastFolder, "Sound demo.mp3"),
      "existing export",
    );
    const dialogsBeforeFastExport = saveDialogs;
    await button("Fast export");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('Sound demo (2).mp3')`,
    );
    assert.equal(saveDialogs, dialogsBeforeFastExport);
    assert.equal(
      await fs.readFile(path.join(fastFolder, "Sound demo.mp3"), "utf8"),
      "existing export",
    );
    assert.deepEqual(
      await fs.readFile(path.join(fastFolder, "Sound demo (2).mp3")),
      mp3,
    );
    await features.seedLegacy(evaluate);
    window.webContents.reload();
    await waitFor(
      `document.querySelector('[aria-label="My recordings"] .nav-count')?.textContent==='2'`,
    );
    await features.installAudioProbe(evaluate);
    await waitFor(
      `document.querySelector('[aria-label="Microphone"]')?.value === ${JSON.stringify(microphoneId)}`,
    );
    const prefs = await evaluate("window.voiceforge.getPreferences()");
    assert.ok(microphoneId);
    assert.equal(prefs.microphoneId, microphoneId);
    assert.equal(prefs.exportFolder, await fs.realpath(fastFolder));
    assert.equal(prefs.exportFormat, "mp3");
    await features.openSaved(featureApi, "Sound demo");
    await features.assertSavedChain(featureApi);
    await features.assertLegacy(featureApi);
    await features.openSaved(featureApi, "Sound demo");
    await button("Save as preset");
    const setInput = async (label, value) =>
      evaluate(`(() => {
      const input = document.querySelector('input[aria-label=' + CSS.escape(${JSON.stringify(label)}) + ']');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await setInput("Preset name", "Dark hook");
    await button("Save preset");
    await waitFor(
      `!document.querySelector('[role="dialog"]') && document.querySelector('[aria-label="Saved stack preset"]').options.length === 2`,
    );
    await button("Add track");
    await waitFor(
      `document.querySelector('[aria-label="Select track 2"][aria-pressed="true"]')`,
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('.effect-chain-item').length`),
      0,
    );
    await evaluate(`(() => {
      const select = document.querySelector('[aria-label="Saved stack preset"]');
      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await button("Apply");
    await features.assertSavedChain(featureApi);
    await click(".monitor-toggle input");
    const startsBeforeCapture = await evaluate(
      "window.__voiceforgeAudioProbe.starts",
    );
    // The fake Chromium microphone still traverses our real audio-only permission handlers.
    await button("Record");
    await waitFor(`document.querySelector('[title="Pause recording"]')`);
    assert.equal(
      await evaluate("window.__voiceforgeAudioProbe.starts"),
      startsBeforeCapture + 1,
    );
    // MediaRecorder runs while a background window's animation frames can pause.
    await delay(1250);
    await click('[title="Pause recording"]');
    await waitFor(`document.querySelector('[title="Resume recording"]')`);
    assert.equal(
      await evaluate("window.__voiceforgeAudioProbe.active.size"),
      0,
    );
    await click('[title="Resume recording"]');
    await click('[title="Stop recording"]');
    await settle();
    assert.ok(
      await evaluate(`!document.querySelector('[title="Pause recording"]')`),
    );
    assert.equal(
      await evaluate("window.__voiceforgeAudioProbe.active.size"),
      0,
    );
    await setInput("Start time for track 2", "12");
    await button("Play mix");
    await waitFor(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop mix')`,
    );
    assert.ok(
      (await evaluate("window.__voiceforgeAudioProbe.lastDuration")) > 13,
    );
    await button("Stop mix");
    await button("Save");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('saved on this computer')`,
    );

    exportFormat = "wav";
    await button("Export");
    await click(".export-format-options button:first-child");
    await button("Export WAV");
    await waitFor(`!document.querySelector('[role="dialog"]')`);
    const solo = await fs.readFile(path.join(output, "voiceforge-test.wav"));
    assert.ok(
      solo.readUInt32LE(40) / 96000 < 6,
      "Export contains the short selected take without the other track or mix start offset",
    );

    exportFormat = "mp3";
    await button("Export");
    await button("Export MP3");
    await waitFor(`!document.querySelector('[role="dialog"]')`);
    const soloMp3 = await fs.readFile(path.join(output, "voiceforge-test.mp3"));
    await button("Fast export");
    await waitFor(
      `document.querySelector('.toast')?.textContent.includes('fast exports') && document.querySelector('.toast')?.textContent.includes('Sound demo - Track 2.mp3')`,
    );
    assert.deepEqual(
      await fs.readFile(path.join(fastFolder, "Sound demo - Track 2.mp3")),
      soloMp3,
      "Fast export encodes the same selected track as Export",
    );

    window.webContents.reload();
    await waitFor(
      `document.querySelector('[aria-label="My recordings"] .nav-count')?.textContent==='2'`,
    );
    await features.installAudioProbe(evaluate);
    await features.openSaved(featureApi, "Sound demo");
    await waitFor(
      `document.querySelector('[aria-label="Select track 2"][aria-pressed="true"]')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Start time for track 2"]').value`,
      ),
      "12",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Saved stack preset"]').options[1].textContent`,
      ),
      "Dark hook",
    );
    await click('[aria-label="Clear recording"]');
    await button("Keep take");
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Clear recording"]').disabled`,
      ),
      false,
    );
    await click('[aria-label="Clear recording"]');
    await click('[role="dialog"] .danger');
    await waitFor(
      `document.querySelector('[aria-label="Clear recording"]:disabled')`,
    );
    await features.assertSavedChain(featureApi);
    await click('[aria-label="Select track 1"]');
    await settle();
    await features.assertSavedChain(featureApi);
    await features.openSaved(featureApi, "Sound demo");
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Clear recording"]').disabled`,
      ),
      false,
    );
    for (let track = 3; track <= 10; track++) {
      await button("Add track");
      await waitFor(
        `document.querySelector('[aria-label="Select track ${track}"][aria-pressed="true"]')`,
      );
    }
    assert.equal(
      await evaluate(`document.querySelectorAll('.project-tracks li').length`),
      10,
    );
    assert.deepEqual(
      await evaluate(
        `[...document.querySelectorAll('.session-actions button')].filter(b=>['Export','Fast export'].includes(b.textContent.trim())).map(b=>b.disabled)`,
      ),
      [true, true],
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "native preload",
          "demo",
          "100 presets including 10 Auto-Tune and 30 Rap presets",
          "saved microphone and export preferences",
          "dialog-free export to the saved folder with collision protection",
          "card border and description audition without stack changes",
          "separate Add action builds the stack and previews it",
          "rapid temporary auditions without overlapping players",
          "saving and exporting the actual stack during Original audition",
          "explicit Stop cancels a pending automatic preview",
          "stack, reselect, bypass, remove, reorder effects",
          "source waveform mouse trim and numeric synchronization",
          "sticky waveform while browsing effects",
          "saved effect chain reload and legacy migration",
          "WAV native export and decode",
          "MP3 native export and decode",
          "saved session reload",
          "synthetic microphone recording",
          "pause/resume",
          "reusable stack presets persist and restore order and bypass state",
          "multitrack overdub monitoring, mix playback and selected-track exports",
          "more than eight tracks and exports disabled on an empty selection",
          "saved projects reload track state and clearing only affects the open take",
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
}, 180000).unref();
