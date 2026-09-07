export const CRITERIA_KEYS = [
  'contribution', 'responsibility', 'communication', 'problemSolving', 'teamwork',
] as const;
export type CriteriaKey = typeof CRITERIA_KEYS[number];

// ต้องมีผู้ประเมินอย่างน้อยเท่านี้ถึงจะเริ่มตัดค่าสุดโต่งทิ้ง — ถ้าตัดตอนมีคนน้อย (เช่น 3 คน ตัด 2)
// จะเหลือข้อมูลน้อยเกินไปจนไม่มีความหมาย แถมเดาได้ง่ายว่าใครถูกตัด (ทำลาย anonymity โดยพฤตินัย)
const MIN_COUNT_TO_TRIM = 5;

/**
 * ตัดคะแนนสุดโต่งทิ้งก่อนเฉลี่ย — ผู้ประเมิน 1 คนที่ให้คะแนนแย่/ดีเกินจริง (เช่นแกล้งเพื่อน)
 * จะไม่ลากค่าเฉลี่ยของทั้งกลุ่มไปทางใดทางหนึ่ง จัดอันดับจากคะแนนเฉลี่ยรวมของผู้ประเมินแต่ละคน (ไม่ใช่รายเกณฑ์)
 * แล้วตัดตัวสูงสุด/ต่ำสุดออกคนละ 1 คน
 */
export function trimOutliers<T extends Record<CriteriaKey, number>>(list: T[]): T[] {
  if (list.length < MIN_COUNT_TO_TRIM) return list;
  const ranked = list
    .map((s) => ({ s, mean: CRITERIA_KEYS.reduce((sum, k) => sum + s[k], 0) / CRITERIA_KEYS.length }))
    .sort((a, b) => a.mean - b.mean);
  return ranked.slice(1, -1).map((r) => r.s);
}

// น้ำหนักของ "คะแนนกลางๆ สมมติ" เทียบเท่าผู้ประเมินกี่คน — ใช้ MIN_COUNT_TO_TRIM เดียวกัน เพราะเป็นจุดเดียวกัน
// ที่เริ่มไว้ใจค่าเฉลี่ยได้ (คนละเรื่องกับ trim แต่ threshold ความน่าเชื่อถือควรสอดคล้องกัน)
const CONFIDENCE_PRIOR_COUNT = MIN_COUNT_TO_TRIM;
const NEUTRAL_RAW_SCORE = 3; // จุดกึ่งกลางสเกล 1-5

/**
 * ถ่วงคะแนนเฉลี่ยดิบเข้าหาคะแนนกลางๆ (3/5) ตามจำนวนผู้ประเมินจริง — ถูกประเมินแค่ 1 ครั้งจะยังไม่มีน้ำหนัก
 * เท่าคนที่มีประวัติถูกประเมินมาเยอะ ป้องกันไม่ให้คะแนนจากคนเดียวมีอิทธิพลเท่าค่าเฉลี่ยที่มาจากหลายคน
 */
export function shrinkTowardNeutral(rawAvg: number, count: number): number {
  return (rawAvg * count + NEUTRAL_RAW_SCORE * CONFIDENCE_PRIOR_COUNT) / (count + CONFIDENCE_PRIOR_COUNT);
}

// ครึ่งหนึ่งของ retention 180 วัน (RETENTION_SECONDS ใน lib/models.ts) — ยิ่งแบบประเมินเก่ายิ่งมีน้ำหนักลดลงเรื่อยๆ
// แบบ exponential แทนที่จะตัดทิ้งทันทีหรือถ่วงเท่ากันหมดจนกว่าจะโดน TTL ลบไปเลย
const RECENCY_HALF_LIFE_DAYS = 90;

/** น้ำหนักของแบบประเมิน 1 ใบตามอายุ (exponential decay) — วันนี้ = 1, ผ่านไป 90 วันเหลือ 0.5, 180 วันเหลือ 0.25 */
export function recencyWeight(createdAt: Date, now: number = Date.now()): number {
  const ageDays = Math.max(0, (now - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** ค่าเฉลี่ยถ่วงน้ำหนัก — เผื่อผลรวมน้ำหนักเป็น 0 (ไม่ควรเกิดขึ้นจริงเพราะ recencyWeight ให้ค่าบวกเสมอ) ก็ยัง fallback เป็นค่าเฉลี่ยธรรมดา */
export function weightedAverage(values: { value: number; weight: number }[]): number {
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight <= 0) return values.length ? values.reduce((sum, v) => sum + v.value, 0) / values.length : 0;
  return values.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight;
}
