"use strict";

const assert = require("node:assert/strict");

async function installAudioProbe(evaluate) {
  await evaluate(`(() => {
    window.confirm = () => true;
    if (window.__voiceforgeAudioProbe) return;
    const probe = window.__voiceforgeAudioProbe = { active: new Set(), starts: 0, maxActive: 0, lastDuration: 0 };
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(...args) {
      const result = start.apply(this, args);
      probe.active.add(this); probe.starts++; probe.lastDuration = this.buffer?.duration ?? 0; probe.maxActive = Math.max(probe.maxActive, probe.active.size);
      this.addEventListener('ended', () => probe.active.delete(this), { once: true });
      return result;
    };
    AudioBufferSourceNode.prototype.stop = function(...args) {
      const result = stop.apply(this, args); probe.active.delete(this); return result;
    };
  })()`);
}

async function previewAfter({ evaluate, waitFor, click }, selector) {
  const before = await evaluate("window.__voiceforgeAudioProbe.starts");
  await click(selector);
  await waitFor(
    `!document.querySelector('.processing-line') && window.__voiceforgeAudioProbe.starts > ${before} && document.querySelector('[aria-label="Pause playback"]')`,
  );
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.active.size"),
    1,
    "An automatic preview owns exactly one source",
  );
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.maxActive"),
    1,
    "Previews never overlap",
  );
}

async function chainIds(evaluate) {
  return evaluate(
    `Array.from(document.querySelectorAll('.effect-chain-item')).map(row => row.dataset.presetId)`,
  );
}

function mouseClick(window, point) {
  window.webContents.sendInputEvent({
    type: "mouseMove",
    x: point.x,
    y: point.y,
  });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function cardPoint(evaluate, name, target = "bottom") {
  return evaluate(`(async () => {
    const primary = [...document.querySelectorAll('.effect-main')].find(button => button.getAttribute('aria-label') === ${JSON.stringify("Preview ")} + ${JSON.stringify(name)});
    if (!primary) throw Error('Effect card missing: ' + ${JSON.stringify(name)});
    const card = primary.closest('.effect-card');
    card.scrollIntoView({ block: 'end', behavior: 'instant' });
    window.scrollBy(0, 48);
    let previous = null; let stable = 0;
    for (let attempt=0; attempt<20 && stable<3; attempt++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box=card.getBoundingClientRect();
      const current=[box.left,box.top,box.width,box.height].join(':');
      stable=current===previous?stable+1:0;previous=current;
    }
    const rect = card.getBoundingClientRect();
    const favorite = card.querySelector('.favorite-button');
    const favoriteRect = favorite.getBoundingClientRect();
    const description = card.querySelector('.effect-description').getBoundingClientRect();
    const points = {
      bottom: { x: Math.round(rect.left + rect.width / 2), y: Math.floor(rect.bottom - 0.25) },
      description: { x: Math.round(description.left + description.width / 2), y: Math.round(description.top + description.height / 2) },
      heart: { x: Math.round(favoriteRect.left + favoriteRect.width / 2), y: Math.round(favoriteRect.top + favoriteRect.height / 2) }
    };
    const point = points[${JSON.stringify(target)}];
    const hit = document.elementFromPoint(point.x, point.y);
    return { ...point, hit: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.className ?? null, card: hit?.closest('.effect-card')?.querySelector('.effect-main')?.getAttribute('aria-label') ?? null, favoriteBefore: favorite.getAttribute('aria-pressed') };
  })()`);
}

async function waitForPreview(api, before, name) {
  try {
    await api.waitFor(
      `!document.querySelector('.processing-line') && window.__voiceforgeAudioProbe.starts > ${before} && document.querySelector('.effect-preview-banner')?.textContent.includes(${JSON.stringify("Previewing " + name)})`,
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        await api.evaluate(
          `({banner:document.querySelector('.effect-preview-banner')?.textContent,starts:window.__voiceforgeAudioProbe.starts,chain:Array.from(document.querySelectorAll('.effect-chain-item')).map(row=>row.dataset.presetId),error:document.querySelector('.toast')?.textContent})`,
        ),
      ),
    );
    throw error;
  }
  assert.equal(
    await api.evaluate("window.__voiceforgeAudioProbe.active.size"),
    1,
    "An audition owns one audio source",
  );
  assert.equal(
    await api.evaluate("window.__voiceforgeAudioProbe.maxActive"),
    1,
    "Auditions never overlap",
  );
}

