'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Copy, Settings, BookOpen, X, Home, Sparkles, CheckCircle2 } from 'lucide-react';
import Navbar from '../../navbar/page';
import { resolveAvatar } from '@/lib/avatar';
import { typeColor } from '@/lib/mbti';
import DeadlinePicker from '../../components/DeadlinePicker';
import MatchingMethodInfo from '../../components/MatchingMethodInfo';
import { MBTI_CODES } from '@/lib/mbti';

interface RoomMember { name: string; avatarSeed: number; avatarImage?: string | null; gmail: string; role?: string; }
interface CurrentRoom {
  id: string; roomId?: string; title: string; description: string;
  totalMembers: number; groupSize: number; template: string; deadline?: string | null;
  hostName: string; hostAvatarSeed: number; hostAvatarImage?: string | null; members: RoomMember[];
}

/** แปลง ISO date string (UTC จาก DB) ให้เป็น 'YYYY-MM-DDTHH:mm' ตามเขตเวลาไทย สำหรับใส่ค่าเริ่มต้นให้ DeadlinePicker */
const isoToLocalInput = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};

interface SettingsForm {
  title: string;
  description: string;
  totalMembers: string;
  groupSize: string;
  deadline: string;
}

interface PreviewPlan {
  index: number;
  explanation: string;
  compatibilityPercent: number;
  evaluationUsed: boolean;
  groups: { id: number; name: string; members: { name: string; gmail: string; role: string }[]; synergyNotes: { gmailA: string; gmailB: string; reasons: string[]; avoid: boolean }[] }[];
}

// ✅ ธีมสีตาม template ของห้อง (สีอ้างอิงจากหน้า templates / app/create/match)
const TEMPLATE_THEMES: Record<string, { bg: string; dark: string; accent: string; label: string }> = {
  programming:  { bg: '#FFAAAA', dark: '#D87878', accent: '#4F437B', label: 'PROGRAMMING' },
  service:      { bg: '#71EFB8', dark: '#5CC095', accent: '#FF4573', label: 'CUSTOMER / SERVICE' },
  presentation: { bg: '#EAFF48', dark: '#B2C334', accent: '#21871C', label: 'PRESENTATION' },
  design:       { bg: '#8C71EF', dark: '#6D58B9', accent: '#4B3E7A', label: 'DESIGN / CREATIVE' },
};
const DEFAULT_THEME = { bg: '#F8A4A4', dark: '#D87878', accent: '#4B3E7A', label: 'PROGRAMMING' };

// ✅ ข้อความ template ลอยผ่านจอเป็นพื้นหลัง (รูปแบบเดียวกับ app/create/match/page.tsx)
const BACKGROUND_FLOAT_TEXT = [
  { top: '6%',  left: '-10%', fontSize: 'clamp(1.2rem, 14vw, 5rem)',   rotate: '-24deg', opacity: 0.14, drift: 'waveDrift1', duration: '26s', delay: '0s' },
  { top: '20%', left: '-15%', fontSize: 'clamp(1.5rem, 20vw, 8rem)',  rotate: '16deg',  opacity: 0.12, drift: 'waveDrift2', duration: '32s', delay: '-4s' },
  { top: '38%', left: '-10%', fontSize: 'clamp(1rem,   12vw, 4rem)',  rotate: '-8deg',  opacity: 0.16, drift: 'waveDrift3', duration: '22s', delay: '-8s' },
  { top: '56%', left: '-15%', fontSize: 'clamp(1.5rem, 22vw, 9rem)',  rotate: '-18deg', opacity: 0.12, drift: 'waveDrift1', duration: '34s', delay: '-10s' },
  { top: '74%', left: '-10%', fontSize: 'clamp(1.2rem, 16vw, 6rem)',  rotate: '20deg',  opacity: 0.16, drift: 'waveDrift3', duration: '25s', delay: '-6s' },
  { top: '90%', left: '-15%', fontSize: 'clamp(1rem,   12vw, 4.5rem)',rotate: '-30deg', opacity: 0.14, drift: 'waveDrift2', duration: '30s', delay: '-14s' },
];

