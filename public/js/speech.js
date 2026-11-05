// Speech recognition (device Web Speech API, or an authorised Whisper-compatible server) and text-to-speech.
import { api } from './lib.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speech = {
  serverStt: false,
  setServerStt(on) { this.serverStt = !!on; },

  sttSupported() {
    return !!SR || (this.serverStt && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia);
  },

  /**
   * Start listening. Callbacks: onInterim(text), onFinal(text), onError(code), onEnd().
   * Returns a controller with stop().
   */
  listen({ lang, speechCode, onInterim, onFinal, onError, onEnd }) {
    if (SR && !this.serverStt) return this.listenDevice({ speechCode, onInterim, onFinal, onError, onEnd });
    if (this.serverStt) return this.listenServer({ lang, onInterim, onFinal, onError, onEnd });
    onError?.('unsupported'); onEnd?.();
    return { stop() {} };
  },

  listenDevice({ speechCode, onInterim, onFinal, onError, onEnd }) {
    const rec = new SR();
    rec.lang = speechCode;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 5; // several guesses; the server picks the one that makes sense at an airport
    let finalText = '';
    let alternatives = [];
    let ended = false;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const before = finalText;
          finalText += r[0].transcript;
          alternatives = [...r].slice(1).map(a => (before + a.transcript).trim()).filter(Boolean);
        } else interim += r[0].transcript;
      }
      onInterim?.((finalText + ' ' + interim).trim());
    };
    rec.onerror = e => onError?.(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error);
    rec.onend = () => {
      if (ended) return;
      ended = true;
      if (finalText.trim()) onFinal?.(finalText.trim(), alternatives);
      onEnd?.();
    };
    try { rec.start(); } catch { onError?.('busy'); onEnd?.(); }
    return { stop() { try { rec.stop(); } catch { /* already stopped */ } } };
  },

  listenServer({ lang, onInterim, onFinal, onError, onEnd }) {
    let recorder, stream, stopped = false;
    const chunks = [];
    const ctrl = {
      stop() { stopped = true; if (recorder?.state === 'recording') recorder.stop(); },
    };
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      stream = s;
      if (stopped) { s.getTracks().forEach(t => t.stop()); onEnd?.(); return; }
      recorder = new MediaRecorder(s);
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try {
          onInterim?.('…');
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const r = await api(`/api/speech/transcribe?lang=${encodeURIComponent(lang)}`, { method: 'POST', rawBody: blob, headers: { 'Content-Type': blob.type.split(';')[0] } });
          if (r.text) onFinal?.(r.text);
        } catch { onError?.('network'); }
        onEnd?.();
      };
      recorder.start();
      setTimeout(() => ctrl.stop(), 15000); // hard cap per utterance
    }).catch(() => { onError?.('denied'); onEnd?.(); });
    return ctrl;
  },

  // ---- Text to speech ----
  ttsSupported() { return 'speechSynthesis' in window; },
  voices() { return this.ttsSupported() ? speechSynthesis.getVoices() : []; },
  voiceFor(speechCode) {
    const vs = this.voices();
    const base = speechCode.split('-')[0].toLowerCase();
    return vs.find(v => v.lang.toLowerCase() === speechCode.toLowerCase())
      ?? vs.find(v => v.lang.toLowerCase().startsWith(base + '-') || v.lang.toLowerCase() === base)
      ?? (base === 'tl' ? vs.find(v => v.lang.toLowerCase().startsWith('fil')) : null)
      ?? null;
  },
  hasVoice(speechCode) { return !!this.voiceFor(speechCode); },
  speak(text, speechCode, { rate = 0.95, onEnd } = {}) {
    if (!this.ttsSupported() || !text) { onEnd?.(); return false; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[—–]/g, ', '));
    u.lang = speechCode;
    const v = this.voiceFor(speechCode);
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
    return !!v;
  },
  cancel() { if (this.ttsSupported()) speechSynthesis.cancel(); },
};

if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
