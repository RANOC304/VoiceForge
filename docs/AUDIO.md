# Voice effects

VoiceForge processes mono floating-point PCM locally in a background worker. The source recording remains unchanged; switching a preset re-renders from the source rather than layering another destructive edit.

The library contains 60 presets across Essentials, Characters, Spaces, Musical and Creative. Presets combine pitch transposition, filters, a soft saturator, a compressor, a noise gate, ring modulation, amplitude modulation, chorus, vibrato, bit crushing, delay and a damped Schroeder reverb. Reverse and playback-speed effects are also available. Echo and reverb tails are included in playback and export.

The intensity control scales the selected recipe. At zero intensity the preset is bypassed; the custom pitch, echo, reverb, output and trim controls still apply. Normalization brings the recording's peak to 95% before output gain, and a soft limiter contains boosted peaks. Quiet pauses reduces low-level sound between phrases; it is a noise gate rather than a speech separation or noise-removal model.

## Pitch and tuning

Pitch changes use a phase vocoder: a radix-2 FFT, Hann windows, four overlapping analysis frames, instantaneous-frequency estimation and spectral remapping. Transposition preserves the source duration. It also shifts the vocal formants, making it useful for character voices. The Slow motion and Fast forward presets deliberately change both duration and pitch.

Auto tune estimates the fundamental with YIN's cumulative mean normalized difference, then maps the detected pitch to the nearest note in the selected chromatic, major or natural-minor scale. It runs entirely on the device and requires no downloaded model. Gentle tune applies half of the correction; hard correction locks the detected sustained note to the target. The key selector is C=0 through B=11.

The correction is designed for one clear, monophonic singing voice. Speech, breaths, noisy input, chords and several simultaneous voices cannot be reliably assigned one musical note. Unvoiced frames retain their original pitch. This implementation does not preserve formants or offer the transient control and smoothing of a professional vocal tuning plugin; strong correction can sound synthetic. Intensity and Gentle tune provide lighter alternatives.

## Limits and verification

Input is limited to ten minutes and 8–192 kHz. A zero trim end means the full source duration. Trim positions refer to source time; a speed preset can therefore change the rendered duration. Effects may add a tail after the trimmed voice. Explicitly trimmed boundaries receive a three-millisecond taper to avoid clicks.

Automated tests check source preservation, source-time trimming, invalid samples, normalization, silence, reverb/echo tails, a full-octave spectral shift, off-key 430 Hz to 440 Hz correction, scale/key mapping and safe output from every preset. Synthetic tests demonstrate DSP behaviour; they do not measure the subjective quality of every voice or microphone.
