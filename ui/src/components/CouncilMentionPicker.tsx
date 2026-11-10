export function mentionToken(text: string, cursor: number) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor));
  return match ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] } : null;
}

export function startsWithSeatMention(text: string, seats: Array<{ name: string }>) {
  const lower = text.trimStart().toLowerCase();
  return seats.filter((seat) => {
    const mention = `@${seat.name.toLowerCase()}`;
    return lower.startsWith(mention) && (lower.length === mention.length || /\s/.test(lower[mention.length]));
  }).length === 1;
}

export function CouncilMentionPicker({ seats, selected, onChoose }: {
  seats: Array<{ id: string; name: string }>;
  selected: number;
  onChoose: (seat: { id: string; name: string }) => void;
}) {
  if (!seats.length) return null;
  return <div role="listbox" aria-label="Choose a seat" className="absolute bottom-full left-0 z-20 mb-2 rounded-md border bg-popover p-1 shadow-lg">
    {seats.map((seat, index) => <button key={seat.id} type="button" role="option" aria-selected={index === selected} className={`block w-full rounded-sm px-2 py-1 text-left text-sm ${index === selected ? "bg-accent" : "hover:bg-accent"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onChoose(seat)}>@{seat.name}</button>)}
  </div>;
}
