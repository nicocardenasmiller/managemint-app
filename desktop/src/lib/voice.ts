// Dictation with the browser's speech recognition (Chrome, Edge, Safari incl. iPhone). Not every browser has it;
// callers hide the mic when `voiceSupported` is false.
import { tr } from "./wording";
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };

const Ctor: (new () => Rec) | undefined = typeof window !== "undefined" ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : undefined;
export const voiceSupported = Boolean(Ctor);

/** Starts listening; `onText` gets the full text so far (interim included). Returns a stop function. */
export function dictate(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): () => void {
  if (!Ctor) { onEnd(tr("voice.unsupported")); return () => {}; }
  const r = new Ctor();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = true;
  let error: string | undefined;
  r.onresult = (e) => {
    let text = "", final = true;
    for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript; if (!e.results[i].isFinal) final = false; }
    onText(text.trim(), final);
  };
  r.onerror = (e) => { error = e?.error === "not-allowed" ? tr("voice.blocked") : e?.error === "no-speech" ? undefined : tr("voice.stopped", { error: e?.error ?? "error" }); };
  r.onend = () => onEnd(error);
  r.start();
  return () => r.stop();
}
