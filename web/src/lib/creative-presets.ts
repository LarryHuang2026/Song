export const creationPresets = {
  style: [
    "流行",
    "民谣",
    "爵士",
    "摇滚",
    "电子",
    "国风",
    "独立流行",
    "梦幻流行",
    "卧室流行",
    "R&B",
    "灵魂乐",
    "放克",
    "嘻哈",
    "Lo-fi",
    "City Pop",
    "复古迪斯科",
    "合成器流行",
    "独立摇滚",
    "流行朋克",
    "后摇",
    "轻音乐",
    "电影配乐",
    "古风",
    "世界音乐",
  ],
  mood: [
    "温暖",
    "松弛",
    "治愈",
    "欢快",
    "忧伤",
    "充满希望",
    "青春",
    "甜蜜",
    "俏皮",
    "梦幻",
    "空灵",
    "浪漫",
    "怀旧",
    "孤独",
    "克制",
    "释然",
    "热血",
    "自由",
    "神秘",
    "冷峻",
    "史诗",
    "安静",
    "慵懒",
    "迷幻",
  ],
  instruments: [
    "钢琴",
    "木吉他",
    "弦乐",
    "鼓",
    "贝斯",
    "合成器",
    "电吉他",
    "电钢琴",
    "尤克里里",
    "竖琴",
    "小提琴",
    "大提琴",
    "长笛",
    "萨克斯",
    "小号",
    "手碟",
    "口琴",
    "马林巴",
    "古筝",
    "琵琶",
    "二胡",
    "竹笛",
    "808 鼓机",
    "电子鼓",
  ],
};

