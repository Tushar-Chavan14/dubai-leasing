/** Read-aloud helpers. Only local voices (`localService === true`) are used, so reply text is never sent to a cloud speech service. */
export function localVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.localService === true);
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
  const arabic = /[؀-ۿ]/.test(text);
  const voices = localVoices();
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(arabic ? "ar" : "en")) ?? voices[0];
  if (!voice) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  window.speechSynthesis.speak(u);
}

export const stopSpeaking = () => {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
};
