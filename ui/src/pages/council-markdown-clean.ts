export function cleanMarkdownForDisplay(text: string): string {
  let fence: string | null = null;
  return text.split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    return fence ? line : line.replace(/<br\s*\/?\s*>/gi, line.startsWith("|") ? " " : "\n");
  }).join("\n");
}
