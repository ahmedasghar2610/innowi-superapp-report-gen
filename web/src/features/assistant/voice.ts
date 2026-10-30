"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speaking to the assistant and hearing it answer, with the browser's own Web
 * Speech API: SpeechRecognition turns speech into text, speechSynthesis reads
 * text aloud. Nothing extra is installed. Support varies: Chrome, Edge and
 * Safari have recognition; Firefox does not (the mic button is hidden there).
 * Chrome's recognition sends the audio to Google's speech service to transcribe.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings to talk to the assistant.",
  "service-not-allowed": "Your browser isn't allowing speech recognition here.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection.",
};

export function useSpeechInput({ onFinal }: { onFinal: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const stop = useCallback(() => recRef.current?.stop(), []);
  const cancel = useCallback(() => {
    finalRef.current = "";
    recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalRef.current = "";
    setInterim("");
    setError(null);
    rec.onspeechstart = () => setHearing(true);
    rec.onresult = (e) => {
      let finals = "";
      let live = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else live += r[0].transcript;
      }
      finalRef.current = finals;
      setInterim((finals + " " + live).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORS[e.error] ?? "Couldn't hear that. Try again.");
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setHearing(false);
      const text = finalRef.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError("Couldn't start the microphone.");
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, hearing, interim, error, start, stop, cancel, clearError: () => setError(null) };
}

/** Markdown answer → something pleasant to hear. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\|.*\|$/gm, " ") // tables aren't read out
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const lang = (navigator.language || "en-US").toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  const prefer = [/natural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /google/i];
  for (const p of prefer) {
    const v = sameLang.find((x) => p.test(x.name));
    if (v) return v;
  }
  return sameLang.find((v) => v.default) ?? sameLang[0];
}

export function useSpeechOutput() {
  const [supported, setSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    // Voices load asynchronously in Chrome; touching the list starts that.
    window.speechSynthesis.getVoices();
    return () => window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, markdown: string, onDone?: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = speakable(markdown);
    window.speechSynthesis.cancel();
    if (!text) {
      onDone?.();
      return;
    }
    // Long answers are split into sentences: some browsers stop reading a single utterance after ~15 s.
    const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
    const voice = pickVoice();
    setSpeakingId(id);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part.trim());
      if (voice) u.voice = voice;
      u.rate = 1.03;
      if (i === parts.length - 1) {
        u.onend = () => {
          setSpeakingId(null);
          onDone?.();
        };
        u.onerror = () => setSpeakingId(null);
      }
      window.speechSynthesis.speak(u);
    });
  }, []);

  return { supported, speakingId, speak, stop };
}
