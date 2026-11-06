export function untrusted(label: string, value: string): string {
  const safe = value.replace(/---(?=\s*(?:BEGIN|END) UNTRUSTED\b)/gi, "- - -");
  return `--- BEGIN UNTRUSTED ${label} ---\n${safe}\n--- END UNTRUSTED ${label} ---`;
}
