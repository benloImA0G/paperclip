import type { Db } from "@paperclipai/db";
import { aiConnectionService } from "./ai-connections.js";
import { councilChatService } from "./council-chat.js";
import { mulberry32 } from "./council-panel.js";

export type SeatProposal = { connectionId: string; vendor: string; model: string; name: string };
type Candidate = SeatProposal & { usable?: boolean };
type ExistingSeat = { vendor: string; model: string };

/** Model names that are not general chat models (embeddings, speech, images, music, parsers, moderation). */
const NON_CHAT_MODEL = /(embed|rerank|whisper|tts|speech|audio|transcri|image|imagen|veo|lyria|parse|moderat|guard|safety|ocr|diffusion|dall-?e|sora|clip)/i;

export function isLikelyChatModel(model: string): boolean {
  return !NON_CHAT_MODEL.test(model);
}

export function proposeSeats(candidates: readonly Candidate[], existingSeats: readonly ExistingSeat[], options: { count: number; seed?: number }): SeatProposal[] {
  const key = (vendor: string, model: string) => JSON.stringify([vendor.toLowerCase(), model.toLowerCase()]);
  const seen = new Set(existingSeats.map((seat) => key(seat.vendor, seat.model)));
  const shuffled = candidates.filter((candidate) => candidate.usable !== false && isLikelyChatModel(candidate.model));
  const rand = mulberry32(options.seed ?? Math.floor(Math.random() * 2 ** 31));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const groups = new Map<string, SeatProposal[]>();
  for (const candidate of shuffled) {
    const identity = key(candidate.vendor, candidate.model);
    if (seen.has(identity)) continue;
    seen.add(identity);
    // Diversify per connection: NVIDIA, Groq and Ollama all use the "openai" provider type but are different vendors.
    const group = groups.get(candidate.connectionId) ?? [];
    group.push({ connectionId: candidate.connectionId, vendor: candidate.vendor, model: candidate.model, name: candidate.name });
    groups.set(candidate.connectionId, group);
  }
  const result: SeatProposal[] = [];
  const limit = Math.max(0, Math.floor(options.count));
  while (result.length < limit && groups.size) {
    for (const [vendor, group] of groups) {
      const candidate = group.shift();
      if (candidate) result.push(candidate);
      if (!group.length) groups.delete(vendor);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export async function suggestCouncilSeats(db: Db, companyId: string, userId: string, roomId: string, options: { count: number; seed?: number }): Promise<SeatProposal[]> {
  const council = councilChatService(db);
  await council.getRoom(companyId, roomId);
  const [connections, seats] = await Promise.all([
    aiConnectionService(db).list(companyId, userId),
    council.listSeats(companyId, roomId),
  ]);
  const vendorByConnection = new Map(connections.map((connection) => [connection.id, connection.provider]));
  const existing = seats.flatMap((seat) => {
    const vendor = seat.connectionId && vendorByConnection.get(seat.connectionId);
    return vendor && seat.model ? [{ vendor, model: seat.model }] : [];
  });
  const available = connections.filter((connection) => connection.status === "connected" && connection.ownership === "shared" && connection.method === "api_key");
  const models = await Promise.all(available.map(async (connection) => {
    try {
      return await council.listModels(companyId, userId, connection.id, connection.grantId);
    } catch {
      return [];
    }
  }));
  const candidates = available.flatMap((connection, index) => models[index]!.map((model) => ({
    connectionId: connection.id, vendor: connection.provider, model, name: model.slice(0, 80),
  })));
  return proposeSeats(candidates, existing, options);
}
