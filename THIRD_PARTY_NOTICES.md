# Third-party notices

VoiceForge uses these open-source components. Their notices are retained in the installed packages and distribution.

- React and React DOM — MIT, Meta Platforms and contributors: https://github.com/facebook/react
- Lucide — ISC, Lucide contributors: https://github.com/lucide-icons/lucide
- Electron — MIT, Electron contributors, plus Chromium and Node.js components under their respective licences. Electron's `LICENSE` and `LICENSES.chromium.html` are included with the runtime: https://www.electronjs.org/
- `@breezystack/lamejs` 1.2.7 — LGPL-3.0, Alex Zhukov and contributors; maintained at https://github.com/shijinyu/lamejs, a fork of https://github.com/zhuker/lamejs. LAME project: https://lame.sourceforge.io/

The LAME JavaScript encoder is unmodified. Its original distributed module, README and licence notice are included in `third-party/lamejs`. The built encoder is a separate JavaScript chunk. You can inspect or replace it and rebuild the application using the instructions in [README.md](README.md). The [MIT License](LICENSE) applies to VoiceForge's original code. The encoder remains under its own LGPL terms.

Development tools retain their own package licences.
