'use client';

import { useState } from 'react';
import { Info, X, Sparkles, ShieldCheck } from 'lucide-react';

const FACTORS = [
  {
    pct: '70%',
    title: 'ความหลากหลายบุคลิกภาพ (MBTI)',
    desc: 'จากผลแบบทดสอบ MBTI ของนักเรียนแต่ละคนในห้อง — จับให้แต่ละกลุ่มมีจุดเด่นที่หลากหลายไม่ซ้ำกัน',
  },
  {
    pct: '30%',
    title: 'ความสมดุลของทักษะ',
    desc: 'จากคะแนนที่เพื่อนร่วมทีมเคยประเมินกันในโปรเจกต์ก่อนหน้า (11 ด้าน เช่น ความรับผิดชอบ การสื่อสาร การแก้ปัญหา) — กระจายคนเก่ง/คนที่กำลังพัฒนาให้ทุกกลุ่มมีคุณภาพใกล้เคียงกัน',
  },
];

const SAFEGUARDS = [
  'คำนวณอัตโนมัติที่ server ทั้งหมด — host กดแค่ปุ่ม Match ไม่ต้องกรอกอะไรเพิ่ม และไม่มีใครแก้ผลลัพธ์จาก client ได้',
  'ถูกประเมินน้อยครั้ง คะแนนจะถูกดึงเข้าใกล้ค่ากลางอัตโนมัติ ยังไม่ปล่อยให้มีน้ำหนักเต็มจนกว่าจะมีประวัติมากพอ',
  'แบบประเมินยิ่งเก่ายิ่งมีน้ำหนักลดลง (ผ่านไป 90 วัน เหลือน้ำหนักครึ่งหนึ่ง) งานล่าสุดสำคัญกว่า',
  'ถ้ามีคนประเมินตั้งแต่ 5 คนขึ้นไป ระบบจะตัดคะแนนที่สุดโต่งเกินจริงทิ้งก่อนเฉลี่ย กันคนแกล้งให้คะแนนเพื่อน',
  'นักเรียนที่ยังไม่เคยถูกประเมิน (เช่นเทอมแรก) จะเริ่มจากคะแนนกลางๆ ไม่ใช่ 0 — ไม่เสียเปรียบ',
];

export default function MatchingMethodInfo({ className, style, iconSize = 20 }: { className?: string; style?: React.CSSProperties; iconSize?: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="ระบบจับกลุ่มทำงานอย่างไร"
        className={className ?? 'w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md hover:bg-white/90 active:scale-95 transition-all'}
        style={style}
      >
        <Info size={iconSize} />
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-[20px] w-full max-w-lg max-h-[85vh] shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-[#4B3E7A] px-6 py-4 flex items-center justify-between flex-shrink-0">
              <p className="font-black text-white text-lg">ระบบจับกลุ่มทำงานอย่างไร</p>
              <button onClick={() => setOpen(false)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-6 overflow-y-auto">
              {/* 2 factors */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-[#4B3E7A]" />
                  <p className="font-black text-sm text-[#4B3E7A]">ใช้ 2 ปัจจัยผสมกันในการจัดกลุ่ม</p>
                </div>
                <div className="flex flex-col gap-3">
                  {FACTORS.map((f) => (
                    <div key={f.title} className="flex items-start gap-3 bg-[#FAFAFC] rounded-2xl p-3.5 border border-gray-100">
                      <span className="flex-shrink-0 text-sm font-black text-white bg-[#4B3E7A] rounded-full px-2.5 py-1">{f.pct}</span>
                      <div>
                        <p className="font-bold text-sm text-gray-700">{f.title}</p>
                        <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Safeguards */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck size={16} className="text-emerald-600" />
                  <p className="font-black text-sm text-[#4B3E7A]">คะแนนประเมินถูกทำให้ยุติธรรมก่อนใช้งาน</p>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {SAFEGUARDS.map((s, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-gray-500 leading-relaxed">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
