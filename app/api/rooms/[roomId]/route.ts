import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Room, User } from '@/lib/models';
import { getSessionUser, isRoomHost, isGroupMember } from '@/lib/auth';
import { dateTimeStringToUtcDate } from '@/lib/date';
import { fetchMemberTypes, fetchMemberEvalScores, memberKey } from '@/lib/room-member-data';
import { categoryKeyForCode } from '@/lib/type-composition';
import { buildMatchPlans, buildRoomInsights, type MatchInputMember } from '@/lib/matching';
import { CRITERIA_KEYS } from '@/lib/peer-evaluation';

interface RoomMemberLike { name: string; gmail?: string; }
interface MatchedGroupLike { id: number; name: string; members: RoomMemberLike[]; leaderId?: string; leaderConfirmedBy?: string[]; }

const TITLE_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;
const TEAM_NAME_MAX_LENGTH = 50;
const MAX_TOTAL_MEMBERS = 300;
const MAX_GROUP_SIZE = 50;

// GET /api/rooms/:roomId → get room (with fresh avatarSeeds from User collection)
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  await connectDB();
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { roomId } = await params;
  const room = await Room.findOne({ roomId });
  if (!room) return NextResponse.json({ room: null }, { status: 404 });

  const roomObj = room.toObject();

  // Build gmail list from members
  const gmails: string[] = (roomObj.members ?? []).map((m: { gmail: string }) => m.gmail).filter(Boolean);

  // Fetch latest avatarSeed/avatarImage for all members + host in one go
  const [users, hostUser] = await Promise.all([
    gmails.length > 0 ? User.find({ gmail: { $in: gmails } }, { gmail: 1, avatarSeed: 1, avatarImage: 1, _id: 0 }) : Promise.resolve([]),
    User.findOne({ name: roomObj.hostName }, { avatarSeed: 1, avatarImage: 1, _id: 0 }),
  ]);

  const seedMap = new Map<string, number>(
    (users as { gmail: string; avatarSeed: number }[]).map((u) => [u.gmail, u.avatarSeed])
  );
  const imageMap = new Map<string, string | null>(
    (users as { gmail: string; avatarImage: string | null }[]).map((u) => [u.gmail, u.avatarImage])
  );

  // Patch members
  if (roomObj.members) {
    roomObj.members = roomObj.members.map((m: { gmail: string; avatarSeed: number; avatarImage?: string | null }) => ({
      ...m,
      avatarSeed: seedMap.get(m.gmail) ?? m.avatarSeed,
      avatarImage: imageMap.has(m.gmail) ? imageMap.get(m.gmail) : m.avatarImage,
    }));
  }

  // Patch matchedGroups members
  if (roomObj.matchedGroups) {
    roomObj.matchedGroups = roomObj.matchedGroups.map((g: { members: { gmail: string; avatarSeed: number; avatarImage?: string | null }[] }) => ({
      ...g,
      members: g.members.map((m) => ({
        ...m,
        avatarSeed: seedMap.get(m.gmail) ?? m.avatarSeed,
        avatarImage: imageMap.has(m.gmail) ? imageMap.get(m.gmail) : m.avatarImage,
      })),
    }));
  }

  // Patch host
  if (hostUser) {
    roomObj.hostAvatarSeed = (hostUser as { avatarSeed: number }).avatarSeed;
    roomObj.hostAvatarImage = (hostUser as { avatarImage: string | null }).avatarImage;
  }

  return NextResponse.json({ room: roomObj });
}

