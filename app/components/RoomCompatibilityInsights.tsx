'use client';

import { useState } from 'react';
import { Sparkles, ShieldAlert, Users2, ChevronRight, Crown, X, Scale } from 'lucide-react';
import { typeColor } from '@/lib/mbti';
import { TYPE_IMAGES } from '@/lib/type-images';
import { programmingTypeTable } from '@/lib/mbti-programming';
import { serviceTypeTable } from '@/lib/mbti-service';
import { presentationTypeTable } from '@/lib/mbti-presentation';
import { designTypeTable } from '@/lib/mbti-design';
import type { MbtiTypeInfo } from '@/lib/mbti';
import MatchingMethodInfo from './MatchingMethodInfo';

const TYPE_TABLES: Record<string, Record<string, MbtiTypeInfo>> = {
  programming: programmingTypeTable,
  service: serviceTypeTable,
  presentation: presentationTypeTable,
  design: designTypeTable,
};

const TEMPLATE_LABELS: Record<string, string> = {
  programming: 'Programming',
  service: 'Customer / Service',
  presentation: 'Presentation',
  design: 'Design / Creative',
};

function resolveTableKey(template: string): keyof typeof TYPE_TABLES {
  const t = template.toLowerCase();
  if (t.includes('service')) return 'service';
  if (t.includes('presentation')) return 'presentation';
  if (t.includes('design')) return 'design';
  return 'programming';
}

interface SynergyNote { gmailA: string; gmailB: string; score: number; reasons: string[]; avoid: boolean; }
interface RoomTypeRecommendation { code: string; avgScore: number; presentCount: number; }
export interface RoomInsights {
  bestPairs: SynergyNote[];
  cautionPairs: SynergyNote[];
  recommendedTypes: RoomTypeRecommendation[];
  skillDataCoverage: { membersWithHistory: number; totalMembers: number };
}
interface MemberLite { gmail: string; name: string; }

/** เลขอันดับกลม — คู่/type อันดับ 1 ใช้มงกุฎสีทองแทนเลข ให้เห็นเด่นว่าเป็นตัวเลือกที่ดีที่สุด */
function RankBadge({ rank, tone }: { rank: number; tone: 'good' | 'caution' | 'neutral' }) {
  if (rank === 1 && tone !== 'caution') {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
        <Crown size={13} className="text-white" fill="currentColor" />
      </div>
    );
  }
  const color = tone === 'good' ? 'bg-emerald-500' : tone === 'caution' ? 'bg-amber-500' : 'bg-[#4B3E7A]';
  return (
    <div className={`w-7 h-7 rounded-full ${color} text-white text-[11px] font-black flex items-center justify-center flex-shrink-0`}>
      {rank}
    </div>
  );
}

function ScoreBar({ score, tone }: { score: number; tone: 'good' | 'caution' | 'neutral' }) {
  const barColor = tone === 'good' ? '#10B981' : tone === 'caution' ? '#D97706' : '#4B3E7A';
  const trackColor = tone === 'good' ? '#D1FAE5' : tone === 'caution' ? '#FDE9C8' : '#EDE9FF';
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: trackColor }}>
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-[11px] font-black w-8 text-right" style={{ color: barColor }}>{score}%</span>
    </div>
  );
}

function SectionHeader({ icon, iconBg, iconColor, title }: { icon: React.ReactNode; iconBg: string; iconColor: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: iconBg, color: iconColor }}>
        {icon}
      </div>
      <p className="text-sm font-black text-gray-700">{title}</p>
    </div>
  );
}