async function backToStack(api) {
  const before = await api.evaluate("window.__voiceforgeAudioProbe.starts");
  await api.button("Back to stack");
  await api.waitFor(
    `!document.querySelector('.effect-preview-banner') && !document.querySelector('.processing-line') && window.__voiceforgeAudioProbe.starts > ${before}`,
  );
}

async function testCardSurfaces(api) {
  const { evaluate, window, click } = api;
  const initial = await chainIds(evaluate);
  if (
    await evaluate(
      `Boolean(document.querySelector('[aria-label="Dismiss message"]'))`,
    )
  )
    await click('[aria-label="Dismiss message"]');
  const point = await cardPoint(evaluate, "Demon", "bottom");
  assert.equal(
    point.card,
    "Preview Demon",
    "The native pointer must hit the intended card",
  );
  const before = await evaluate("window.__voiceforgeAudioProbe.starts");
  mouseClick(window, point);
  await waitForPreview(api, before, "Demon");
  assert.deepEqual(
    await chainIds(evaluate),
    initial,
    "Card border auditions without adding",
  );
  const description = await cardPoint(evaluate, "Demon", "description");
  const replay = await evaluate("window.__voiceforgeAudioProbe.starts");
  mouseClick(window, description);
  await waitForPreview(api, replay, "Demon");
  assert.deepEqual(
    await chainIds(evaluate),
    initial,
    "Description clicks only audition",
  );
  const original = await evaluate("window.__voiceforgeAudioProbe.starts");
  await click('[aria-label="Preview Original"]');
  await waitForPreview(api, original, "Original");
  assert.deepEqual(
    await chainIds(evaluate),
    initial,
    "Original auditions without changing the stack",
  );
  await click('[aria-label="Stop playback"]');
  const favorite = await evaluate(
    `document.querySelector('[aria-label="Favorite Demon"], [aria-label="Unfavorite Demon"]').getAttribute('aria-label')`,
  );
  const starts = await evaluate("window.__voiceforgeAudioProbe.starts");
  await click(`[aria-label="${favorite}"]`);
  assert.deepEqual(
    await chainIds(evaluate),
    initial,
    "The heart only changes favorite state",
  );
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.starts"),
    starts,
    "The heart does not audition or add",
  );
  await backToStack(api);
  assert.deepEqual(
    await chainIds(evaluate),
    initial,
    "Back to stack restores the unchanged rack",
  );
  await click('[aria-label="Stop playback"]');
}
async function testEffects(api) {
  const { evaluate, waitFor, click } = api;
  assert.equal(
    await evaluate("document.querySelectorAll('.effect-card').length"),
    100,
    "The full browser contains 100 presets",
  );
  await click('[aria-label="Auto-Tune"]');
  assert.equal(
    await evaluate("document.querySelectorAll('.effect-card').length"),
    10,
  );
  let starts = await evaluate("window.__voiceforgeAudioProbe.starts");
  await click('[aria-label="Preview Classic hard snap"]');
  await waitForPreview(api, starts, "Classic hard snap");
  assert.deepEqual(
    await chainIds(evaluate),
    [],
    "Tuning presets can be auditioned before adding them",
  );
  await backToStack(api);
  await click('[aria-label="Stop playback"]');
  await click('[aria-label="Rap"]');
  assert.equal(
    await evaluate("document.querySelectorAll('.effect-card').length"),
    30,
    "Rap has exactly 30 presets",
  );
  await click('[aria-label="All effects"]');
  await testCardSurfaces(api);

  await previewAfter(api, '[aria-label="Add Demon to stack"]');
  await previewAfter(api, '[aria-label="Add Cathedral to stack"]');
  await previewAfter(api, '[aria-label="Add Robot to stack"]');
  assert.deepEqual(await chainIds(evaluate), ["demon", "cathedral", "robot"]);
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="Add Demon to stack"]').disabled`,
    ),
    true,
    "The separate Add action cannot duplicate an existing slot",
  );
  const before = await evaluate("window.__voiceforgeAudioProbe.starts");
  await evaluate(
    `(() => { for (const name of ['Robot','Original','Demon','Cathedral']) document.querySelector('[aria-label="Preview '+name+'"]').click(); })()`,
  );
  await waitForPreview(api, before, "Cathedral");
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.starts"),
    before + 1,
    "Only the latest rapid audition starts",
  );
  assert.deepEqual(
    await chainIds(evaluate),
    ["demon", "cathedral", "robot"],
    "Rapid auditions leave the saved stack unchanged",
  );
  await backToStack(api);

  await previewAfter(api, '[aria-label="Remove Robot"]');
  assert.deepEqual(await chainIds(evaluate), ["demon", "cathedral"]);
  await previewAfter(api, '[aria-label="Bypass Cathedral"]');
  assert.ok(
    await evaluate(
      `Boolean(document.querySelector('[aria-label="Enable Cathedral"]'))`,
    ),
    "Bypassed effects stay in the rack",
  );
  await previewAfter(api, '[aria-label="Move Cathedral up"]');
  assert.deepEqual(await chainIds(evaluate), ["cathedral", "demon"]);
  await previewAfter(api, '[aria-label="Enable Cathedral"]');
  await click('[aria-label="Stop playback"]');
  await waitFor("window.__voiceforgeAudioProbe.active.size === 0");
}

