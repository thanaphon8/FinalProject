export type Axis = 'EI' | 'SN' | 'TF' | 'JP';
export type Letter = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P';

export interface MbtiQuestion {
  id: number;
  text: string;
  dimension: Axis;
  /** the letter that answering "เห็นด้วย" (low end of the 1-7 scale) points toward */
  pole: Letter;
}

export interface MbtiTypeInfo {
  title: string;
  description: string;
  jobs: string[];
}

/** number of questions per axis actually asked in one quiz attempt — also the max magnitude of an axis score */
export const AXIS_MAX = 15;

const AXES: Axis[] = ['EI', 'SN', 'TF', 'JP'];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Randomly draws `perAxis` questions per axis (EI/SN/TF/JP, in that order) from a larger question bank,
 * so a quiz attempt is a fresh subset each time instead of always the same fixed set.
 * Keeps `perAxis` (== AXIS_MAX) questions per axis so scoreMbti/buildAxisBars' math is unaffected.
 */
export function sampleQuestions(bank: MbtiQuestion[], perAxis: number): MbtiQuestion[] {
  return AXES.flatMap((axis) => {
    const filtered = bank.filter((q) => q.dimension === axis);
    // ถ้าคลังคำถามถูกแก้ในอนาคตจนแกนไหนเหลือน้อยกว่าที่ต้องสุ่ม ให้ throw ทันทีแทนที่จะคืนคำถามน้อยกว่าที่ควรแบบเงียบๆ
    // (ไม่งั้น totalPages/AXIS_MAX ที่หน้า quiz คำนวณไว้ตายตัวจะไม่ตรงกับ questions.length จริง)
    if (filtered.length < perAxis) {
      throw new Error(`sampleQuestions: axis ${axis} has only ${filtered.length} questions, need ${perAxis}`);
    }
    return shuffle(filtered).slice(0, perAxis);
  });
}

const pole = (val: number) => (val <= 3 ? 1 : val >= 5 ? -1 : 0);

const AXIS_POSITIVE_LETTER: Record<Axis, Letter> = { EI: 'E', SN: 'S', TF: 'T', JP: 'J' };

export function scoreMbti(questions: MbtiQuestion[], answers: Record<number, number>) {
  const axisScore: Record<Axis, number> = { EI: 0, SN: 0, TF: 0, JP: 0 };
  for (const q of questions) {
    const contribution = pole(answers[q.id]);
    const sign = q.pole === AXIS_POSITIVE_LETTER[q.dimension] ? 1 : -1;
    axisScore[q.dimension] += sign * contribution;
  }
  const E = axisScore.EI >= 0;
  const S = axisScore.SN >= 0;
  const T = axisScore.TF >= 0;
  const J = axisScore.JP >= 0;
  const code = `${E ? 'E' : 'I'}${S ? 'S' : 'N'}${T ? 'T' : 'F'}${J ? 'J' : 'P'}`;
  return { code, axisScore };
}

const AXIS_ICON: Record<Axis, string> = {
  EI: '/img/make.png',
  SN: '/img/idea.png',
  TF: '/img/brain.png',
  JP: '/img/pencil.png',
};

export const AXIS_LABEL: Record<Axis, [string, string]> = {
  EI: ['E · เปิดเผย เข้าสังคม', 'I · ใคร่ครวญ สงบนิ่ง'],
  SN: ['S · ปฏิบัติ ลงรายละเอียด', 'N · มองภาพรวม จินตนาการ'],
  TF: ['T · เหตุผล ตรรกะ', 'F · ความรู้สึก คน'],
  JP: ['J · วางแผน มีระบบ', 'P · ยืดหยุ่น ปรับตัว'],
};

/** returns 4 bars (one per axis) with score pre-normalized to a 0-100 percentage */
export function buildAxisBars(axisScore: Record<Axis, number>) {
  return (['EI', 'SN', 'TF', 'JP'] as Axis[]).map((key) => {
    const val = axisScore[key];
    const [posLabel, negLabel] = AXIS_LABEL[key];
    const pct = Math.round((Math.abs(val) / AXIS_MAX) * 100);
    return { title: val >= 0 ? posLabel : negLabel, icon: AXIS_ICON[key], score: pct };
  });
}

const AXIS_PARTNER: Record<Letter, Letter> = { E: 'I', I: 'E', S: 'N', N: 'S', T: 'F', F: 'T', J: 'P', P: 'J' };

/** 0-100 affinity toward `letter`, derived from whichever axis bar covers that letter's axis. */
export function letterAffinity(typeScores: { title: string; score: number }[], letter: Letter): number {
  const partner = AXIS_PARTNER[letter];
  const bar = typeScores.find((b) => b.title[0] === letter || b.title[0] === partner);
  if (!bar) return 50;
  return bar.title[0] === letter ? bar.score : 100 - bar.score;
}

/**
 * Heuristic leadership-fit score (0-100) computed from a member's actual quiz axis bars —
 * favors Extravert/Thinking/Judging leanings, the classic "natural leader" combination (ENTJ/ESTJ).
 */
export function leadershipScore(typeScores: { title: string; score: number }[]): number {
  return Math.round(
    (letterAffinity(typeScores, 'E') + letterAffinity(typeScores, 'T') + letterAffinity(typeScores, 'J')) / 3
  );
}

/** Keirsey-style temperament icon: NT→brain, NF→idea, SJ→make, SP→pencil */
export function typeIcon(code: string): string {
  const N = code[1] === 'N';
  const T = code[2] === 'T';
  const J = code[3] === 'J';
  if (N && T) return '/img/brain.png';
  if (N && !T) return '/img/idea.png';
  if (!N && J) return '/img/make.png';
  return '/img/pencil.png';
}

/** Temperament group color (NT/NF/SJ/SP), keyed to the same grouping as typeIcon() */
const TEMPERAMENT_COLOR: Record<'brain' | 'idea' | 'make' | 'pencil', string> = {
  brain: '#6D58B9',
  idea: '#3FA796',
  make: '#4F86C6',
  pencil: '#E08E45',
};

/** Color badge for a member's 4-letter MBTI code, grouped by the same temperament as typeIcon() */
export function typeColor(code: string): string {
  const N = code[1] === 'N';
  const T = code[2] === 'T';
  const J = code[3] === 'J';
  if (N && T) return TEMPERAMENT_COLOR.brain;
  if (N && !T) return TEMPERAMENT_COLOR.idea;
  if (!N && J) return TEMPERAMENT_COLOR.make;
  return TEMPERAMENT_COLOR.pencil;
}

/** Color for a Type Composition role label (e.g. 'นักวิเคราะห์'), derived from its temperament icon */
const ICON_TO_COLOR: Record<string, string> = {
  '/img/brain.png': TEMPERAMENT_COLOR.brain,
  '/img/idea.png': TEMPERAMENT_COLOR.idea,
  '/img/make.png': TEMPERAMENT_COLOR.make,
  '/img/pencil.png': TEMPERAMENT_COLOR.pencil,
};

export function roleColor(icon: string): string {
  return ICON_TO_COLOR[icon] ?? TEMPERAMENT_COLOR.brain;
}

export const MBTI_CODES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
] as const;