const ManualPage = () => {
  const router = useRouter();
  const [user, setUser]             = useState<{ name: string; avatarSeed: number; avatarImage?: string | null; role?: string } | null>(null);
  const [room, setRoom]             = useState<CurrentRoom | null>(null);
  const [members, setMembers]       = useState<RoomMember[]>([]);
  const [readyUsers, setReadyUsers] = useState<string[]>([]);
  const [copied, setCopied]           = useState(false);
  const [kickTarget, setKickTarget] = useState<RoomMember | null>(null);

  const [showSettings, setShowSettings]       = useState(false);
  const [settingsForm, setSettingsForm]       = useState<SettingsForm | null>(null);
  const [settingsError, setSettingsError]     = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);

  const [memberTypes, setMemberTypes] = useState<Record<string, { code: string; title: string; icon: string }>>({});
  const [previewPlans, setPreviewPlans] = useState<PreviewPlan[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(1);
  const [preferredTypes, setPreferredTypes] = useState<string[]>([]);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [useEvaluation, setUseEvaluation] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const lastMemberCountRef = useRef(-1);

  const getRoomId = (r: CurrentRoom) => r.roomId ?? r.id;

  const theme = TEMPLATE_THEMES[room?.template ?? ''] ?? DEFAULT_THEME;

  const openSettings = () => {
    if (!room) return;
    setSettingsForm({
      title: room.title ?? '',
      description: room.description ?? '',
      totalMembers: String(room.totalMembers ?? ''),
      groupSize: String(room.groupSize ?? ''),
      deadline: isoToLocalInput(room.deadline),
    });
    setSettingsError('');
    setShowSettings(true);
  };

  const handleSaveSettings = async () => {
    if (!room || !settingsForm || settingsLoading) return;
    const { title, description, totalMembers, groupSize, deadline } = settingsForm;

    if (!title.trim() || !description.trim() || !totalMembers || !groupSize) {
      setSettingsError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    const total = parseInt(totalMembers);
    const size = parseInt(groupSize);
    if (!(total >= 1) || !(size >= 1)) {
      setSettingsError('จำนวนคนไม่ถูกต้อง');
      return;
    }
    if (size > total) {
      setSettingsError('จำนวนคนต่อกลุ่ม ต้องไม่มากกว่าจำนวนคนทั้งหมด');
      return;
    }
    if (total < members.length) {
      setSettingsError(`จำนวนคนทั้งหมดต้องไม่น้อยกว่าจำนวนคนที่เข้าร่วมแล้ว (${members.length} คน)`);
      return;
    }

    setSettingsError('');
    setSettingsLoading(true);
    try {
      const res = await fetch(`/api/rooms/${getRoomId(room)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settings',
          title: title.trim(),
          description: description.trim(),
          totalMembers: total,
          groupSize: size,
          deadline: deadline || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsError(data.error ?? 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
        return;
      }

      const updatedRoom = { ...room, ...data.room, id: getRoomId(room) };
      setRoom(updatedRoom);
      localStorage.setItem('currentRoom', JSON.stringify(updatedRoom));
      setShowSettings(false);
    } catch {
      setSettingsError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchRoom = async (roomId: string, isHost: boolean) => {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.room) {
      const newMembers: RoomMember[] = data.room.members ?? [];
      setMembers(newMembers);
      setReadyUsers(data.room.readyUsers ?? []);
      // Fetch member-types only when member count changes
      if (isHost && newMembers.length !== lastMemberCountRef.current) {
        lastMemberCountRef.current = newMembers.length;
        const typesRes = await fetch(`/api/rooms/${roomId}/member-types?source=members`);
        if (typesRes.ok) {
          const typesData = await typesRes.json();
          setMemberTypes(typesData.types ?? {});
        }
      }
    }
  };

  useEffect(() => {
    const raw = localStorage.getItem('currentUser');
    if (raw) setUser(JSON.parse(raw));

    const roomRaw = localStorage.getItem('currentRoom');
    if (roomRaw) {
      const r: CurrentRoom = JSON.parse(roomRaw);
      setRoom(r);
      const parsedUser = raw ? JSON.parse(raw) : null;
      const isHost = parsedUser?.name === r.hostName;
      fetchRoom(getRoomId(r), isHost);
    }
  }, []);

  useEffect(() => {
    if (!room || !user) return;
    const isHost = user.name === room.hostName;
    const interval = setInterval(() => fetchRoom(getRoomId(room), isHost), 2000);
    return () => clearInterval(interval);
  }, [room, user]);

  const readyCount   = readyUsers.length;
  const totalMembers = room?.totalMembers ?? members.length;
  const isFull       = members.length >= totalMembers && totalMembers > 0;
  const isAllReady   = isFull && readyCount >= members.length && members.length > 0;

  const handleKick = async () => {
    if (!kickTarget || !room) return;
    const res = await fetch(`/api/rooms/${getRoomId(room)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kickMember', memberGmail: kickTarget.gmail }),
    });
    if (res.ok) setMembers((prev) => prev.filter((m) => m.gmail !== kickTarget.gmail));
    setKickTarget(null);
  };

  const handleCopy = () => {
    if (!room) return;
    try { navigator.clipboard.writeText(getRoomId(room)); } catch { const el = document.createElement("textarea"); el.value = getRoomId(room); document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMatchPreview = async () => {
    if (!room || previewLoading) return;
    setShowPreview(true);
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await fetch(`/api/rooms/${getRoomId(room)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'previewMatch',
          preferredTypes: customMode ? [] : preferredTypes,
          customTypes: customMode ? customTypes : [],
          useEvaluation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data.error ?? 'สร้างแผนแนะนำไม่สำเร็จ');
        return;
      }
      setPreviewPlans(data.plans ?? []);
      setSelectedPlan(1);
    } catch {
      setPreviewError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmMatch = async () => {
    if (!room || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await fetch(`/api/rooms/${getRoomId(room)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'match',
          planIndex: selectedPlan,
          preferredTypes: customMode ? [] : preferredTypes,
          customTypes: customMode ? customTypes : [],
          useEvaluation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data.error ?? 'บันทึกผลการจับกลุ่มไม่สำเร็จ');
        return;
      }
      localStorage.setItem('currentRoom', JSON.stringify({ ...room, ...data.room, id: getRoomId(room) }));
      router.push('/create/group');
    } catch {
      setPreviewError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes waveDrift1 {
          0%   { transform: translateX(-10vw) translateY(0vh); }
          50%  { transform: translateX(120vw) translateY(-6vh); }
          100% { transform: translateX(-10vw) translateY(0vh); }
        }

        @keyframes waveDrift2 {
          0%   { transform: translateX(-10vw) translateY(0vh); }
          50%  { transform: translateX(115vw) translateY(8vh); }
          100% { transform: translateX(-10vw) translateY(0vh); }
        }

        @keyframes waveDrift3 {
          0%   { transform: translateX(-10vw) translateY(0vh); }
          50%  { transform: translateX(125vw) translateY(-4vh); }
          100% { transform: translateX(-10vw) translateY(0vh); }
        }
      `}</style>

      <div className="h-dvh font-sans flex flex-col items-center overflow-hidden relative" style={{ background: theme.bg }}>
        {/* ✅ เลเยอร์พื้นหลัง template ลอยผ่านจอ */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
        >
          {BACKGROUND_FLOAT_TEXT.map((s, i) => (
            <div
              key={`text-${i}`}
              style={{
                position: 'absolute',
                top: s.top,
                left: s.left,
                transform: `rotate(${s.rotate})`,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  fontSize: s.fontSize,
                  color: `color-mix(in srgb, ${theme.dark} ${Math.round(s.opacity * 100)}%, ${theme.bg})`,
                  fontFamily: 'var(--font-luckiest-guy), Arial, sans-serif',
                  fontWeight: 900,
                  fontStyle: 'italic',
                  letterSpacing: '-0.03em',
                  whiteSpace: 'nowrap',
                  animation: `${s.drift} ${s.duration} linear infinite`,
                  animationDelay: s.delay,
                }}
              >
                {theme.label}
              </span>
            </div>
          ))}
        </div>

        <div className="relative z-20 w-full flex justify-center">
          <Navbar bgColor={theme.dark} nameColor="white" />
        </div>
      <div className="relative z-10 flex-1 w-full lg:max-w-6xl lg:px-4 lg:mt-4 flex flex-col min-h-0">
        <div className="lg:rounded-t-[40px] p-4 md:p-8 flex flex-wrap justify-between items-center shadow-[0_18px_40px_rgba(0,0,0,0.45)] gap-4 flex-shrink-0" style={{ background: theme.bg }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="hidden lg:flex w-10 h-10 bg-white/80 hover:bg-white rounded-full items-center justify-center shadow transition-all active:scale-95"
              style={{ color: theme.accent }}
              title="กลับหน้าหลัก"
            >
              <Home size={18} />
            </button>
            <h1 className="text-4xl md:text-5xl font-black italic tracking-tighter uppercase" style={{ color: theme.accent }}>{room?.template ?? 'PROGRAMMING'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/')}
              className="lg:hidden w-10 h-10 bg-white/80 hover:bg-white rounded-full flex items-center justify-center shadow transition-all active:scale-95"
              style={{ color: theme.accent }}
              title="กลับหน้าหลัก"
            >
              <Home size={18} />
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-3 px-5 py-2.5 rounded-full font-bold text-sm shadow-md transition-all active:scale-95 bg-white hover:bg-white/90"
              style={{ color: theme.accent }}
            >
              <span className="text-xl font-black tracking-wider">#{room ? getRoomId(room) : '...'}</span>
              <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full transition-all ${
                copied ? 'bg-green-400 text-white' : ''
              }`} style={!copied ? { backgroundColor: `${theme.accent}1A`, color: theme.accent } : undefined}>
                <Copy size={13} />
                <span className="hidden lg:inline">{copied ? 'Copied!' : 'Copy'}</span>
              </span>
            </button>
            <button
              onClick={openSettings}
              className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md hover:bg-white/90 active:scale-95 transition-all"
              style={{ color: theme.accent }}
              title="ตั้งค่าห้อง"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={() => room && router.push(`/create/mbti-guide?roomId=${getRoomId(room)}&template=${room.template ?? 'programming'}`)}
              className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md hover:bg-white/90 active:scale-95 transition-all"
              style={{ color: theme.accent }}
              title="MBTI Templates — คู่มือความเข้ากันของ MBTI"
            >
              <BookOpen size={20} />
            </button>
            {user?.name === room?.hostName && (
              <MatchingMethodInfo
                className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md hover:bg-white/90 active:scale-95 transition-all"
                style={{ color: theme.accent }}
              />
            )}
            {/* Mobile-only: compact match button */}
            {isAllReady && (
              <button
                onClick={() => user?.name === room?.hostName ? openMatchPreview() : router.push('/create/matching')}
                className="lg:hidden bg-[#FF8A00] text-white px-4 py-2 rounded-full font-black text-sm uppercase shadow-[0_4px_0_0_#D97706] hover:shadow-[0_2px_0_0_#D97706] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px] transition-all"
              >
                MATCH!
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-[#E5E7EB] p-4 lg:p-10 flex flex-col lg:flex-row gap-3 lg:gap-8 lg:border-b-8 lg:border-gray-300 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
          <div className="order-2 lg:order-1 overflow-y-auto flex flex-col gap-3 min-h-0 flex-1">
            {members.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 text-center text-gray-400 font-medium">รอนักเรียนเข้าร่วม...</div>
            ) : (
              members.map((member, idx) => {
                const isSelf = member.name === user?.name;
                return (
                <div key={idx} className="bg-white rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-2 shadow-sm cursor-pointer hover:scale-[1.01] transition-all border-2 border-transparent hover:border-blue-200">
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 rounded-full overflow-hidden bg-yellow-100 border border-gray-100">
                      <img src={resolveAvatar(member)} alt={member.name} className="w-full h-full object-contain" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-700 leading-tight truncate">{member.name}</p>
                        {isSelf && <span className="bg-[#7096D1] text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">คุณ</span>}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${(member.role ?? 'user') === 'host' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-500'}`}>{member.role ?? 'user'}</span>
                      {user?.name === room?.hostName && memberTypes[member.gmail ?? member.name] && (
                        <div className="flex items-center gap-1 mt-1">
                          <span
                            className="text-[10px] font-black px-1.5 py-0.5 rounded"
                            style={{ color: typeColor(memberTypes[member.gmail ?? member.name].code), backgroundColor: `${typeColor(memberTypes[member.gmail ?? member.name].code)}1A` }}
                          >
                            {memberTypes[member.gmail ?? member.name].code}
                          </span>
                          <span className="text-[10px] font-bold" style={{ color: theme.accent }}>{memberTypes[member.gmail ?? member.name].title}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className={`px-3 sm:px-6 py-1.5 rounded-xl font-bold text-xs sm:text-sm min-w-[64px] sm:min-w-[100px] text-center shadow-sm transition-colors ${readyUsers.includes(member.name) ? 'bg-[#608BC1] text-white' : 'bg-[#C86D6D] text-white'}`}>
                      {readyUsers.includes(member.name) ? 'ready' : 'wait'}
                    </div>
                    {user?.name === room?.hostName && !isSelf && (
                      <button
                        onClick={() => setKickTarget(member)}
                        title="เอาออกจากห้อง"
                        className="w-8 h-8 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all flex-shrink-0"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </div>

          <div className="order-1 lg:order-2 flex flex-col gap-6 lg:flex-1">
            <div className="bg-white rounded-[20px] p-5 sm:p-6 md:p-8 shadow-sm">
              <div className="flex items-center gap-4 mb-6 sm:mb-8">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-sky-200 flex-shrink-0">
                  <img src={user ? resolveAvatar(user) : '/img/p1.PNG'} alt="Host" className="w-full h-full object-contain" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-800">{user?.name ?? '...'}</p>
                    <span className="bg-[#94A3B8] text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tighter">HOST</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${user?.role === 'host' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-500'}`}>
                      {user?.role ?? 'host'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-xl font-bold text-gray-800">{room?.title ?? '...'}</p>
                <div className="grid grid-cols-2 gap-y-4 text-sm font-medium">
                  <div className="text-gray-500">
                    <p>{room?.description ?? ''}</p>
                    <p className="italic">{room ? `จำนวน ${room.totalMembers} คน กลุ่มละ ${room.groupSize} คน` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-xs">เข้าร่วมแล้ว:</p>
                    <p className="text-3xl font-black leading-none" style={{ color: theme.accent }}>{members.length}/{totalMembers}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden lg:flex flex-1 flex-col justify-end">
              {!isFull ? (
                <div className="bg-white rounded-[20px] overflow-hidden flex shadow-sm min-h-[120px] sm:min-h-[160px] border border-white/50">
                  <div className="flex-[3] flex flex-col items-center justify-center gap-1 px-2 sm:px-4">
                    <span className="text-xl sm:text-2xl md:text-4xl font-black italic tracking-tighter uppercase opacity-30 select-none" style={{ color: theme.accent }}>WAITING</span>
                    <span className="text-gray-400 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-center">รอคนเข้าห้องให้ครบ</span>
                  </div>
                  <div className="flex-[2] bg-gray-400 flex flex-col items-center justify-center text-white">
                    <span className="text-2xl sm:text-3xl md:text-6xl font-black leading-none">{members.length}/{totalMembers}</span>
                    <span className="text-[10px] sm:text-xs font-bold uppercase mt-2 tracking-widest opacity-80">คน</span>
                  </div>
                </div>
              ) : !isAllReady ? (
                <div className="bg-white rounded-[20px] overflow-hidden flex shadow-sm min-h-[120px] sm:min-h-[160px] border border-white/50">
                  <div className="flex-[3] flex items-center justify-center">
                    <span className="text-2xl sm:text-3xl md:text-6xl font-black italic tracking-tighter uppercase opacity-30 select-none" style={{ color: theme.accent }}>READY</span>
                  </div>
                  <div className="flex-[2] bg-[#7C3AED] flex flex-col items-center justify-center text-white">
                    <span className="text-2xl sm:text-3xl md:text-6xl font-black leading-none">{readyCount}/{totalMembers}</span>
                    <span className="text-[10px] sm:text-xs font-bold uppercase mt-2 tracking-widest opacity-80">Waiting...</span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => user?.name === room?.hostName ? openMatchPreview() : router.push('/create/matching')}
                  className="w-full relative group transition-transform active:scale-95">
                  <div className="absolute inset-0 bg-[#D97706] rounded-[20px] translate-y-2 group-active:translate-y-1"></div>
                  <div className="relative bg-[#FF8A00] hover:bg-[#FF9D2E] text-white py-6 sm:py-8 md:py-10 rounded-[20px] flex items-center justify-center transition-all border-b-4 border-white/20">
                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-black italic tracking-tighter uppercase drop-shadow-md">MATCH!</h1>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !previewLoading && setShowPreview(false)}>
          <div className="bg-white rounded-[24px] w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-xl font-black text-[#4B3E7A] flex items-center gap-2"><Sparkles size={20} /> เลือกแผนจับกลุ่ม</p>
                <p className="text-xs text-gray-500 mt-1">Manual: เลือก type ที่ต้องการเป็นแนวทาง แล้วเลือกแผนที่เหมาะที่สุด ระบบจะคำนวณและตรวจข้อมูลจริงอีกครั้งบน server</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center"><X size={16} /></button>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-black text-gray-700">type ที่ Host อยากให้มีในทีม</p>
                <button
                  type="button"
                  onClick={() => {
                    setCustomMode((value) => !value);
                    setPreviewPlans([]);
                    setPreviewError('');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all ${customMode ? 'bg-[#4B3E7A] text-white border-[#4B3E7A]' : 'bg-white text-[#4B3E7A] border-[#4B3E7A]'}`}
                >
                  {customMode ? 'กำหนดเอง: เปิด' : 'กำหนดเอง'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mb-2">
                {customMode ? 'เลือก type ที่ต้องการเอง ระบบจะพยายามกระจาย type เหล่านี้ในทุกแผน' : 'เลือก type ที่อยากให้ระบบใช้เป็นแนวทาง'}
              </p>
              <div className="flex flex-wrap gap-2">
                {MBTI_CODES.map((code) => {
                  const selectedTypes = customMode ? customTypes : preferredTypes;
                  const checked = selectedTypes.includes(code);
                  const present = Object.values(memberTypes).some((type) => type.code === code);
                  return (
                    <button key={code} type="button" onClick={() => {
                      const update = (prev: string[]) => checked ? prev.filter((value) => value !== code) : [...prev, code];
                      if (customMode) setCustomTypes(update);
                      else setPreferredTypes(update);
                      setPreviewPlans([]);
                    }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all ${checked ? 'bg-[#4B3E7A] text-white border-[#4B3E7A]' : 'bg-white text-gray-500 border-gray-200 hover:border-[#4B3E7A]'} ${!present ? 'opacity-50' : ''}`}>
                      {code}{present ? '' : ' · ไม่มีในห้อง'}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">คะแนนความเข้ากันคำนวณจากความต่างของแกน MBTI และแสดงเป็นเปอร์เซ็นต์ เพื่อช่วยตัดสินใจ ไม่ใช่การรับรองว่าทำงานร่วมกันได้แน่นอน</p>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-[#EDE9FF] bg-[#FAF9FF] p-3.5 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={useEvaluation}
                onChange={(event) => { setUseEvaluation(event.target.checked); setPreviewPlans([]); }}
                className="mt-0.5 h-4 w-4 accent-[#4B3E7A]"
              />
              <span>
                <span className="block text-sm font-black text-[#4B3E7A]">ใช้คะแนนประเมินเพื่อนร่วมทีมในการคำนวณ</span>
                <span className="block text-[11px] text-gray-500 mt-1">เมื่อเปิด ระบบใช้คะแนน 30% เพื่อกระจายทักษะให้แต่ละทีมใกล้ค่าเฉลี่ยของห้อง และใช้ MBTI 70% เป็นหลัก หากปิดจะใช้ MBTI 100%</span>
              </span>
            </label>

            {previewPlans.length === 0 && (
              <button
                type="button"
                onClick={openMatchPreview}
                disabled={previewLoading}
                className="w-full mb-4 py-3 rounded-2xl border-2 border-[#4B3E7A] text-[#4B3E7A] font-black hover:bg-[#F7F5FF] disabled:opacity-50"
              >
                {previewLoading ? 'กำลังคำนวณ...' : 'วิเคราะห์แผนตามตัวเลือกนี้'}
              </button>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {previewPlans.map((plan) => (
                <button key={plan.index} type="button" onClick={() => setSelectedPlan(plan.index)}
                  className={`text-left rounded-2xl border-2 p-3 transition-all ${selectedPlan === plan.index ? 'border-[#4B3E7A] bg-[#F7F5FF]' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-black text-[#4B3E7A]">แผนที่ {plan.index}</span>
                    {selectedPlan === plan.index && <CheckCircle2 size={18} className="text-[#4B3E7A]" />}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed mb-2">{plan.explanation}</p>
                  <div className="rounded-xl bg-white border border-gray-100 p-2 mb-2">
                    <p className="text-sm font-black text-[#4B3E7A]">ความเข้ากันเฉลี่ย {plan.compatibilityPercent}%</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {plan.evaluationUsed
                        ? 'MBTI 70% + คะแนนประเมิน 30%: กระจายทักษะให้สมดุลกับค่าเฉลี่ยทั้งห้อง'
                        : 'MBTI 100%: ไม่ใช้คะแนนประเมินในการเลือกกลุ่ม'}
                    </p>
                  </div>
                  {plan.groups.map((group) => {
                    const cautionCount = group.synergyNotes.filter((note) => note.avoid).length;
                    return <div key={group.id} className="border-t border-gray-100 py-2">
                      <p className="text-xs font-black text-gray-700">{group.name} · {group.members.length} คน</p>
                      <p className="text-[11px] text-gray-500 truncate">{group.members.map((member) => member.name).join(', ')}</p>
                      <p className={`text-[10px] font-bold mt-1 ${cautionCount ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {cautionCount ? `ควรระวัง ${cautionCount} คู่ — ดูเหตุผลหลังจับกลุ่ม` : 'สมาชิกมีแนวโน้มเสริมกันดี'}
                      </p>
                    </div>;
                  })}
                </button>
              ))}
            </div>
            {previewPlans.length === 0 && !previewLoading && <p className="text-sm text-gray-500 text-center py-6">ยังไม่มีแผนแนะนำ</p>}
            {previewError && <p className="text-red-500 text-sm font-bold mt-4">⚠️ {previewError}</p>}
            <button onClick={confirmMatch} disabled={previewLoading || previewPlans.length === 0} className="w-full mt-5 py-3 rounded-2xl bg-[#4B3E7A] text-white font-black hover:opacity-90 disabled:opacity-50">
              {previewLoading ? 'กำลังคำนวณ...' : `ยืนยันใช้แผนที่ ${selectedPlan}`}
            </button>
          </div>
        </div>
      )}

      {showSettings && settingsForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 py-8 overflow-y-auto" onClick={() => !settingsLoading && setShowSettings(false)}>
          <div className="bg-white rounded-[24px] p-6 w-full max-w-lg shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <p className="text-xl font-black text-gray-800">ตั้งค่าห้อง</p>
              <button
                onClick={() => !settingsLoading && setShowSettings(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* ชื่อกิจกรรม */}
              <div>
                <label className="text-xs font-bold text-gray-400 mb-1.5 block">ชื่อกิจกรรม</label>
                <input
                  type="text" maxLength={100}
                  value={settingsForm.title}
                  onChange={(e) => setSettingsForm((p) => p && { ...p, title: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-gray-800 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                />
              </div>

              {/* คำอธิบาย */}
              <div>
                <label className="text-xs font-bold text-gray-400 mb-1.5 block">คำอธิบาย</label>
                <textarea
                  rows={2} maxLength={500}
                  value={settingsForm.description}
                  onChange={(e) => setSettingsForm((p) => p && { ...p, description: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-gray-800 font-semibold resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                />
              </div>

              {/* จำนวนคน */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-400 mb-1.5 block">จำนวนคนทั้งหมด</label>
                  <input
                    type="number" min={1} max={300}
                    value={settingsForm.totalMembers}
                    onChange={(e) => setSettingsForm((p) => p && { ...p, totalMembers: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-gray-800 font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 mb-1.5 block">จำนวนคนต่อกลุ่ม</label>
                  <input
                    type="number" min={1} max={50}
                    value={settingsForm.groupSize}
                    onChange={(e) => setSettingsForm((p) => p && { ...p, groupSize: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-gray-800 font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                  />
                </div>
              </div>

              {/* วันเวลาสิ้นสุด */}
              <div>
                <label className="text-xs font-bold text-gray-400 mb-1.5 block">วันและเวลาสิ้นสุด (ไม่บังคับ)</label>
                <DeadlinePicker
                  value={settingsForm.deadline}
                  onChange={(deadline) => setSettingsForm((p) => p && { ...p, deadline })}
                />
                {settingsForm.deadline && (
                  <button
                    type="button"
                    onClick={() => setSettingsForm((p) => p && { ...p, deadline: '' })}
                    className="text-xs font-bold text-gray-400 hover:text-gray-600 mt-2 transition-colors"
                  >
                    ล้างวันที่
                  </button>
                )}
              </div>

            </div>

            {settingsError && (
              <p className="text-red-500 font-bold text-sm mt-4">⚠️ {settingsError}</p>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                disabled={settingsLoading}
                className="flex-1 py-3 rounded-2xl border-2 border-gray-200 font-bold text-gray-500 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={settingsLoading}
                className="flex-1 py-3 rounded-2xl bg-[#4B3E7A] text-white font-bold hover:opacity-90 transition-all active:scale-95 disabled:opacity-60"
              >
                {settingsLoading ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {kickTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => setKickTarget(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-black text-gray-800 mb-2">เอาสมาชิกออกจากห้อง</p>
            <p className="text-gray-500 text-sm mb-6">เอา <span className="font-bold text-gray-700">{kickTarget.name}</span> ออกจากห้องนี้?</p>
            <div className="flex gap-3">
              <button onClick={() => setKickTarget(null)} className="flex-1 py-3 rounded-2xl border-2 border-gray-200 font-bold text-gray-500 hover:bg-gray-50 transition-all">ยกเลิก</button>
              <button onClick={handleKick} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all active:scale-95">เอาออก</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default ManualPage;