// Labels are stored in existing drafts; detailed directions are compiled only
// into the provider prompt. Youthful profiles describe adult singing timbres.
export const vocalProfiles = [
  {
    label: "清甜少女感女声",
    group: "女声",
    gender: "female",
    description: "年轻成人的清甜声线，轻亮、自然，少用厚重胸声。",
    prompt:
      "清甜少女感女声，年轻成人、轻亮清甜、自然轻巧（female solo lead vocals, youthful young-adult tone, sweet and light, delicate delivery）。",
  },
  {
    label: "元气女声",
    group: "女声",
    gender: "female",
    description: "明亮、有活力，咬字轻快，适合青春感旋律。",
    prompt:
      "元气女声，年轻成人、明亮轻快、活泼有弹性（female solo lead vocals, bright youthful young-adult tone, playful and energetic articulation）。",
  },
  {
    label: "轻柔气声女声",
    group: "女声",
    gender: "female",
    description: "轻声、贴耳、带少量气息，减少用力唱腔。",
    prompt:
      "轻柔气声女声，柔软贴耳、气息轻盈、轻声演唱（female solo lead vocals, soft breathy intimate delivery, gentle light phrasing）。",
  },
  {
    label: "空灵女声",
    group: "女声",
    gender: "female",
    description: "轻盈通透、飘逸，有空气感和梦幻感。",
    prompt:
      "空灵女声，轻盈通透、飘逸空气感（female solo lead vocals, airy ethereal luminous timbre, floating gentle phrasing）。",
  },
  {
    label: "慵懒女声",
    group: "女声",
    gender: "female",
    description: "松弛、轻声、略带沙感，句尾自然收住。",
    prompt:
      "慵懒女声，松弛轻声、略带沙感、自然收尾（female solo lead vocals, relaxed soft slightly husky timbre, laid-back phrasing）。",
  },
  {
    label: "清澈女声",
    group: "女声",
    gender: "female",
    description: "干净通透、自然明亮，保持清晰咬字。",
    prompt:
      "清澈女声，干净通透、自然明亮、咬字清晰（female solo lead vocals, clean clear natural timbre, articulate delivery）。",
  },
  {
    label: "醇厚女声",
    group: "女声",
    gender: "female",
    description: "中低音温润饱满，情绪表达更沉稳。",
    prompt:
      "醇厚女声，中低音温润饱满、沉稳有质感（female solo lead vocals, warm rich rounded mid-low register, composed expressive delivery）。",
  },
  {
    label: "清透少年感男声",
    group: "男声",
    gender: "male",
    description: "年轻成人的清亮声线，轻薄自然，减少低沉厚重感。",
    prompt:
      "清透少年感男声，年轻成人、清亮轻薄、自然通透（male solo lead vocals, youthful young-adult light clear tenor, delicate natural delivery）。",
  },
  {
    label: "清爽校园男声",
    group: "男声",
    gender: "male",
    description: "干净、亲切、带一点青涩感，演唱轻松自然。",
    prompt:
      "清爽校园男声，年轻成人、干净亲切、略带青涩（male solo lead vocals, youthful young-adult fresh clean timbre, easy sincere delivery）。",
  },
  {
    label: "轻柔气声男声",
    group: "男声",
    gender: "male",
    description: "柔软、轻声、贴近耳边，保留细微气息。",
    prompt:
      "轻柔气声男声，柔软贴耳、轻声细腻（male solo lead vocals, soft breathy intimate timbre, delicate restrained delivery）。",
  },
  {
    label: "温暖男声",
    group: "男声",
    gender: "male",
    description: "温和、圆润、自然，不刻意压低声线。",
    prompt:
      "温暖男声，温和圆润、自然亲切（male solo lead vocals, warm rounded natural timbre, gentle sincere delivery）。",
  },
  {
    label: "低沉磁性男声",
    group: "男声",
    gender: "male",
    description: "低音饱满、稳重，突出共鸣与质感。",
    prompt:
      "低沉磁性男声，低音饱满、稳重共鸣（male solo lead vocals, deep resonant rich low register, steady grounded delivery）。",
  },
  {
    label: "沙哑颗粒男声",
    group: "男声",
    gender: "male",
    description: "略带沙哑和颗粒，情绪直接，避免过度嘶吼。",
    prompt:
      "沙哑颗粒男声，略带沙哑、颗粒质感、情绪直接（male solo lead vocals, textured slightly raspy timbre, expressive controlled delivery）。",
  },
  {
    label: "明亮摇滚男声",
    group: "男声",
    gender: "male",
    description: "明亮、有穿透力，强调力量和节奏。",
    prompt:
      "明亮摇滚男声，明亮有穿透力、节奏有力（male solo lead vocals, bright powerful rock tone, energetic rhythmic delivery）。",
  },
  {
    label: "清亮中性声",
    group: "中性与组合",
    gender: "neutral",
    description: "轻亮清透，减少明显的性别化音色特征。",
    prompt:
      "清亮中性声，轻亮清透、声线中性（androgynous solo lead vocals, light clear youthful timbre, natural delicate delivery）。",
  },
  {
    label: "柔和中性声",
    group: "中性与组合",
    gender: "neutral",
    description: "柔软温和、音色中性，适合轻声叙事。",
    prompt:
      "柔和中性声，柔软温和、中性音色（androgynous solo lead vocals, soft warm neutral timbre, intimate storytelling delivery）。",
  },
  {
    label: "男女对唱",
    group: "中性与组合",
    gender: "mixed",
    description: "两种声线交替演唱，副歌可加入和声。",
    prompt:
      "男女对唱，两位主唱交替演唱并适度和声（male and female duet, alternating lead lines, blended chorus harmonies）。",
  },
  {
    label: "女声二重唱",
    group: "中性与组合",
    gender: "female",
    description: "两位女声交替或叠唱，保留声线层次。",
    prompt:
      "女声二重唱，两位女声交替演唱与和声（female duet, two distinct female voices, alternating lines and layered harmonies）。",
  },
  {
    label: "男声二重唱",
    group: "中性与组合",
    gender: "male",
    description: "两位男声交替或叠唱，形成呼应。",
    prompt:
      "男声二重唱，两位男声交替演唱与和声（male duet, two distinct male voices, call-and-response and blended harmonies）。",
  },
  {
    label: "合唱",
    group: "中性与组合",
    gender: "mixed",
    description: "多声部共同演唱，营造层次与群体感。",
    prompt:
      "合唱，多位歌者、多声部交织（ensemble choir vocals, multiple singers, layered harmonies and a cohesive choral sound）。",
  },
] as const;
export const vocalGroups = ["女声", "男声", "中性与组合"] as const;
export const quickVocalLabels = [
  "清甜少女感女声",
  "清透少年感男声",
  "空灵女声",
  "清亮中性声",
];
export function vocalProfile(value: string) {
  return vocalProfiles.find((profile) => profile.label === value);
}
