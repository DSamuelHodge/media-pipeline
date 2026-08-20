export async function transcribeAudio(ai: Ai, audio: ArrayBuffer): Promise<Ai_Cf_Openai_Whisper_Large_V3_Turbo_Output> {
  const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
    audio: bytesToBase64(audio),
    task: "transcribe",
    vad_filter: true,
  });

  if (!result || typeof result.text !== "string") {
    throw new Error("whisper returned no transcription");
  }
  return result;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function transcriptMarkdown(title: string, text: string): string {
  return `# ${title}\n\n${text.trim()}\n`;
}
