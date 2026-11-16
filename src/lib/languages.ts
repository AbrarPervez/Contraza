export const CONTRAZA_LANGUAGES = [
  { code: "en", label: "English", nativeName: "English" },
  { code: "hi", label: "Hindi", nativeName: "हिन्दी" },
  { code: "te", label: "Telugu", nativeName: "తెలుగు" },
  { code: "ta", label: "Tamil", nativeName: "தமிழ்" },
  { code: "kn", label: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ml", label: "Malayalam", nativeName: "മലയാളം" },
  { code: "bn", label: "Bengali", nativeName: "বাংলা" },
  { code: "mr", label: "Marathi", nativeName: "मराठी" },
  { code: "gu", label: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "pa", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "ur", label: "Urdu", nativeName: "اردو" },
] as const;

export type ContrazaLanguage = (typeof CONTRAZA_LANGUAGES)[number]["code"];

export function isContrazaLanguage(value: unknown): value is ContrazaLanguage {
  return CONTRAZA_LANGUAGES.some((language) => language.code === value);
}

export function languageInstruction(code: ContrazaLanguage) {
  const language = CONTRAZA_LANGUAGES.find((item) => item.code === code) ?? CONTRAZA_LANGUAGES[0];
  if (code === "en") return "Respond in clear, professional English.";
  return `Respond in ${language.label} (${language.nativeName}). Preserve legal meaning, defined terms, clause numbering, dates, amounts, party names, and citations. Do not silently omit or simplify legal obligations. Where a legal term has no reliable equivalent, retain the original term and briefly explain it in ${language.label}. Keep the original contract text unchanged unless the user explicitly requests a translated or revised contract.`;
}

export function draftLanguageInstruction(code: ContrazaLanguage) {
  const language = CONTRAZA_LANGUAGES.find((item) => item.code === code) ?? CONTRAZA_LANGUAGES[0];
  if (code === "en") return "Draft the entire contract in clear, professional English.";
  return `Draft the entire contract in ${language.label} (${language.nativeName}). Use professional legal terminology appropriate for ${language.label}-speaking jurisdictions. Preserve party names, defined terms, dates, amounts, and citations as-is. Do not silently omit or simplify legal obligations. Where a legal term has no reliable equivalent in ${language.label}, retain the English term and provide a parenthetical explanation in ${language.label}.`;
}
