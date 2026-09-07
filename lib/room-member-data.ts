import { User, PeerEvaluation } from '@/lib/models';
import { CRITERIA_KEYS, type CriteriaKey, trimOutliers, shrinkTowardNeutral, recencyWeight, weightedAverage } from '@/lib/peer-evaluation';

export interface RoomMemberRef {
  name: string;
  gmail?: string;
}

/** Key used for per-member result maps — gmail is the only field unique per user (User.name has no
 *  unique constraint), so two members sharing a display name must not collide in the output. */
export function memberKey(member: RoomMemberRef): string {
  return member.gmail ? member.gmail.toLowerCase() : member.name;
}

const LABEL_TO_ID: Record<string, string> = {
  'programming': 'programming',
  'service': 'service',
  'customer / service': 'service',
  'presentation': 'presentation',
  'design': 'design',
  'design / creative': 'design',
};

export function resolveTemplateKey(template: string): string {
  const rawTemplate = (template ?? '').toLowerCase();
  return LABEL_TO_ID[rawTemplate] ?? rawTemplate;
}

export interface MemberTypeData {
  code: string;
  title: string;
  icon: string;
  description: string;
  jobs: string[];
  typeScores: { title: string; icon: string; score: number }[];
}

/** Batch-resolves each member's User.types[templateKey], matching by gmail first then by name (legacy members). */
export async function fetchMemberTypes(
  template: string,
  members: RoomMemberRef[]
): Promise<Record<string, MemberTypeData>> {
  const templateKey = resolveTemplateKey(template);
  const types: Record<string, MemberTypeData> = {};

  const gmails = members.filter((m) => m.gmail).map((m) => m.gmail!.toLowerCase());
  const names = members.filter((m) => !m.gmail).map((m) => m.name);

  const [usersByGmail, usersByName] = await Promise.all([
    gmails.length ? User.find({ gmail: { $in: gmails } }) : Promise.resolve([]),
    names.length ? User.find({ name: { $in: names } }) : Promise.resolve([]),
  ]);

  const gmailMap = new Map(usersByGmail.map((u: { gmail: string; toObject: () => Record<string, unknown> }) => [u.gmail, u.toObject()]));
  const nameMap = new Map(usersByName.map((u: { name: string; toObject: () => Record<string, unknown> }) => [u.name, u.toObject()]));

  for (const member of members) {
    const userData = member.gmail ? gmailMap.get(member.gmail.toLowerCase()) : nameMap.get(member.name);
    if (!userData) continue;

    const userTypes = (userData.types as Record<string, unknown>) ?? {};
    const typeResult = userTypes[templateKey];

    if (typeResult && (typeResult as { icon?: string }).icon) {
      const t = typeResult as { code: string; title: string; icon: string; description?: string; jobs?: string[]; typeScores?: { title: string; icon: string; score: number }[] };
      types[memberKey(member)] = {
        code: t.code,
        title: t.title,
        icon: t.icon,
        description: t.description ?? '',
        jobs: t.jobs ?? [],
        typeScores: t.typeScores ?? [],
      };
    }
  }

  return types;
}

export interface EvalScoreData {
  overall: number;
  leadership: number;
  count: number;
  /** ค่าเฉลี่ยรายเกณฑ์ทั้ง 5 ด้าน (0-100, ถ่วงเข้าหาคะแนนกลางแบบเดียวกับ overall/leadership) —
   * ใช้ตอนจับกลุ่มเพื่อกระจายทักษะเฉพาะด้าน (เช่น cooperation/teamwork) แม่นกว่าดูแค่ค่าเฉลี่ยรวม */
  criteria: Record<CriteriaKey, number>;
}

/** Batch-resolves each member's cross-room peer-eval aggregate (trimmed-outlier average), by toGmail. */
export async function fetchMemberEvalScores(
  members: RoomMemberRef[]
): Promise<Record<string, EvalScoreData>> {
  const namesWithoutGmail = members.filter((m) => !m.gmail).map((m) => m.name);
  const usersByName: { name: string; gmail: string }[] = namesWithoutGmail.length
    ? await User.find(
        { name: { $in: namesWithoutGmail } },
        { name: 1, gmail: 1, _id: 0 }
      ).lean()
    : [];
  const gmailByName = new Map(usersByName.map((u) => [u.name, u.gmail.toLowerCase()]));

  // Resolved per member (not keyed by name) — two members sharing a display name must resolve independently.
  const resolvedGmails = members.map((member) => member.gmail?.toLowerCase() ?? gmailByName.get(member.name));

  const gmails = [...new Set(resolvedGmails.filter((g): g is string => !!g))];
  const evals: { toGmail: string; scores: Record<CriteriaKey, number>; createdAt: Date }[] = gmails.length
    ? await PeerEvaluation.find(
        { toGmail: { $in: gmails } },
        { toGmail: 1, scores: 1, createdAt: 1, _id: 0 }
      ).lean()
    : [];

  type ScoredEval = Record<CriteriaKey, number> & { createdAt: Date };
  const byGmail = new Map<string, ScoredEval[]>();
  for (const e of evals) {
    const list = byGmail.get(e.toGmail) ?? [];
    list.push({ ...e.scores, createdAt: e.createdAt });
    byGmail.set(e.toGmail, list);
  }

  const now = Date.now();
  const scores: Record<string, EvalScoreData> = {};
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const resolvedGmail = resolvedGmails[i];
    if (!resolvedGmail) continue;
    const rawList = byGmail.get(resolvedGmail);
    if (!rawList || rawList.length === 0) continue;
    // รองรับแบบประเมินรุ่นเก่าที่ไม่มีเกณฑ์ใหม่ โดยถือคะแนนที่หายเป็นค่ากลาง 3/5
    const normalizedList = rawList.map((s) =>
      ({ ...Object.fromEntries(CRITERIA_KEYS.map((k) => [k, s[k] ?? 3])), createdAt: s.createdAt } as ScoredEval)
    );
    const list = trimOutliers(normalizedList);

    // แบบประเมินยิ่งเก่ายิ่งมีน้ำหนักลดลง (exponential decay, half-life 90 วัน) — ผลงานล่าสุดสำคัญกว่าผลงานเก่า
    const avg = (key: CriteriaKey) =>
      weightedAverage(list.map((s) => ({ value: s[key] ?? 3, weight: recencyWeight(s.createdAt, now) })));
    // ถ่วงเข้าหาคะแนนกลางๆ ตามจำนวนผู้ประเมินจริง (rawList.length ไม่ใช่ list.length หลัง trim) —
    // ความเชื่อมั่นในค่าเฉลี่ยขึ้นกับจำนวนคนที่ประเมินทั้งหมด ไม่ใช่จำนวนที่เหลือหลังตัด outlier
    const overallAvg = shrinkTowardNeutral(
      CRITERIA_KEYS.reduce((sum, k) => sum + avg(k), 0) / CRITERIA_KEYS.length,
      rawList.length
    );
    const leadershipAvg = shrinkTowardNeutral(
      (avg('problemSolving') + avg('responsibility') + avg('teamwork')) / 3,
      rawList.length
    );
    const criteria = Object.fromEntries(
      CRITERIA_KEYS.map((k) => [k, Math.round(shrinkTowardNeutral(avg(k), rawList.length) * 20)])
    ) as Record<CriteriaKey, number>;

    scores[memberKey(member)] = {
      overall: Math.round(overallAvg * 20),
      leadership: Math.round(leadershipAvg * 20),
      count: rawList.length,
      criteria,
    };
  }

  return scores;
}
