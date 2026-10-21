import { vocalProfile } from "./creative-presets";
type VocalInput = {
  vocal: string;
  instrumental: boolean;
  description: string;
  style: string;
  mood: string;
  instruments: string;
};
const fields = {
  description: "创作描述",
  style: "音乐风格",
  mood: "情绪氛围",
  instruments: "乐器偏好",
} as const;
function conflictPattern(input: VocalInput) {
  if (input.instrumental)
    return /\b(?:male|female)(?:\s+(?:baritone|tenor|bass|soprano))?(?:\s+(?:lead|solo))?(?:\s+(?:vocals?|voice|singer|singing))?\b|\b(?:vocals?|singing|singer)\b|男中音|男低音|男高音|男女对唱|[男女]声|人声|演唱/gi;
  const gender = vocalProfile(input.vocal)?.gender;
  if (
    gender === "female" ||
    (!gender &&
      /女|\bfemale\b/i.test(input.vocal) &&
      !/男|\bmale\b/i.test(input.vocal))
  )
    return /\bmale(?:\s+(?:baritone|tenor|bass))?(?:\s+(?:lead|solo))?(?:\s+(?:vocals?|voice|singer|singing))?\b|\b(?:baritone|tenor)\b|男中音|男低音|男高音|男(?:声|歌手|生演唱)/gi;
  if (
    gender === "male" ||
    (!gender &&
      /男|\bmale\b/i.test(input.vocal) &&
      !/女|\bfemale\b/i.test(input.vocal))
  )
    return /\bfemale(?:\s+(?:soprano|alto))?(?:\s+(?:lead|solo))?(?:\s+(?:vocals?|voice|singer|singing))?\b|女高音|女中音|女低音|女(?:声|歌手|生演唱)/gi;
  return null;
}
function rewriteConflicts(input: VocalInput, text: string, remove: boolean) {
  const pattern = conflictPattern(input),
    terms: string[] = [];
  if (!pattern) return { text, terms };
  const cleaned = text.replace(pattern, (term: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - 45), offset);
    const after = text.slice(offset + term.length);
    if (
      /(?:\b(?:no|not|without|avoid|exclude)\s+(?:(?:any|a|the|solo|lead)\s+){0,2}|不要|不使用|不含|不带|无需|避免|禁止|没有|非)$/.test(
        before.toLowerCase(),
      ) ||
      /^(?:-free|less)\b/i.test(after)
    )
      return term;
    terms.push(term);
    return remove ? "" : term;
  });
  return { text: cleaned, terms };
}
export function vocalConflicts(input: VocalInput) {
  return Object.entries(fields).flatMap(([field, label]) => {
    const terms = rewriteConflicts(
      input,
      input[field as keyof typeof fields],
      false,
    ).terms;
    return terms.length ? [{ field, label, terms: [...new Set(terms)] }] : [];
  });
}
export function clearVocalConflicts<T extends VocalInput>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([field, value]) => [
      field,
      field in fields
        ? rewriteConflicts(input, String(value), true)
            .text.replace(/[,，、]\s*[,，、]+/g, "，")
            .replace(/^[\s,，、]+|[\s,，、]+$/g, "")
            .replace(/ {2,}/g, " ")
        : value,
    ]),
  ) as T;
}
export function vocalInstruction(
  input: Pick<VocalInput, "vocal" | "instrumental">,
) {
  if (input.instrumental)
    return "演唱要求：纯器乐，不使用人声（instrumental only, no vocals）。";
  const profile = vocalProfile(input.vocal);
  if (profile) return `演唱要求：${profile.prompt}`;
  return input.vocal ? `演唱要求：${input.vocal}。` : "";
}