// PATCH /api/rooms/:roomId → mutate room state via an explicit action, each with its own authorization rule
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  await connectDB();
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { roomId } = await params;
  const body = await req.json();
  const { action } = body;

  const room = await Room.findOne({ roomId });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const caller = { gmail: sessionUser.gmail, name: sessionUser.name };

  switch (action) {
    case 'settings': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (room.matchDone) {
        return NextResponse.json({ error: 'จับกลุ่มไปแล้ว ไม่สามารถแก้ไขการตั้งค่าห้องได้' }, { status: 400 });
      }
      if (body.title !== undefined && String(body.title).length > TITLE_MAX_LENGTH) {
        return NextResponse.json({ error: `ชื่อห้องต้องไม่เกิน ${TITLE_MAX_LENGTH} ตัวอักษร` }, { status: 400 });
      }
      if (body.description !== undefined && String(body.description).length > DESCRIPTION_MAX_LENGTH) {
        return NextResponse.json({ error: `รายละเอียดต้องไม่เกิน ${DESCRIPTION_MAX_LENGTH} ตัวอักษร` }, { status: 400 });
      }

      let totalMembers: number | undefined;
      if (body.totalMembers !== undefined) {
        totalMembers = Number(body.totalMembers);
        if (!(totalMembers >= 1) || totalMembers > MAX_TOTAL_MEMBERS) {
          return NextResponse.json({ error: `จำนวนคนทั้งหมดต้องอยู่ระหว่าง 1-${MAX_TOTAL_MEMBERS} คน` }, { status: 400 });
        }
        if (totalMembers < (room.members ?? []).length) {
          return NextResponse.json({ error: `จำนวนคนทั้งหมดต้องไม่น้อยกว่าจำนวนคนที่เข้าร่วมแล้ว (${room.members.length} คน)` }, { status: 400 });
        }
      }

      let groupSize: number | undefined;
      if (body.groupSize !== undefined) {
        groupSize = Number(body.groupSize);
        if (!(groupSize >= 1) || groupSize > MAX_GROUP_SIZE) {
          return NextResponse.json({ error: `จำนวนคนต่อกลุ่มต้องอยู่ระหว่าง 1-${MAX_GROUP_SIZE} คน` }, { status: 400 });
        }
      }

      const effectiveTotal = totalMembers ?? room.totalMembers;
      const effectiveSize = groupSize ?? room.groupSize;
      if ((totalMembers !== undefined || groupSize !== undefined) && effectiveSize > effectiveTotal) {
        return NextResponse.json({ error: 'จำนวนคนต่อกลุ่ม ต้องไม่มากกว่าจำนวนคนทั้งหมด' }, { status: 400 });
      }

      let deadlineValue: Date | null | undefined;
      if (body.deadline !== undefined) {
        if (body.deadline === null || body.deadline === '') {
          deadlineValue = null;
        } else if (typeof body.deadline === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.deadline)) {
          deadlineValue = dateTimeStringToUtcDate(body.deadline);
          if (deadlineValue.getTime() < Date.now()) {
            return NextResponse.json({ error: 'วันสิ้นสุดต้องไม่ใช่เวลาที่ผ่านมาแล้ว' }, { status: 400 });
          }
        } else {
          return NextResponse.json({ error: 'วันสิ้นสุดไม่ถูกต้อง' }, { status: 400 });
        }
      }

      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (totalMembers !== undefined) patch.totalMembers = totalMembers;
      if (groupSize !== undefined) patch.groupSize = groupSize;
      if (deadlineValue !== undefined) patch.deadline = deadlineValue;

      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
      const updated = await Room.findOneAndUpdate({ roomId }, { $set: patch }, { returnDocument: 'after' });
      return NextResponse.json({ room: updated!.toObject() });
    }

    case 'previewMatch': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (room.matchDone) return NextResponse.json({ error: 'จับกลุ่มไปแล้ว' }, { status: 400 });

      const roomObj = room.toObject();
      const membersList = (roomObj.members ?? []) as { name: string; gmail: string; avatarSeed: number; avatarImage?: string | null }[];
      if (membersList.length === 0) return NextResponse.json({ error: 'ห้องยังไม่มีสมาชิก' }, { status: 400 });
      const template = (roomObj.template ?? 'programming').toLowerCase();
      const [typesByName, evalByName] = await Promise.all([
        fetchMemberTypes(template, membersList),
        fetchMemberEvalScores(membersList),
      ]);
      const matchInput: MatchInputMember[] = membersList.map((m) => {
        const key = memberKey(m);
        const t = typesByName[key];
        const criteria = evalByName[key]?.criteria;
        return {
          gmail: m.gmail,
          name: m.name,
          avatarSeed: m.avatarSeed,
          avatarImage: m.avatarImage,
          code: t?.code ?? '',
          categoryKey: t?.code ? categoryKeyForCode(template, t.code) : null,
          evalScore: evalByName[key]?.overall ?? 50,
          skillVector: CRITERIA_KEYS.map((k) => criteria?.[k] ?? 50),
          evalCount: evalByName[key]?.count ?? 0,
        };
      });
      const preferredTypes = Array.isArray(body.preferredTypes)
        ? body.preferredTypes.filter((code: unknown): code is string => typeof code === 'string').slice(0, 16)
        : [];
      const customTypes = Array.isArray(body.customTypes)
        ? body.customTypes.filter((code: unknown): code is string => typeof code === 'string').slice(0, 16)
        : [];
      const useEvaluation = body.useEvaluation !== false;
      const plans = buildMatchPlans({
        members: matchInput,
        groupSize: roomObj.groupSize ?? 4,
        template,
        useEvaluation,
      }, preferredTypes, customTypes);
      return NextResponse.json({
        plans: plans.map((plan) => ({
          index: plan.index,
          explanation: plan.explanation,
          compatibilityPercent: plan.compatibilityPercent,
          evaluationUsed: plan.evaluationUsed,
          groups: plan.groups.map((group) => ({
            id: group.id,
            name: group.name,
            members: group.members.map((member) => ({ name: member.name, gmail: member.gmail, role: member.role })),
            synergyNotes: group.synergyNotes,
          })),
        })),
      });
    }

    case 'match': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      // Fast-path เฉยๆ ไม่ใช่ correctness guard ตัวจริง (ตัวจริงคือ findOneAndUpdate ด้านล่าง) —
      // แค่กันไม่ต้องคำนวณซ้ำโดยไม่จำเป็นตอนถูกเรียกซ้ำหลังจับกลุ่มเสร็จแล้ว
      if (room.matchDone) return NextResponse.json({ room: room.toObject() });

      const roomObj = room.toObject();
      const membersList = (roomObj.members ?? []) as { name: string; gmail: string; avatarSeed: number; avatarImage?: string | null }[];
      if (membersList.length === 0) return NextResponse.json({ error: 'ห้องยังไม่มีสมาชิก' }, { status: 400 });

      const template = (roomObj.template ?? 'programming').toLowerCase();

      const [typesByName, evalByName] = await Promise.all([
        fetchMemberTypes(template, membersList),
        fetchMemberEvalScores(membersList),
      ]);

      const matchInput: MatchInputMember[] = membersList.map((m) => {
        const key = memberKey(m);
        const t = typesByName[key];
        const criteria = evalByName[key]?.criteria;
        return {
          gmail: m.gmail,
          name: m.name,
          avatarSeed: m.avatarSeed,
          avatarImage: m.avatarImage,
          code: t?.code ?? '',
          categoryKey: t?.code ? categoryKeyForCode(template, t.code) : null,
          evalScore: evalByName[key]?.overall ?? 50,
          skillVector: CRITERIA_KEYS.map((k) => criteria?.[k] ?? 50),
          evalCount: evalByName[key]?.count ?? 0,
        };
      });

      const preferredTypes = Array.isArray(body.preferredTypes)
        ? body.preferredTypes.filter((code: unknown): code is string => typeof code === 'string').slice(0, 16)
        : [];
      const customTypes = Array.isArray(body.customTypes)
        ? body.customTypes.filter((code: unknown): code is string => typeof code === 'string').slice(0, 16)
        : [];
      const useEvaluation = body.useEvaluation !== false;
      const plans = buildMatchPlans({
        members: matchInput,
        groupSize: roomObj.groupSize ?? 4,
        template,
        useEvaluation,
      }, preferredTypes, customTypes);
      const requestedPlan = Number.isInteger(body.planIndex) ? Number(body.planIndex) : 1;
      const selectedPlan = plans.find((plan) => plan.index === requestedPlan) ?? plans[0];
      const matchedGroups = selectedPlan.groups;
      // ภาพรวมทั้งห้อง (ข้ามกลุ่ม) — คนละ scope กับ synergyNotes ต่อกลุ่มใน matchedGroups ด้านบน
      const roomInsights = buildRoomInsights(matchInput, template, useEvaluation);

      // Atomic: อัปเดตได้ก็ต่อเมื่อ matchDone ยังไม่ true ตอนที่เขียนจริง (ไม่ใช่แค่ตอนอ่านตอนต้นฟังก์ชัน)
      // กัน double-click/double-mount สองคำขอชนกันแล้วเขียนทับผลจับกลุ่มที่มีอยู่แล้ว
      const updated = await Room.findOneAndUpdate(
        { roomId, matchDone: { $ne: true } },
        { $set: { matchedGroups, roomInsights, matchDone: true, matchedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!updated) {
        // มีคำขออื่นจับกลุ่มสำเร็จไปก่อนแล้ว (race) → คืนสถานะปัจจุบันแทนที่จะ error หรือเขียนทับ
        const current = await Room.findOne({ roomId });
        return NextResponse.json({ room: current!.toObject() });
      }
      return NextResponse.json({ room: updated.toObject() });
    }

    case 'endActivity': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!room.matchDone) return NextResponse.json({ error: 'ยังไม่ได้จับกลุ่ม ไม่สามารถจบกิจกรรมได้' }, { status: 400 });
      if (room.endedManually) return NextResponse.json({ room: room.toObject() });

      // กิจกรรมจบก่อน แบบประเมินถึงเปิดให้ทำทีหลัง (ดู isRoomEnded + POST /api/evaluations) —
      // ห้ามเช็คว่าประเมินครบหรือยังตรงนี้ ไม่งั้นจะย้อนแย้งกันเอง (จบไม่ได้เพราะยังไม่ประเมิน แต่ประเมินไม่ได้เพราะยังไม่จบ)
      const updated = await Room.findOneAndUpdate({ roomId }, { $set: { endedManually: true } }, { returnDocument: 'after' });
      return NextResponse.json({ room: updated!.toObject() });
    }

    case 'vote': {
      const { groupId, targetName } = body;
      if (typeof groupId !== 'number' || typeof targetName !== 'string' || !targetName.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      const group: MatchedGroupLike | undefined = (room.matchedGroups ?? []).find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      if (!isGroupMember(caller, group)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!group.members.some((m) => m.name === targetName)) {
        return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
      }

      const groupKey = String(groupId);
      const afterVote = await Room.findOneAndUpdate(
        { roomId },
        { $set: { [`votes.${groupKey}.${sessionUser.name}`]: targetName } },
        { returnDocument: 'after' }
      );
      if (!afterVote) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

      // recompute the leader for this group from the up-to-date tally
      const votesForGroup: Record<string, string> = afterVote.votes?.[groupKey] ?? {};
      const tally: Record<string, number> = {};
      Object.values(votesForGroup).forEach((n) => { tally[n] = (tally[n] ?? 0) + 1; });
      const entries = Object.entries(tally);
      if (entries.length === 0) return NextResponse.json({ room: afterVote.toObject() });

      // เสมอกัน (พบบ่อยเมื่อกลุ่มเหลือ 2 คนแล้วต่างคนต่างโหวตให้กัน) → ไม่ประกาศผู้ชนะแบบสุ่ม
      // ปล่อยให้สมาชิกโหวตต่อจนกว่าคะแนนจะไม่เท่ากัน แทนที่จะเงียบๆ เลือกคนแรกที่เจอ
      const maxVotes = Math.max(...entries.map(([, c]) => c));
      const topEntries = entries.filter(([, c]) => c === maxVotes);
      if (topEntries.length > 1) {
        return NextResponse.json({ room: afterVote.toObject(), tied: true });
      }
      const winner = topEntries[0][0];

      // เปลี่ยนตัวหัวหน้าทีม → ต้องให้สมาชิกยืนยันใหม่ทั้งหมด
      const votePatch: Record<string, unknown> = { 'matchedGroups.$[g].leaderId': winner };
      if (winner !== group.leaderId) votePatch['matchedGroups.$[g].leaderConfirmedBy'] = [];
      const final = await Room.findOneAndUpdate(
        { roomId },
        { $set: votePatch },
        { arrayFilters: [{ 'g.id': groupId }], returnDocument: 'after' }
      );
      return NextResponse.json({ room: final!.toObject() });
    }

    case 'setLeader': {
      const { groupId, leaderName } = body;
      if (typeof groupId !== 'number' || typeof leaderName !== 'string' || !leaderName.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      const group: MatchedGroupLike | undefined = (room.matchedGroups ?? []).find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      if (!isGroupMember(caller, group)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!group.members.some((m) => m.name === leaderName)) {
        return NextResponse.json({ error: 'Invalid leader' }, { status: 400 });
      }
      const setLeaderPatch: Record<string, unknown> = { 'matchedGroups.$[g].leaderId': leaderName };
      if (leaderName !== group.leaderId) setLeaderPatch['matchedGroups.$[g].leaderConfirmedBy'] = [];
      const updated = await Room.findOneAndUpdate(
        { roomId },
        { $set: setLeaderPatch },
        { arrayFilters: [{ 'g.id': groupId }], returnDocument: 'after' }
      );
      return NextResponse.json({ room: updated!.toObject() });
    }

    case 'confirmLeader': {
      const { groupId } = body;
      if (typeof groupId !== 'number') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      const group: MatchedGroupLike | undefined = (room.matchedGroups ?? []).find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      if (!isGroupMember(caller, group)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!group.leaderId) return NextResponse.json({ error: 'ยังไม่มีหัวหน้าทีมให้ยืนยัน' }, { status: 400 });
      const updated = await Room.findOneAndUpdate(
        { roomId },
        { $addToSet: { 'matchedGroups.$[g].leaderConfirmedBy': sessionUser.name } },
        { arrayFilters: [{ 'g.id': groupId }], returnDocument: 'after' }
      );
      return NextResponse.json({ room: updated!.toObject() });
    }

    case 'renameTeam': {
      const { groupId, name } = body;
      if (typeof groupId !== 'number' || typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name required' }, { status: 400 });
      }
      if (name.trim().length > TEAM_NAME_MAX_LENGTH) {
        return NextResponse.json({ error: `ชื่อทีมต้องไม่เกิน ${TEAM_NAME_MAX_LENGTH} ตัวอักษร` }, { status: 400 });
      }
      const group: MatchedGroupLike | undefined = (room.matchedGroups ?? []).find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      if (!isGroupMember(caller, group)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const updated = await Room.findOneAndUpdate(
        { roomId },
        { $set: { 'matchedGroups.$[g].name': String(name).trim() } },
        { arrayFilters: [{ 'g.id': groupId }], returnDocument: 'after' }
      );
      return NextResponse.json({ room: updated!.toObject() });
    }

    case 'kickMember': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (room.matchDone) return NextResponse.json({ error: 'จับกลุ่มไปแล้ว ไม่สามารถเอาสมาชิกออกได้' }, { status: 400 });
      const { memberGmail } = body;
      if (typeof memberGmail !== 'string' || !memberGmail.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      if (memberGmail === room.hostGmail) {
        return NextResponse.json({ error: 'ไม่สามารถเอาผู้สร้างห้องออกจากห้องได้' }, { status: 400 });
      }
      const target: RoomMemberLike | undefined = (room.members ?? []).find((m: { gmail?: string }) => m.gmail === memberGmail);
      if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      const updated = await Room.findOneAndUpdate(
        { roomId },
        { $pull: { members: { gmail: memberGmail }, readyUsers: target.name } },
        { returnDocument: 'after' }
      );
      return NextResponse.json({ room: updated!.toObject() });
    }

    // สมาชิกในกลุ่มแจ้งว่าเพื่อนออกจากกลุ่มไปแล้ว — แค่ "แจ้ง" ไม่ได้ลบจริง ต้อง host กดยืนยันเอาออกอีกที
    // (กันไม่ให้เพื่อนที่ผิดใจกันรุมแจ้งไล่คนออกโดยไม่ได้ลาออกจริง)
    case 'reportLeave': {
      const { groupId, targetGmail } = body;
      if (typeof groupId !== 'number' || typeof targetGmail !== 'string' || !targetGmail.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      const group: MatchedGroupLike | undefined = (room.matchedGroups ?? []).find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      if (!isGroupMember(caller, group)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const target = group.members.find((m) => m.gmail === targetGmail);
      if (!target) return NextResponse.json({ error: 'Invalid target' }, { status: 400 });

      const already = (room.leaveRequests ?? []).some(
        (r: { groupId: number; targetGmail: string; reporterGmail: string }) =>
          r.groupId === groupId && r.targetGmail === targetGmail && r.reporterGmail === sessionUser.gmail
      );
      if (!already) {
        room.leaveRequests.push({
          groupId, targetGmail, targetName: target.name,
          reporterGmail: sessionUser.gmail, reporterName: sessionUser.name,
        });
        await room.save();
      }
      return NextResponse.json({ room: room.toObject() });
    }

    case 'dismissLeaveRequest': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const { requestId } = body;
      if (typeof requestId !== 'string' || !requestId.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      room.leaveRequests = (room.leaveRequests ?? []).filter(
        (r: { _id?: unknown }) => String(r._id) !== requestId
      );
      await room.save();
      return NextResponse.json({ room: room.toObject() });
    }

    // เอาสมาชิกออกจากกลุ่มหลังจับกลุ่มไปแล้ว (host เท่านั้น) — เช่น กรณีนักเรียนลาออกกลางเทอม
    case 'removeMemberFromGroup': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!room.matchDone) return NextResponse.json({ error: 'ยังไม่ได้จับกลุ่ม' }, { status: 400 });
      if (room.endedManually) return NextResponse.json({ error: 'กิจกรรมนี้จบแล้ว ไม่สามารถเอาสมาชิกออกได้' }, { status: 400 });
      const { groupId, memberGmail } = body;
      if (typeof groupId !== 'number' || typeof memberGmail !== 'string' || !memberGmail.trim()) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      const group = room.matchedGroups.find((g: { id: number }) => g.id === groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      const idx = group.members.findIndex((m: { gmail?: string }) => m.gmail === memberGmail);
      if (idx === -1) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      const [removed] = group.members.splice(idx, 1);
      // หัวหน้าทีมที่ถูกเอาออก → เคลียร์ตำแหน่งหัวหน้า บังคับให้สมาชิกที่เหลือเลือกใหม่ (vote/setLeader ปกติ)
      if (group.leaderId === removed.name) {
        group.leaderId = '';
        group.leaderConfirmedBy = [];
      }
      room.leaveRequests = (room.leaveRequests ?? []).filter(
        (r: { targetGmail: string }) => r.targetGmail !== memberGmail
      );
      await room.save();
      return NextResponse.json({ room: room.toObject() });
    }

    // ย้ายสมาชิกไปอีกกลุ่มหนึ่งในห้องเดียวกัน (host เท่านั้น) — เช่น กรณีเพื่อนผิดใจกันในทีม
    case 'moveMember': {
      if (!isRoomHost(caller, room)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!room.matchDone) return NextResponse.json({ error: 'ยังไม่ได้จับกลุ่ม' }, { status: 400 });
      if (room.endedManually) return NextResponse.json({ error: 'กิจกรรมนี้จบแล้ว ไม่สามารถย้ายสมาชิกได้' }, { status: 400 });
      const { gmail, fromGroupId, toGroupId } = body;
      if (typeof gmail !== 'string' || typeof fromGroupId !== 'number' || typeof toGroupId !== 'number') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      if (fromGroupId === toGroupId) {
        return NextResponse.json({ error: 'ต้นทางและปลายทางต้องไม่ใช่กลุ่มเดียวกัน' }, { status: 400 });
      }
      const fromGroup = room.matchedGroups.find((g: { id: number }) => g.id === fromGroupId);
      const toGroup = room.matchedGroups.find((g: { id: number }) => g.id === toGroupId);
      if (!fromGroup || !toGroup) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      const idx = fromGroup.members.findIndex((m: { gmail?: string }) => m.gmail === gmail);
      if (idx === -1) return NextResponse.json({ error: 'Member not found in source group' }, { status: 404 });
      if (toGroup.members.length >= room.groupSize) {
        return NextResponse.json({ error: 'กลุ่มปลายทางเต็มแล้ว' }, { status: 400 });
      }

      const [moved] = fromGroup.members.splice(idx, 1);
      // สร้าง plain object ใหม่แทนการ spread subdocument ตรงๆ — subdocument ของ mongoose มี own key เป็น
      // $__/_doc ไม่ใช่ field จริง ถ้า push ทั้ง object เดิมไปกลุ่มใหม่ ค่าจะไม่ถูก cast ตามที่ตั้งใจ
      toGroup.members.push({
        name: moved.name, avatarSeed: moved.avatarSeed, avatarImage: moved.avatarImage,
        gmail: moved.gmail, role: moved.role,
      });
      if (fromGroup.leaderId === moved.name) {
        fromGroup.leaderId = '';
        fromGroup.leaderConfirmedBy = [];
      }
      await room.save();
      return NextResponse.json({ room: room.toObject() });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// DELETE /api/rooms/:roomId → delete room (host only, verified via session)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  await connectDB();
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { roomId } = await params;
  const room = await Room.findOne({ roomId });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (!isRoomHost({ gmail: sessionUser.gmail, name: sessionUser.name }, room)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await Room.deleteOne({ roomId });
  return NextResponse.json({ ok: true });
}