async function auditionForPersistence(api) {
  const before = await api.evaluate("window.__voiceforgeAudioProbe.starts");
  await api.click('[aria-label="Preview Original"]');
  await waitForPreview(api, before, "Original");
  assert.ok(
    Math.abs(
      (await api.evaluate("window.__voiceforgeAudioProbe.lastDuration")) - 6,
    ) < 0.03,
    "Original audition uses the six-second dry source",
  );
  assert.deepEqual(
    await chainIds(api.evaluate),
    ["cathedral", "demon"],
    "Auditioning Original does not clear the actual stack before save/export",
  );
}
async function testQueuedStop(api) {
  const { evaluate, waitFor, click, settle } = api;
  const before = await evaluate("window.__voiceforgeAudioProbe.starts");
  await click('[aria-label="Move Cathedral down"]');
  await waitFor("document.querySelector('.processing-line')");
  await click('[aria-label="Stop playback"]');
  await settle();
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.starts"),
    before,
    "Stop cancels the queued preview before the render finishes",
  );
  assert.equal(
    await evaluate("window.__voiceforgeAudioProbe.active.size"),
    0,
    "Stopped previews stay stopped",
  );
  await previewAfter(api, '[aria-label="Move Cathedral up"]');
  await previewAfter(api, '[aria-label="Bypass Cathedral"]');
  await click('[aria-label="Stop playback"]');
}

