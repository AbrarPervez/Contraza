export type ContractPlaceholder = { start: number; end: number; text: string; context: string };

export function contractPlaceholderLabel(content: string, field: ContractPlaceholder): string {
  const before = content.slice(Math.max(0, field.start - 220), field.start)
    .replace(/\[[^\]]*\]/g, " ").replace(/[*_#`|]/g, " ").replace(/\s+/g, " ").trim();
  const suffix = before.match(/\b(executed on|executed at|signed on|signed at|date of signing|place of signing|signing date|signing place|corporate identification number|registration number|authori[sz]ed signatory|rent due on|payable on|notice period|security deposit|monthly rent|witness(?:\s+[12])?(?:\s+name)?|name and address|name|address|boundaries and demarcation|area measurement basis|unit, building, survey or municipal identification)\s*[:;,]?\s*$/i)?.[1];
  if (suffix) return suffix.charAt(0).toUpperCase() + suffix.slice(1);
  if (/\bat\s*$/i.test(before) && /\b(executed|signed)\b/i.test(before)) return "Executed at";
  const explicit = field.text.slice(1, -1).replace(/^(?:insert|enter|specify)\s+/i, "").trim();
  if (/[a-z]/i.test(explicit)) return explicit.charAt(0).toUpperCase() + explicit.slice(1);
  const fragment = before.split(/[.;:\n]/).at(-1)?.trim() ?? "";
  const words = fragment.split(/\s+/).filter((word) => /[a-z]/i.test(word)).slice(-6).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Missing detail";
}

export function findContractPlaceholders(content: string): ContractPlaceholder[] {
  const matches = content.matchAll(/\[[^\[\]\n]{0,100}\]/g);
  return Array.from(matches)
    .filter((match) => !/^\[\d+\]$/.test(match[0]) && content[match.index + match[0].length] !== "(")
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      context: content.slice(Math.max(0, match.index - 80), match.index + match[0].length + 60).replace(/\s+/g, " ").trim(),
    }));
}

export function fillContractPlaceholders(content: string, values: Record<number, string>): string {
  return findContractPlaceholders(content).reverse().reduce((text, field) => {
    const value = values[field.start]?.trim();
    return value ? text.slice(0, field.start) + value + text.slice(field.end) : text;
  }, content);
}

function fieldIdentity(content: string, field: ContractPlaceholder): string | null {
  const label = field.text.slice(1, -1).replace(/^(?:insert|enter|specify)\s+/i, "").trim().toLowerCase();
  if (/[a-z]/i.test(label)) return `label:${label}`;
  const before = content.slice(Math.max(0, field.start - 140), field.start).replace(/[*_]/g, "");
  const partyMatches = Array.from(content.slice(0, field.start).matchAll(/\b(landlord|lessor|tenant|lessee)\b/gi));
  const party = partyMatches.at(-1)?.[1]?.toLowerCase();
  const scope = party === "lessor" ? "landlord" : party === "lessee" ? "tenant" : party;
  if (/(?:corporate identification number|CIN|registration number)\s*[:;,]?\s*$/i.test(before)) return scope ? `${scope}:registration` : null;
  if (/(?:executed|signed|signing).*?\bon\s*$/i.test(before) || /(?:date of signing|signing date)\s*[:;,]?\s*$/i.test(before)) return "signing:date";
  if (/(?:executed|signed|signing).*?\bat\s*$/i.test(before) || /(?:place of signing|signing place)\s*[:;,]?\s*$/i.test(before)) return "signing:place";
  const explicit = before.match(/(?:^|[\n.;|])\s*([a-z][a-z\s/&()'-]{2,60})\s*:\s*$/i);
  return explicit?.[1] ? `context:${explicit[1].trim().toLowerCase()}` : null;
}

export function matchingContractPlaceholders(content: string, target: ContractPlaceholder): ContractPlaceholder[] {
  const identity = fieldIdentity(content, target);
  return findContractPlaceholders(content).filter((field) => field.start === target.start || (identity !== null && fieldIdentity(content, field) === identity));
}

export function placeholderMarkdown(content: string): string {
  return findContractPlaceholders(content).reverse().reduce((text, field) =>
    text.slice(0, field.start) + `[${field.text.slice(1, -1) || "Blank"}](#contract-blank-${field.start})` + text.slice(field.end), content);
}