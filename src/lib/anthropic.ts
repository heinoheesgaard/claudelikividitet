import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

// Lazily constructed so a missing key only breaks the one feature that
// needs it (Julia chat) instead of failing at import time for every route
// that happens to pull in this module's dependency graph.
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY er ikke sat — tilføj den som miljøvariabel for at bruge Julia-chatten.",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}
