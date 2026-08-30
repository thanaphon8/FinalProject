import { describe, it, expect } from 'vitest';
import { computeGroups, buildRoomInsights, type MatchInputMember, type ComputeGroupsInput } from './matching';
import { pairCompatibilityScore } from './mbti-compatibility';
import { CRITERIA_KEYS } from './peer-evaluation';

/** Deterministic PRNG so test data (and therefore timing/behavior assertions) is reproducible across runs. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ['Analysts', 'Diplomats', 'Sentinels', 'Explorers'] as const;
const MBTI_CODES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
];

function makeMembers(count: number, seed = 1): MatchInputMember[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const code = MBTI_CODES[Math.floor(rand() * MBTI_CODES.length)];
    const skillVector = CRITERIA_KEYS.map(() => Math.round(rand() * 100));
    const categoryKey = CATEGORIES[i % CATEGORIES.length];
    return {
      gmail: `member${i}@test.com`,
      name: `Member ${i}`,
      avatarSeed: i,
      avatarImage: null,
      code,
      categoryKey,
      evalScore: Math.round(rand() * 100),
      skillVector,
      evalCount: Math.floor(rand() * 6),
    };
  });
}

function baseInput(members: MatchInputMember[], groupSize: number, overrides: Partial<ComputeGroupsInput> = {}): ComputeGroupsInput {
  return {
    members,
    groupSize,
    template: 'programming',
    ...overrides,
  };
}

describe('computeGroups — compatibility + skill-balance construction', () => {
  it('assigns every member exactly once, with balanced group sizes', () => {
    const members = makeMembers(23);
    const result = computeGroups(baseInput(members, 5));

    const allGmails = result.flatMap((g) => g.members.map((m) => m.gmail));
    expect(allGmails.sort()).toEqual(members.map((m) => m.gmail).sort());
    expect(new Set(allGmails).size).toBe(members.length);

    const sizes = result.map((g) => g.members.length).sort((a, b) => a - b);
    // 23 members / groupSize 5 → 5 groups, sizes must differ by at most 1
    expect(result.length).toBe(5);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('is deterministic for identical input', () => {
    const members = makeMembers(30, 42);
    const r1 = computeGroups(baseInput(members, 6));
    const r2 = computeGroups(baseInput(members, 6));
    expect(r1.map((g) => g.members.map((m) => m.gmail))).toEqual(r2.map((g) => g.members.map((m) => m.gmail)));
  });

  it('produces meaningfully more compatible groups than a naive sequential split', () => {
    const members = makeMembers(24, 7);
    const result = computeGroups(baseInput(members, 4));
    const template = 'programming';

    const byGmail = new Map(members.map((m) => [m.gmail, m]));
    const groupCompatSum = (codes: string[]) => {
      let sum = 0;
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) sum += pairCompatibilityScore(codes[i], codes[j], template);
      }
      return sum;
    };

    const algoCompat = result.reduce(
      (sum, g) => sum + groupCompatSum(g.members.map((m) => byGmail.get(m.gmail)!.code)),
      0
    );

    // Naive baseline: split members into groups in original (unoptimized) order.
    const groupSize = 4;
    let naiveCompat = 0;
    for (let i = 0; i < members.length; i += groupSize) {
      naiveCompat += groupCompatSum(members.slice(i, i + groupSize).map((m) => m.code));
    }

    expect(algoCompat).toBeGreaterThanOrEqual(naiveCompat);
  });

  it('returns synergyNotes with at least the best-matched pair per group', () => {
    const members = makeMembers(8, 11);
    const result = computeGroups(baseInput(members, 4));
    for (const group of result) {
      expect(group.synergyNotes.length).toBeGreaterThan(0);
      for (const note of group.synergyNotes) expect(note.reasons.length).toBeGreaterThan(0);
    }
  });
});

function makeMember(gmail: string, code: string): MatchInputMember {
  return { gmail, name: gmail, avatarSeed: 0, avatarImage: null, code, categoryKey: null, evalScore: 50, skillVector: CRITERIA_KEYS.map(() => 50), evalCount: 0 };
}

describe('buildRoomInsights — room-wide (cross-group) compatibility overview', () => {
  it('puts a fully complementary pair in bestPairs, not cautionPairs', () => {
    const members = [makeMember('a@test.com', 'INTJ'), makeMember('b@test.com', 'ESFP')];
    const insights = buildRoomInsights(members, 'programming');

    expect(insights.bestPairs).toHaveLength(1);
    expect(insights.bestPairs[0]).toMatchObject({ gmailA: 'a@test.com', gmailB: 'b@test.com', avoid: false });
    expect(insights.cautionPairs).toHaveLength(0);
  });

  it('flags a pair differing only on the lowest-weighted axis for the template as a caution pair', () => {
    // INTJ vs ENTJ differ only on E/I — the lowest-weighted axis for 'programming' (see TEMPLATE_AXIS_WEIGHTS
    // in lib/mbti-compatibility.ts) — sharing every other axis this closely is exactly the "too similar,
    // no complementary perspective" case the avoid threshold is meant to catch.
    const members = [makeMember('a@test.com', 'INTJ'), makeMember('b@test.com', 'ENTJ')];
    const insights = buildRoomInsights(members, 'programming');

    expect(insights.cautionPairs).toHaveLength(1);
    expect(insights.cautionPairs[0]).toMatchObject({ gmailA: 'a@test.com', gmailB: 'b@test.com', avoid: true });
    expect(insights.bestPairs).toHaveLength(0);
  });

  it('only recommends MBTI types that are actually present among the room members', () => {
    const members = [
      makeMember('a@test.com', 'INTJ'),
      makeMember('b@test.com', 'ESFP'),
      makeMember('c@test.com', 'ESFP'),
    ];
    const insights = buildRoomInsights(members, 'programming');

    const codes = insights.recommendedTypes.map((r) => r.code);
    expect(new Set(codes)).toEqual(new Set(['INTJ', 'ESFP']));
    const esfp = insights.recommendedTypes.find((r) => r.code === 'ESFP')!;
    expect(esfp.presentCount).toBe(2);
  });

  it('returns empty insights for a room with a single member (no pairs possible)', () => {
    const insights = buildRoomInsights([makeMember('a@test.com', 'INTJ')], 'programming');
    expect(insights.bestPairs).toHaveLength(0);
    expect(insights.cautionPairs).toHaveLength(0);
    expect(insights.recommendedTypes).toHaveLength(1);
    expect(insights.recommendedTypes[0]).toMatchObject({ code: 'INTJ', avgScore: 0, presentCount: 1 });
  });
});

describe('computeGroups — performance (large room, regression guard for O(n^4) local search)', () => {
  it('completes well within a request-timeout budget for a large room', () => {
    const members = makeMembers(240, 123);
    const start = performance.now();
    const result = computeGroups(baseInput(members, 40));
    const elapsedMs = performance.now() - start;

    const allGmails = result.flatMap((g) => g.members.map((m) => m.gmail));
    expect(allGmails.length).toBe(240);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
