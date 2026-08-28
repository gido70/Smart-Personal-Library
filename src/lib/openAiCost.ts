import type { AiUsageEvent } from "./library";

const PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.6-terra": { input: 2, output: 12 },
};

/**
 * Calculates the text-model portion from token counts returned by OpenAI.
 * Audio is deliberately excluded because the speech endpoint does not return
 * billable audio-token usage in the response used by this pilot.
 */
export function calculateLoggedTextCost(events: AiUsageEvent[]) {
  let usd = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;
  let audioCharacters = 0;

  for (const event of events) {
    if (event.action === "audio" || event.action === "audio_preview") {
      const characters = Number(event.metadata?.characters ?? 0);
      if (Number.isFinite(characters) && characters > 0) audioCharacters += characters;
      continue;
    }

    const price = PER_MILLION[event.model];
    if (!price || event.input_tokens == null || event.output_tokens == null) {
      unpricedCalls += 1;
      continue;
    }

    // GPT-5.6 requests above 272K input tokens use the documented long-context
    // multiplier for the whole request: 2x input and 1.5x output.
    const longContext = event.input_tokens > 272_000;
    const inputRate = price.input * (longContext ? 2 : 1);
    const outputRate = price.output * (longContext ? 1.5 : 1);
    usd += (event.input_tokens / 1_000_000) * inputRate;
    usd += (event.output_tokens / 1_000_000) * outputRate;
    pricedCalls += 1;
  }

  return { usd, pricedCalls, unpricedCalls, audioCharacters };
}
