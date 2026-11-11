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

function stripPartialDelimiterSuffix(value: string, delimiter: string) {
  const maxLength = Math.min(value.length, delimiter.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(delimiter.slice(0, length))) return value.slice(0, -length);
  }
  return value;
}

export function parseUnstructuredDraftResponsePartial(response: string) {
  const start = response.indexOf(CONTRACT_START);
  if (start < 0) {
    return {
      reply: stripPartialDelimiterSuffix(response, CONTRACT_START).trim(),
      contractText: null,
    };
  }

  const replyBeforeContract = response.slice(0, start).trim();
  const contractAndTail = response.slice(start + CONTRACT_START.length);
  const end = contractAndTail.indexOf(CONTRACT_END);
  if (end < 0) {
    const contractText = stripPartialDelimiterSuffix(contractAndTail, CONTRACT_END).trim();
    return { reply: replyBeforeContract, contractText: contractText || null };
  }

  const contractText = contractAndTail.slice(0, end).trim();
  const replyAfterContract = contractAndTail.slice(end + CONTRACT_END.length).trim();
  return {
    reply: [replyBeforeContract, replyAfterContract].filter(Boolean).join("\n\n"),
    contractText: contractText || null,
  };
}
