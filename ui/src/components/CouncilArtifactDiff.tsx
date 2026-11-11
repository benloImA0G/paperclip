import { useMemo } from "react";

type Props = { before: string; after: string; beforeLabel: string; afterLabel: string };
type Line = { kind: "same" | "added" | "removed"; text: string };

export function CouncilArtifactDiff({ before, after, beforeLabel, afterLabel }: Props) {
  const result = useMemo(() => {
    const oldLines = before === "" ? [] : before.split("\n");
    const newLines = after === "" ? [] : after.split("\n");
    if (oldLines.length > 2000 || newLines.length > 2000) return null;
    const width = newLines.length + 1;
    const lengths = new Uint16Array((oldLines.length + 1) * width);
    for (let i = oldLines.length - 1; i >= 0; i--) {
      for (let j = newLines.length - 1; j >= 0; j--) {
        lengths[i * width + j] = oldLines[i] === newLines[j]
          ? 1 + lengths[(i + 1) * width + j + 1]!
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
      }
    }
    const lines: Line[] = [];
    let i = 0, j = 0, added = 0, removed = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        lines.push({ kind: "same", text: oldLines[i++]! }); j++;
      } else if (j < newLines.length && (i === oldLines.length || lengths[i * width + j + 1]! > lengths[(i + 1) * width + j]!)) {
        lines.push({ kind: "added", text: newLines[j++]! }); added++;
      } else {
        lines.push({ kind: "removed", text: oldLines[i++]! }); removed++;
      }
    }
    return { lines, added, removed };
  }, [before, after]);

  const rendered = [];
  if (result) for (let i = 0; i < result.lines.length;) {
    const line = result.lines[i]!;
    if (line.kind === "same") {
      let end = i + 1;
      while (end < result.lines.length && result.lines[end]!.kind === "same") end++;
      if (end - i > 6) {
        rendered.push(<div key={i} className="text-muted-foreground">… {end - i} unchanged lines …</div>);
        i = end;
        continue;
      }
    }
    rendered.push(<div key={i} className={line.kind === "added" ? "bg-green-500/10" : line.kind === "removed" ? "bg-red-500/10" : "text-muted-foreground"}><span aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} </span>{line.kind !== "same" ? <span className="sr-only">{line.kind === "added" ? "Added: " : "Removed: "}</span> : null}{line.text || "\u00a0"}</div>);
    i++;
  }
  return <section aria-label={`Comparison of ${beforeLabel} and ${afterLabel}`} className="space-y-1 text-xs">
    <div className="text-muted-foreground">{beforeLabel} → {afterLabel}</div>
    {!result ? <p>Too large to compare</p> : <><p>{result.added} added, {result.removed} removed</p>{result.added === 0 && result.removed === 0 ? <p>No changes</p> : <div className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">{rendered}</div>}</>}
  </section>;
}
