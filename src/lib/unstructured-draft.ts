const CONTRACT_START = "<<<CONTRAZA_CONTRACT_START>>>";
const CONTRACT_END = "<<<CONTRAZA_CONTRACT_END>>>";

export function parseUnstructuredDraftResponse(response: string) {
  const start = response.indexOf(CONTRACT_START);
  const end = response.indexOf(CONTRACT_END, start + CONTRACT_START.length);
  if (start < 0 || end < 0) {
    return { reply: response.trim(), contractText: null };
  }

  const contractText = response.slice(start + CONTRACT_START.length, end).trim();
  if (!contractText) return { reply: response.trim(), contractText: null };

  const reply = [response.slice(0, start).trim(), response.slice(end + CONTRACT_END.length).trim()]
    .filter(Boolean)
    .join("\n\n");
  return { reply, contractText };
}
