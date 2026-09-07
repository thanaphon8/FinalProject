'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Home, AlertCircle } from 'lucide-react';
import Navbar from '../navbar/page';
import { resolveAvatar } from '@/lib/avatar';

const CRITERIA = [
  { id: 'contribution',   label: 'การมีส่วนร่วมและลงมือทำงานจริง' },
  { id: 'responsibility', label: 'ความรับผิดชอบและตรงต่อเวลา' },
  { id: 'communication',  label: 'การสื่อสารและรับฟังความคิดเห็น' },
  { id: 'problemSolving', label: 'การแก้ไขปัญหาเมื่อเกิดอุปสรรค' },
  { id: 'teamwork',       label: 'คะแนนการทำงานร่วมกันเป็นทีมโดยรวม' },
] as const;

const RATING_LABELS = ['ปรับปรุง', 'พอใช้', 'ปานกลาง', 'ดี', 'ดีมาก'];
const COMMENT_MAX_LEN = 1000;

// Swipeable-stack tuning
const STACK_VISIBLE_DEPTH = 3;
const STACK_OFFSET_Y = 16;
const STACK_OFFSET_X = 22;
const STACK_SCALE_STEP = 0.05;
const SWIPE_THRESHOLD = 60;
const TAP_MOVE_TOLERANCE = 6;

interface Teammate { name: string; gmail: string; avatarSeed: number; avatarImage?: string | null; }
interface PendingRoom { roomId: string; roomTitle: string; groupId: number; teammates: Teammate[]; }
interface QueueItem { roomId: string; roomTitle: string; groupId: number; teammate: Teammate; }

// คีย์เฉพาะของ "การประเมินคนคนนี้ในกลุ่มนี้" — ใช้แยกคะแนนของแต่ละคนออกจากกัน
const keyFor = (item: Pick<QueueItem, 'roomId' | 'groupId' | 'teammate'>) =>
  `${item.roomId}:${item.groupId}:${item.teammate.gmail}`;

