import { COUNCIL_ROLE_PRESETS } from "./council-role-presets";

type FreeConnection = { id: string; name: string; provider?: string };

// Free connections are identified by groq, nvidia, gemini, ollama or local in their name or provider.
function vendorOf(connection: FreeConnection) {
  const text = `${connection.name} ${connection.provider ?? ""}`.toLowerCase();
  return (["groq", "gemini", "nvidia", "ollama", "local"] as const).find((vendor) => text.includes(vendor));
}

const models = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-3.5-flash-lite",
  nvidia: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  ollama: "gemma4:26b",
  local: "gemma4:26b",
};

export function planFreeTeam(connections: FreeConnection[], existingSeatNames: string[]) {
  const free = connections.filter((connection) => vendorOf(connection));
  const groq = free.findIndex((connection) => vendorOf(connection) === "groq");
  if (groq > 0) free.unshift(...free.splice(groq, 1));
  const names = new Set(existingSeatNames.map((name) => name.trim().toLowerCase()));
  const seenConnections = new Set<string>();
  return free.filter((connection) => {
    if (seenConnections.has(connection.id)) return false;
    seenConnections.add(connection.id);
    return true;
  }).slice(0, 4).flatMap((connection, index) => {
    const preset = COUNCIL_ROLE_PRESETS.find((candidate) => candidate.id === ["chairman", "builder", "reviewer", "contrarian"][index])!;
    if (names.has(preset.label.toLowerCase())) return [];
    names.add(preset.label.toLowerCase());
    return [{ connectionId: connection.id, connectionName: connection.name, model: models[vendorOf(connection)!], name: preset.label, roleId: preset.id, role: preset.role, persona: preset.persona }];
  });
}