export default function RoomCompatibilityInsights({
  roomInsights,
  template,
  members,
}: {
  roomInsights: RoomInsights;
  template: string;
  members: MemberLite[];
}) {
  const [open, setOpen] = useState(false);
  const tableKey = resolveTableKey(template);
  const table = TYPE_TABLES[tableKey];
  const templateLabel = TEMPLATE_LABELS[tableKey];

  const nameOf = (gmail: string) => members.find((m) => m.gmail === gmail)?.name ?? gmail;

  const hasAnyData =
    roomInsights.bestPairs.length > 0 ||
    roomInsights.cautionPairs.length > 0 ||
    roomInsights.recommendedTypes.length > 0 ||
    roomInsights.skillDataCoverage.totalMembers > 0;
  if (!hasAnyData) return null;

  return (
    <>
      {/* การ์ดสรุป — กดเพื่อดูรายละเอียดทั้งหมดแบบเต็มจอ */}
      <button
        onClick={() => setOpen(true)}
        className="w-full bg-white rounded-[20px] shadow-sm p-4 sm:p-5 flex items-center gap-4 text-left hover:shadow-md transition-all active:scale-[0.99] mb-2"
      >
        <div className="w-11 h-11 rounded-2xl bg-[#EDE9FF] flex items-center justify-center text-[#4B3E7A] flex-shrink-0">
          <Users2 size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#4B3E7A] text-sm sm:text-base">วิเคราะห์ความเข้ากันของห้องนี้</p>
          <p className="text-xs text-gray-400 mt-0.5">
            เข้ากันดี {roomInsights.bestPairs.length} คู่
            {roomInsights.cautionPairs.length > 0 && ` · ควรระวัง ${roomInsights.cautionPairs.length} คู่`}
            {roomInsights.recommendedTypes.length > 0 && ` · แนะนำ ${roomInsights.recommendedTypes.length} type สำหรับ ${templateLabel}`}
            {roomInsights.skillDataCoverage.totalMembers > 0 &&
              ` · มีประวัติประเมิน ${roomInsights.skillDataCoverage.membersWithHistory}/${roomInsights.skillDataCoverage.totalMembers} คน`}
          </p>
        </div>
        <ChevronRight size={20} className="text-gray-300 flex-shrink-0" />
      </button>

      {/* Modal เต็มข้อมูล */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-[24px] w-full max-w-lg max-h-[85vh] shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-[#4B3E7A] to-[#3d3268] px-6 py-5 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="flex items-center gap-2 font-black text-white text-base sm:text-lg">
                  <Users2 size={18} /> วิเคราะห์ความเข้ากันของห้องนี้
                </p>
                <p className="text-white/60 text-xs mt-1">อิงจาก MBTI ของสมาชิกทุกคนที่ join ห้องนี้จริง</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <MatchingMethodInfo iconSize={16} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-all" />
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-all"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 flex flex-col gap-6 overflow-y-auto bg-[#FAFAFC]">
              {roomInsights.skillDataCoverage.totalMembers > 0 && (
                <div>
                  <SectionHeader icon={<Scale size={14} />} iconBg="#EDE9FF" iconColor="#4B3E7A" title="คะแนนประเมินที่ใช้จับกลุ่มด้วย (30%)" />
                  <div className="bg-white border border-[#EDE9FF] rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500 leading-relaxed">
                      มีประวัติจากการประเมินเพื่อนร่วมทีมโปรเจกต์ก่อนหน้าแล้ว{' '}
                      <span className="font-black text-[#4B3E7A]">
                        {roomInsights.skillDataCoverage.membersWithHistory}/{roomInsights.skillDataCoverage.totalMembers} คน
                      </span>{' '}
                      — ที่เหลือเริ่มจากคะแนนกลางๆ ไม่เสียเปรียบ
                    </p>
                  </div>
                </div>
              )}
              {roomInsights.bestPairs.length > 0 && (
                <div>
                  <SectionHeader
                    icon={<Sparkles size={14} />}
                    iconBg="#D1FAE5"
                    iconColor="#059669"
                    title="จับกลุ่มกับใครแล้วลงตัวที่สุดในห้องนี้"
                  />
                  <div className="flex flex-col gap-2">
                    {roomInsights.bestPairs.map((p, i) => (
                      <div key={i} className="bg-white border border-emerald-100 rounded-2xl p-3.5 shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <RankBadge rank={i + 1} tone="good" />
                            <p className="text-sm font-bold text-gray-700 truncate">
                              {nameOf(p.gmailA)} <span className="text-emerald-400 mx-0.5">×</span> {nameOf(p.gmailB)}
                            </p>
                          </div>
                          <ScoreBar score={p.score} tone="good" />
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed pl-[38px]">{p.reasons.join('  ·  ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <SectionHeader
                  icon={<ShieldAlert size={14} />}
                  iconBg="#FDE9C8"
                  iconColor="#B45309"
                  title="คู่ที่ควรระวัง"
                />
                {roomInsights.cautionPairs.length === 0 ? (
                  <div className="bg-white border border-emerald-100 rounded-2xl p-4 flex items-center gap-3">
                    <span className="text-xl">🎉</span>
                    <p className="text-xs text-gray-500 leading-relaxed">ไม่มีคู่ที่ต้องระวังเป็นพิเศษในห้องนี้ — สมาชิกทุกคนมีสไตล์การทำงานที่เสริมกันได้ดี</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {roomInsights.cautionPairs.map((p, i) => (
                      <div key={i} className="bg-white border border-amber-100 rounded-2xl p-3.5 shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <RankBadge rank={i + 1} tone="caution" />
                            <p className="text-sm font-bold text-gray-700 truncate">
                              {nameOf(p.gmailA)} <span className="text-amber-400 mx-0.5">×</span> {nameOf(p.gmailB)}
                            </p>
                          </div>
                          <ScoreBar score={p.score} tone="caution" />
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed pl-[38px]">{p.reasons.join('  ·  ')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {roomInsights.recommendedTypes.length > 0 && (
                <div>
                  <SectionHeader
                    icon={<Sparkles size={14} />}
                    iconBg="#EDE9FF"
                    iconColor="#4B3E7A"
                    title={`MBTI ที่เข้ากับเพื่อนร่วมห้องนี้ได้ดีในบริบท ${templateLabel}`}
                  />
                  <div className="flex flex-col gap-2">
                    {roomInsights.recommendedTypes.map((r, i) => (
                      <div key={r.code} className="flex items-center gap-3 bg-white border border-[#EDE9FF] rounded-2xl p-3 shadow-sm">
                        <RankBadge rank={i + 1} tone="neutral" />
                        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: `${typeColor(r.code)}1A` }}>
                          <img src={TYPE_IMAGES[r.code]} alt={r.code} className="w-full h-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black truncate" style={{ color: typeColor(r.code) }}>
                            {r.code} · {table[r.code]?.title ?? r.code}
                          </p>
                          <p className="text-[11px] text-gray-400">มีในห้องนี้ {r.presentCount} คน</p>
                        </div>
                        <ScoreBar score={r.avgScore} tone="neutral" />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-3 leading-relaxed bg-white rounded-xl p-3 border border-gray-100">
                    จัดอันดับจากคะแนนความเข้ากันเฉลี่ยกับเพื่อนร่วมห้องคนอื่นๆ ที่ join ห้องนี้จริง ไม่ใช่ข้อสรุปตายตัวว่า type อื่นทำงานสาย {templateLabel} ไม่ได้
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