export default function EvaluationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // ห้องที่ยังมีแบบประเมินค้างอยู่ — แสดงเป็น "รายการห้อง" ก่อน (เหมือนหน้า myroom/myprojects)
  // ผู้ใช้ต้องกดเข้าไปทีละห้องเพื่อทำแบบประเมินของห้องนั้นๆ ไม่ปนกับห้องอื่น
  const [rooms, setRooms] = useState<PendingRoom[]>([]);
  // ห้องที่กำลังเปิดทำแบบประเมินอยู่ (null = ยังอยู่หน้ารายการห้อง)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [personIndex, setPersonIndex] = useState(0);
  // เก็บคะแนนแยกเป็นรายบุคคล (key = roomId:groupId:gmail) แทนที่จะใช้ตัวแปรเดียวรวมทุกคน
  // เดิมใช้ ratings ตัวเดียว แล้ว reset ด้วย useEffect ที่ผูกกับ roomId/groupId เท่านั้น
  // พอเปลี่ยนคนโดยห้อง/กลุ่มเดิม (กรณีปกติของการประเมินเพื่อนในทีมเดียวกัน) effect ไม่ทำงาน
  // คะแนนของคนแรกเลยค้างติดไปโชว์ที่การ์ดคนที่สอง — นี่คือสาเหตุของบัค "คะแนนถูกก็อปมา"
  const [ratingsMap, setRatingsMap] = useState<Record<string, Record<string, number>>>({});
  // ความคิดเห็นแบบข้อความ แยกเก็บรายบุคคลด้วยคีย์เดียวกับ ratingsMap (ไม่บังคับกรอก)
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [extra, setExtra] = useState<{ roomId: string; leaderId?: string; types: Record<string, { code: string }> } | null>(null);

  // --- swipeable-stack state ---
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragXRef = useRef(0);
  const movedRef = useRef(false);

  const loadPending = async () => {
    const res = await fetch('/api/evaluations');
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setRooms(data.pending ?? []);
    setLoading(false);
  };

  useEffect(() => { loadPending(); }, []);

  const openRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    setPersonIndex(0);
  };

  const backToList = () => {
    setActiveRoomId(null);
    setPersonIndex(0);
  };

  const currentRoom = rooms.find((r) => r.roomId === activeRoomId) ?? null;
  // คิวที่แสดงบนจอ = เฉพาะเพื่อนร่วมทีมของ "ห้องที่เปิดอยู่" เท่านั้น ห้องอื่นจะไม่ปรากฏมาปนจนกว่าจะกลับไปเลือกใหม่
  const queue: QueueItem[] = useMemo(
    () => (currentRoom
      ? currentRoom.teammates.map((t) => ({ roomId: currentRoom.roomId, roomTitle: currentRoom.roomTitle, groupId: currentRoom.groupId, teammate: t }))
      : []),
    [currentRoom]
  );
  const index = personIndex;
  const current = queue[index] ?? null;
  const currentKey = current ? keyFor(current) : null;
  const ratings = currentKey ? (ratingsMap[currentKey] ?? {}) : {};
  const comment = currentKey ? (commentMap[currentKey] ?? '') : '';

  const setRating = (criterionId: string, value: number) => {
    if (!currentKey) return;
    setRatingsMap((prev) => ({ ...prev, [currentKey]: { ...(prev[currentKey] ?? {}), [criterionId]: value } }));
  };

  const setComment = (value: string) => {
    if (!currentKey) return;
    setCommentMap((prev) => ({ ...prev, [currentKey]: value.slice(0, COMMENT_MAX_LEN) }));
  };

  useEffect(() => {
    if (!current) { setExtra(null); return; }
    if (extra?.roomId === current.roomId) return;

    (async () => {
      const [roomRes, typesRes] = await Promise.all([
        fetch(`/api/rooms/${current.roomId}`),
        fetch(`/api/rooms/${current.roomId}/member-types?groupId=${current.groupId}`),
      ]);
      const roomData = roomRes.ok ? await roomRes.json() : null;
      const typesData = typesRes.ok ? await typesRes.json() : null;
      const group = (roomData?.room?.matchedGroups ?? []).find((g: { id: number }) => g.id === current.groupId);
      setExtra({ roomId: current.roomId, leaderId: group?.leaderId, types: typesData?.types ?? {} });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.roomId, current?.groupId]);

  const answeredCount = useMemo(() => CRITERIA.filter((c) => ratings[c.id] !== undefined).length, [ratings]);
  const allAnswered = answeredCount === CRITERIA.length;

  const handleSubmit = async () => {
    if (!current || !currentKey || !allAnswered || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: current.roomId, toGmail: current.teammate.gmail, scores: ratings, comment }),
      });
      if (!res.ok) { setSubmitting(false); return; }
      setSubmittedKeys((prev) => new Set(prev).add(currentKey));
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 1400);
      if (personIndex + 1 < queue.length) {
        setPersonIndex(personIndex + 1);
      } else {
        await loadPending();
        setActiveRoomId(null);
        setPersonIndex(0);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleStackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (queue.length <= 1) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('textarea')) return;
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragXRef.current = 0;
    movedRef.current = false;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleStackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - dragStartXRef.current;
    dragXRef.current = delta;
    if (Math.abs(delta) > TAP_MOVE_TOLERANCE) movedRef.current = true;
    setDragX(delta);
  };

  const handleStackPointerEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    setDragX(0);
    const delta = dragXRef.current;
    if (queue.length > 1) {
      if (delta <= -SWIPE_THRESHOLD) {
        setPersonIndex((idx) => (idx + 1) % queue.length);
      } else if (delta >= SWIPE_THRESHOLD) {
        setPersonIndex((idx) => (idx - 1 + queue.length) % queue.length);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen font-sans flex flex-col" style={{ backgroundColor: '#1D324B' }}>
        <Navbar bgColor="#122031" nameColor="white" />
        <div className="flex-1 flex items-center justify-center text-white/60 font-bold">กำลังโหลด...</div>
      </div>
    );
  }

  // ---------- หน้ารายการห้อง (เลือกห้องที่จะทำแบบประเมิน) ----------
  if (!currentRoom) {
    return (
      <div
        className="h-dvh font-sans flex flex-col items-center overflow-hidden relative"
        style={{ background: '#D1D5DB' }}
      >
        <style>{`
          @keyframes slideUpIn { from { opacity: 0; transform: translateY(48px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>

        <div className="relative z-20 w-full">
          <Navbar />
        </div>

        <main className="relative z-10 flex-1 overflow-hidden w-full max-w-5xl px-4 flex flex-col sm:flex-row sm:items-start gap-3 pt-0 sm:pt-4 pb-4">

          {/* Back Button — desktop only */}
          <button onClick={() => router.push('/')}
            className="hidden sm:flex flex-shrink-0 mt-2 w-12 h-12 bg-white rounded-full items-center justify-center text-gray-600 shadow-[0_5px_0_0_#9ca3af] hover:shadow-[0_3px_0_0_#9ca3af] hover:translate-y-[2px] active:shadow-none active:translate-y-[5px] transition-all">
            <ChevronLeft size={24} strokeWidth={2.5} />
          </button>

          <div className="flex-1 overflow-y-auto h-full pb-2">
            <div className="mt-4 sm:mt-2 mb-1">
              <p className="text-[#1D324B] text-2xl font-black">แบบประเมินเพื่อนร่วมทีม</p>
              <p className="text-gray-500 font-medium text-sm mt-1">
                {rooms.length > 0
                  ? 'เลือกห้องที่ต้องการทำแบบประเมิน — ทำทีละห้อง คะแนนของแต่ละห้องจะไม่ปนกัน'
                  : 'ไม่มีแบบประเมินที่ต้องทำ'}
              </p>
            </div>

            {rooms.length === 0 ? (
              <div className="bg-white rounded-[24px] p-6 sm:p-8 md:p-12 shadow-sm flex flex-col items-center gap-4 text-gray-400 mt-4 animate-[slideUpIn_0.4s_ease-out]">
                <div className="text-6xl">🎉</div>
                <p className="font-bold text-lg">ประเมินครบทุกห้องแล้ว ขอบคุณครับ</p>
                <button
                  onClick={() => router.push('/')}
                  className="mt-2 bg-[#2D3E50] text-white px-8 py-3 rounded-2xl font-bold hover:bg-slate-700 transition-all active:scale-95"
                >
                  กลับหน้าหลัก
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 animate-[slideUpIn_0.4s_ease-out]">
                {rooms.map((room) => (
                  <div
                    key={room.roomId}
                    onClick={() => openRoom(room.roomId)}
                    className="bg-white rounded-[20px] shadow-sm overflow-hidden cursor-pointer hover:brightness-95 transition-all active:scale-[0.98]"
                  >
                    {/* Header */}
                    <div className="px-5 py-3" style={{ backgroundColor: '#FFAD60' }}>
                      <span className="text-xs font-black uppercase tracking-widest text-white/80">ประเมินเพื่อนร่วมทีม</span>
                    </div>

                    {/* Card body */}
                    <div className="p-5">
                      {/* Teammate avatars */}
                      <div className="flex -space-x-3 mb-4">
                        {room.teammates.slice(0, 4).map((t) => (
                          <img
                            key={t.gmail}
                            src={resolveAvatar(t)}
                            alt={t.name}
                            className="w-14 h-14 rounded-full object-cover border-2 border-white bg-sky-200"
                          />
                        ))}
                        {room.teammates.length > 4 && (
                          <div className="w-14 h-14 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                            +{room.teammates.length - 4}
                          </div>
                        )}
                      </div>

                      {/* Room info */}
                      <p className="font-bold text-gray-800 text-base mb-1">{room.roomTitle}</p>
                      <p className="text-gray-500 text-sm mb-3">{room.teammates.length} คนในกลุ่ม</p>

                      {/* Status + Action */}
                      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-red-500 text-xs font-bold">
                          <AlertCircle size={12} />ยังไม่ได้ประเมิน {room.teammates.length} คน
                        </span>
                        <span className="flex-shrink-0 bg-[#2D3E50] text-white text-xs font-bold px-4 py-2 rounded-xl">
                          ทำแบบประเมิน
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Back Button — mobile only, moved to bottom, scrolls with content */}
            <button onClick={() => router.push('/')}
              className="sm:hidden mt-4 w-12 h-12 bg-white rounded-full flex items-center justify-center text-gray-600 shadow-[0_5px_0_0_#9ca3af] hover:shadow-[0_3px_0_0_#9ca3af] hover:translate-y-[2px] active:shadow-none active:translate-y-[5px] transition-all">
              <ChevronLeft size={24} strokeWidth={2.5} />
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ---------- หน้าทำแบบประเมิน (เฉพาะห้องที่เลือก) ----------
  return (
    <div className="min-h-screen font-sans flex flex-col" style={{ backgroundColor: '#1D324B' }}>
      <Navbar bgColor="#122031" nameColor="white" />

      <div className="flex-1 flex flex-col items-center justify-start px-4 py-6">
        <div className="w-full max-w-2xl flex items-center gap-3 mb-1">
          <button
            onClick={backToList}
            className="w-9 h-9 flex-shrink-0 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
            title="กลับไปเลือกห้อง"
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
          <p className="text-white/70 font-bold text-sm flex-1">
            ประเมินเพื่อนร่วมทีม · ห้อง &ldquo;{currentRoom.roomTitle}&rdquo;
          </p>
          <button
            onClick={() => router.push('/')}
            title="กลับหน้าหลัก"
            className="w-9 h-9 flex-shrink-0 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <Home size={17} />
          </button>
        </div>
        <p className="text-white/40 font-medium text-xs mb-3">
          คนที่ {index + 1} จาก {queue.length} ในห้องนี้
        </p>

        {queue.length > 1 && (
          <div className="flex items-center gap-1.5 mb-4">
            {queue.map((item, qIdx) => {
              const done = submittedKeys.has(keyFor(item));
              const isCurrent = qIdx === index;
              return (
                <div
                  key={`${item.roomId}-${item.teammate.gmail}`}
                  title={item.teammate.name}
                  className="rounded-full transition-all"
                  style={{
                    width: isCurrent ? 20 : 7,
                    height: 7,
                    backgroundColor: done ? '#4ADE80' : isCurrent ? '#ffffff' : 'rgba(255,255,255,0.25)',
                  }}
                />
              );
            })}
          </div>
        )}

        <div
          className="relative w-full max-w-2xl"
          style={{
            touchAction: 'pan-y',
            marginBottom: queue.length > 1 ? Math.min(queue.length - 1, STACK_VISIBLE_DEPTH) * STACK_OFFSET_Y : 0,
          }}
        >
          {queue.map((item, qIdx) => {
            const i = ((qIdx - index) % queue.length + queue.length) % queue.length;
            const isFront = i === 0;
            const clampedI = Math.min(i, STACK_VISIBLE_DEPTH);
            const translateY = clampedI * STACK_OFFSET_Y;
            const translateX = isFront ? dragX : clampedI * STACK_OFFSET_X;
            const scale = 1 - clampedI * STACK_SCALE_STEP;
            const opacity = 1;
            const rotate = isFront ? 0 : clampedI * 1.2;
            const shadow = isFront
              ? '0 12px 24px rgba(0,0,0,0.18)'
              : `0 ${6 + clampedI * 5}px ${14 + clampedI * 8}px rgba(0,0,0,${0.16 + clampedI * 0.09})`;

            const person = item.teammate;
            const mbtiType = isFront ? extra?.types[person.gmail]?.code : undefined;
            const isLeader = isFront && extra?.leaderId === person.name;

            return (
              <div
                key={`${item.roomId}-${item.teammate.gmail}`}
                onPointerDown={isFront ? handleStackPointerDown : undefined}
                onPointerMove={isFront ? handleStackPointerMove : undefined}
                onPointerUp={isFront ? handleStackPointerEnd : undefined}
                onPointerCancel={isFront ? handleStackPointerEnd : undefined}
                className={`rounded-3xl overflow-hidden flex flex-col ${
                  isFront ? 'relative' : 'absolute inset-x-0 top-0 h-full'
                } ${
                  isFront ? (isDragging ? '' : 'transition-transform duration-300 ease-out') : 'transition-all duration-300 ease-out'
                } ${isFront ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
                style={{
                  transform: `translateY(${translateY}px) translateX(${translateX}px) rotate(${rotate}deg) scale(${scale})`,
                  zIndex: queue.length - clampedI,
                  opacity,
                  boxShadow: shadow,
                }}
              >
                {isFront ? (
                  <>
                    <div className="flex items-center gap-3 px-5 py-6" style={{ backgroundColor: '#CBD6E3' }}>
                      <img
                        src={resolveAvatar(person)}
                        alt={person.name}
                        className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-base text-gray-800 truncate">{person.name}</p>
                        <p className="text-sm text-gray-500">นักเรียน</p>
                      </div>
                      {isLeader && (
                        <img src="/img/crown.PNG" alt="หัวหน้ากลุ่ม" className="w-14 h-14 object-contain flex-shrink-0" />
                      )}
                      {mbtiType && (
                        <div
                          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0"
                          style={{ backgroundColor: '#6B63B5' }}
                        >
                          {mbtiType}
                        </div>
                      )}
                    </div>

                    <div className="bg-white">
                    {CRITERIA.map((criterion, idx) => (
                      <div key={criterion.id}>
                        {idx > 0 && <div className="h-px mx-5" style={{ backgroundColor: '#B0B5C8' }} />}
                        <div className="px-5 py-5">
                          <p className="font-semibold text-sm mb-4" style={{ color: '#2D3748' }}>
                            {criterion.label}
                          </p>
                          <div className="flex justify-between">
                            {[1, 2, 3, 4, 5].map(n => {
                              const selected = ratings[criterion.id] === n;
                              return (
                                <button
                                  key={n}
                                  onClick={() => setRating(criterion.id, n)}
                                  className="flex flex-col items-center gap-1.5"
                                >
                                  <div
                                    className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all active:scale-95"
                                    style={selected
                                      ? { backgroundColor: '#2D3E50', color: '#ffffff' }
                                      : { backgroundColor: '#ffffff', color: '#9CA3AF', border: '2px solid #CBD5E0' }
                                    }
                                  >
                                    {n}
                                  </div>
                                  <span className="text-[10px] font-medium text-gray-500 text-center leading-tight">
                                    {RATING_LABELS[n - 1]}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="h-px mx-5" style={{ backgroundColor: '#B0B5C8' }} />
                    <div className="px-5 py-5">
                      <p className="font-semibold text-sm mb-2" style={{ color: '#2D3748' }}>
                        ความคิดเห็นเพิ่มเติม <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
                      </p>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="เช่น ทำอะไรได้ดี หรืออยากให้ปรับอะไร..."
                        rows={3}
                        maxLength={COMMENT_MAX_LEN}
                        className="w-full rounded-xl px-3 py-2 text-sm resize-none focus:outline-none"
                        style={{ border: '2px solid #CBD5E0', color: '#2D3748' }}
                      />
                      <p className="text-right text-[10px] font-medium text-gray-400 mt-1">
                        {comment.length}/{COMMENT_MAX_LEN}
                      </p>
                    </div>

                    <div className="px-5 pb-6 pt-2">
                      <button
                        disabled={!allAnswered || submitting}
                        onClick={handleSubmit}
                        className="w-full py-3.5 rounded-2xl font-black text-white text-base transition-all active:scale-95 disabled:opacity-40"
                        style={{ backgroundColor: '#2D3E50' }}
                      >
                        {submitting ? 'กำลังส่ง...' : 'ส่งการประเมิน'}
                      </button>
                      {!allAnswered && (
                        <p className="text-center text-xs font-medium text-gray-400 mt-2">
                          ให้คะแนนแล้ว {answeredCount}/{CRITERIA.length} ข้อ — เหลืออีก {CRITERIA.length - answeredCount} ข้อ
                        </p>
                      )}
                      {justSubmitted && (
                        <p className="text-center text-xs font-bold mt-2" style={{ color: '#22C55E' }}>
                          ✓ บันทึกคะแนนของ {person.name} แล้ว
                        </p>
                      )}
                    </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-5 py-6" style={{ backgroundColor: '#CBD6E3' }}>
                      <img
                        src={resolveAvatar(person)}
                        alt={person.name}
                        className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-base text-gray-800 truncate">{person.name}</p>
                        <p className="text-sm text-gray-500">นักเรียน</p>
                      </div>
                      {submittedKeys.has(keyFor(item)) && (
                        <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-black">
                          ✓
                        </div>
                      )}
                    </div>
                    <div className="bg-white flex-1" />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}