async function drag(window, evaluate, handleSelector, targetFraction) {
  const box = await evaluate(`(() => {
    const handle = document.querySelector(${JSON.stringify(handleSelector)});
    if (!handle) throw Error('Missing trim handle');
    handle.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = handle.getBoundingClientRect();
    const track = handle.closest('.waveform').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), target: Math.round(track.left + track.width * ${targetFraction}) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", x: box.x, y: box.y });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  for (let step = 1; step <= 5; step++) {
    window.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(box.x + ((box.target - box.x) * step) / 5),
      y: box.y,
      button: "left",
      buttons: ["left"],
    });
  }
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: box.target,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
}

async function testTrim(api) {
  const { evaluate, waitFor, click, window, settle } = api;
  await click('[aria-label="Trim recording"]');
  await waitFor(
    `document.querySelector('.trim-handle-start') && document.querySelector('[aria-label="Trim start seconds"]')`,
  );
  await drag(window, evaluate, ".trim-handle-start", 0.2);
  await waitFor(
    `Number(document.querySelector('[aria-label="Trim start seconds"]').value) > 0.8`,
  );
  await drag(window, evaluate, ".trim-handle-end", 0.8);
  await waitFor(
    `Number(document.querySelector('[aria-label="Trim end seconds"]').value) < 5.5`,
  );
  await settle();
  const mouse = await evaluate(
    `({start:Number(document.querySelector('[aria-label="Trim start seconds"]').value),end:Number(document.querySelector('[aria-label="Trim end seconds"]').value)})`,
  );
  assert.ok(
    mouse.start > 0.8 &&
      mouse.start < 1.6 &&
      mouse.end > 4.1 &&
      mouse.end < 5.5,
    "Mouse trim uses six-second source coordinates, independent of effect tails",
  );
  await drag(window, evaluate, ".trim-selection", 0.6);
  await waitFor(
    `Number(document.querySelector('[aria-label="Trim start seconds"]').value) > ${mouse.start + 0.2}`,
  );
  const moved = await evaluate(
    `({start:Number(document.querySelector('[aria-label="Trim start seconds"]').value),end:Number(document.querySelector('[aria-label="Trim end seconds"]').value)})`,
  );
  assert.ok(
    Math.abs(moved.end - moved.start - (mouse.end - mouse.start)) < 0.08,
    "Moving the trim selection preserves its length",
  );
  await evaluate(`(() => {
    const input=document.querySelector('[aria-label="Trim start seconds"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.75');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    `Math.abs(Number(document.querySelector('.trim-handle-start').getAttribute('aria-valuenow')) - 0.75) < 0.03`,
  );
  await settle();
  const endMax = await evaluate(
    `Number(document.querySelector('.trim-handle-end').getAttribute('aria-valuemax'))`,
  );
  assert.ok(
    Math.abs(endMax - 6) < 0.03,
    "Trim endpoint remains anchored to original source duration",
  );
  await api.button("Reset trim");
  await settle();
  await click('[aria-label="Trim recording"]');
}

async function testSticky({ evaluate, waitFor }) {
  await evaluate("window.scrollTo({ top: 1000, behavior: 'instant' })");
  await waitFor("document.querySelector('.recorder-dock.is-stuck')");
  const first = await evaluate(
    "document.querySelector('.recorder-dock').getBoundingClientRect().top",
  );
  await evaluate("window.scrollTo({ top: 1500, behavior: 'instant' })");
  await waitFor("document.scrollingElement.scrollTop > 1200");
  const second = await evaluate(
    "document.querySelector('.recorder-dock').getBoundingClientRect().top",
  );
  assert.ok(
    first >= 0 && first < 110 && Math.abs(first - second) < 3,
    "Waveform stays visible at the same top position while browsing effects",
  );
  await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  await waitFor("!document.querySelector('.recorder-dock.is-stuck')");
}

async function seedLegacy(evaluate) {
  await evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('voiceforge-studio',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;const tx=db.transaction('recordings','readwrite');
      const samples=Float32Array.from({length:48000},(_,i)=>0.2*Math.sin(2*Math.PI*180*i/48000));
      tx.objectStore('recordings').put({id:'legacy-take',name:'Legacy Demon',createdAt:1,duration:1,audio:{sampleRate:48000,samples},settings:{presetId:'demon',intensity:0.65,pitch:0,reverb:0,echo:0,gain:1,normalize:true,trimStart:0,trimEnd:0,tuningKey:0,tuningScale:'chromatic'}});
      tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error)};
    };
  })`);
}

async function openSaved({ evaluate, waitFor, click, settle }, name) {
  await click('[aria-label="My recordings"]');
  await waitFor(
    `Array.from(document.querySelectorAll('.recording-item h3')).some(title=>title.textContent===${JSON.stringify(name)})`,
  );
  await evaluate(
    `(() => {const row=[...document.querySelectorAll('.recording-item')].find(row=>row.querySelector('h3')?.textContent===${JSON.stringify(name)});if(!row)throw Error('Saved take missing');const button=[...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Open');if(!button||button.disabled)throw Error('Saved take cannot be opened');button.click();})()`,
  );
  await waitFor("document.querySelector('.effect-chain')");
  await settle();
}

async function assertSavedChain(api) {
  assert.deepEqual(
    await chainIds(api.evaluate),
    ["cathedral", "demon"],
    "Saved chain order survives reopening",
  );
  assert.ok(
    await api.evaluate(
      `Boolean(document.querySelector('[aria-label="Enable Cathedral"]'))`,
    ),
    "Saved bypass state survives reopening",
  );
  assert.equal(
    await api.evaluate(
      `Boolean(document.querySelector('.effect-preview-banner'))`,
    ),
    false,
    "A temporary audition is not persisted in the saved take",
  );
}

async function assertLegacy(api) {
  await openSaved(api, "Legacy Demon");
  assert.deepEqual(
    await chainIds(api.evaluate),
    ["demon"],
    "Legacy preset-only sessions migrate to one rack slot",
  );
  const intensity = await api.evaluate(
    `Number(document.querySelector('.effect-chain-item[data-preset-id="demon"] input[type="range"]')?.value ?? document.querySelector('input[aria-label="Effect intensity"]')?.value)`,
  );
  // A legacy session's sound is additionally verified by the engine migration tests.
  if (Number.isFinite(intensity))
    assert.ok(
      Math.abs(intensity - 0.65) < 0.02,
      "Legacy slot keeps its intensity",
    );
}

module.exports = {
  installAudioProbe,
  testEffects,
  testQueuedStop,
  auditionForPersistence,
  testTrim,
  testSticky,
  seedLegacy,
  openSaved,
  assertSavedChain,
  assertLegacy,
};
