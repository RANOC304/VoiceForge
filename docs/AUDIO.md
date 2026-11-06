# Voice effects

VoiceForge processes mono floating-point PCM locally in a background worker. The source recording remains unchanged. Editing an effect chain re-renders from the source, so effects remain reversible.

The library contains 90 presets across Essentials, Characters, Spaces, Musical, Creative and Rap. The Rap category contains 30 recipes for drill, trap, pop rap, boom bap, West Coast, grime, phonk, cloud rap and other delivery styles. These are vocal processing choices rather than beat generators or imitations of named performers. Presets combine pitch transposition, filters, a soft saturator, a compressor, a noise gate, ring modulation, amplitude modulation, chorus, vibrato, bit crushing, delay and a damped Schroeder reverb. Reverse and playback-speed effects are also available. Echo and reverb tails are included in playback and export.

Each chain can contain up to eight effect slots, including repeated presets. Enabled effects run in their displayed order. For example, distortion before a telephone filter produces a different result from distortion after the filter. Each slot has its own intensity and bypass control. At zero intensity that slot is bypassed. Disabling or removing one effect preserves the rest of the chain.

Trimming and its boundary taper happen once on the source. The enabled chain then runs from top to bottom, including each recipe's own echo or reverb. The shared custom pitch, echo and reverb controls apply once after the complete chain. Normalization brings the final recording's peak to 95% before one output-gain step, and a soft limiter contains boosted peaks. Quiet pauses reduces low-level sound between phrases; it is a noise gate rather than a speech separation or noise-removal model.

Saved version 1.0 sessions without a chain are read as one enabled slot containing their selected preset and intensity. Original becomes an empty chain. An explicitly empty chain stays empty rather than restoring the old preset. All shared settings remain available.

## Pitch and tuning

Pitch changes use a phase vocoder: a radix-2 FFT, Hann windows, four overlapping analysis frames, instantaneous-frequency estimation and spectral remapping. Transposition preserves the source duration. It also shifts the vocal formants, making it useful for character voices. The Slow motion and Fast forward presets deliberately change both duration and pitch.

Auto tune estimates the fundamental with YIN's cumulative mean normalized difference, then maps the detected pitch to the nearest note in the selected chromatic, major or natural-minor scale. It runs entirely on the device and requires no downloaded model. Gentle tune applies half of the correction; hard correction locks the detected sustained note to the target. The key selector is C=0 through B=11.

The correction is designed for one clear, monophonic singing voice. Speech, breaths, noisy input, chords and several simultaneous voices cannot be reliably assigned one musical note. Unvoiced frames retain their original pitch. This implementation does not preserve formants or offer the transient control and smoothing of a professional vocal tuning plugin; strong correction can sound synthetic. Intensity and Gentle tune provide lighter alternatives.

## Limits and verification

Input is limited to ten minutes and 8–192 kHz. A zero trim end means the full source duration. Trim positions refer to source time; a speed preset can therefore change the rendered duration. Effects may add a tail after the trimmed voice. Explicitly trimmed boundaries receive a three-millisecond taper to avoid clicks.

Processed audio, including every intermediate stage, is limited to 33 minutes 30 seconds. The engine predicts speed changes and tails before allocating processed buffers. A chain that would exceed this limit asks you to shorten the take or remove an effect, even if a later speed-up would make the final output shorter. Long takes with several pitch or reverb stages require more processing time and memory than a single preset.

Automated tests check source preservation, source-time trimming, invalid samples, normalization, silence, reverb/echo tails, a full-octave spectral shift, off-key 430 Hz to 440 Hz correction, scale/key mapping and safe output from every preset. Chain tests also verify order, repeated effects, bypass, legacy sessions, shared controls, export PCM and intermediate duration limits. Synthetic tests demonstrate DSP behaviour; they do not measure the subjective quality of every voice or microphone.
