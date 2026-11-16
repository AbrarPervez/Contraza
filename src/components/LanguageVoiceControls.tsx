import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CONTRAZA_LANGUAGES, type ContrazaLanguage } from "@/lib/languages";
import { transcribeSpeech } from "@/lib/lease.functions";

const LANGUAGE_STORAGE_KEY = "contraza.preferred-language";

export function useLanguagePreference() {
  const [language, setLanguage] = useState<ContrazaLanguage>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (CONTRAZA_LANGUAGES.some((item) => item.code === stored)) {
        setLanguage(stored as ContrazaLanguage);
      }
    } catch {
      // Storage may be unavailable in private browsing; English remains the safe default.
    }
  }, []);

  function updateLanguage(next: ContrazaLanguage) {
    setLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // The current page still uses the selected language if storage is unavailable.
    }
  }

  return { language, setLanguage: updateLanguage };
}

export function LanguageSelector({
  value,
  onChange,
}: {
  value: ContrazaLanguage;
  onChange: (value: ContrazaLanguage) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 text-sm">
      <span className="sr-only">Response language</span>
      <span aria-hidden="true">文A</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ContrazaLanguage)}
        className="h-9 max-w-[145px] bg-transparent text-sm outline-none"
        aria-label="Select Contraza language"
      >
        {CONTRAZA_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName} · {language.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function VoiceInputButton({
  language,
  onTranscript,
  disabled = false,
}: {
  language: ContrazaLanguage;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error(
        "Audio recording is not supported by this browser. Try a recent version of Chrome.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        toast.error("Audio recording failed. Please try again.");
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.onstop = () => {
        void processRecording(recorder.mimeType || "audio/webm");
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Microphone permission was not granted.");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function processRecording(mimeType: string) {
    setRecording(false);
    const stream = streamRef.current;
    stream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (!blob.size) {
      toast.error("No audio was captured. Please try again.");
      return;
    }
    if (blob.size > 5 * 1024 * 1024) {
      toast.error("Recording is too large. Please record a shorter voice message.");
      return;
    }
    setTranscribing(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Could not read audio."));
        reader.onerror = () => reject(new Error("Could not read audio."));
        reader.readAsDataURL(blob);
      });
      const audioBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const normalizedMimeType = mimeType.split(";")[0] || "audio/webm";
      const result = await transcribeSpeech({
        data: { audioBase64, mimeType: normalizedMimeType, language },
      });
      if (!result.transcript.trim()) throw new Error("No speech was recognized. Please try again.");
      onTranscript(result.transcript.trim());
      toast.success("Speech converted to text. Review it before sending.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not transcribe the recording.");
    } finally {
      setTranscribing(false);
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }

  return (
    <Button
      type="button"
      size="icon"
      variant={recording ? "destructive" : "outline"}
      disabled={disabled || transcribing}
      onClick={() => (recording ? stopRecording() : void startRecording())}
      aria-label={
        recording
          ? "Stop voice recording"
          : transcribing
            ? "Transcribing voice"
            : "Start voice input"
      }
      title={recording ? "Stop recording" : transcribing ? "Transcribing…" : "Speak"}
    >
      {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
