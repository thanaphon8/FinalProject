import mongoose, { Schema } from 'mongoose';

// ห้อง/แชทที่ไม่มีการใช้งานนานเกินไปจะถูกลบอัตโนมัติ ป้องกัน DB โตไม่จำกัด
const RETENTION_SECONDS = 180 * 24 * 60 * 60; // 180 วัน

// ─── User ───────────────────────────────────────────────
const UserSchema = new Schema({
  name:       { type: String, required: true },
  gender:     { type: String, default: 'Male' },
  gmail:      { type: String, required: true, unique: true, lowercase: true },
  password:   { type: String, required: true },
  avatarSeed: { type: Number, default: 1 },
  avatarImage: { type: String, default: null },
  role:       { type: String, default: 'user' },
  types:      { type: Schema.Types.Mixed, default: {} },
  sessionToken: { type: String, default: null, index: true },
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });

UserSchema.index({ name: 1 });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ─── Room ───────────────────────────────────────────────
const RoomMemberSchema = new Schema({
  name:       String,
  avatarSeed: Number,
  avatarImage: { type: String, default: null },
  gmail:      String,
  role:       String,
}, { _id: false });

const SynergyNoteSchema = new Schema({
  gmailA:  String,
  gmailB:  String,
  score:   { type: Number, default: 0 },
  reasons: { type: [String], default: [] },
  avoid:   { type: Boolean, default: false },
}, { _id: false });

const MatchedGroupSchema = new Schema({
  id:       Number,
  name:     String,
  members:  [RoomMemberSchema],
  leaderId: String,
  leaderConfirmedBy: { type: [String], default: [] },
  synergyNotes: { type: [SynergyNoteSchema], default: [] },
}, { _id: false });

// วิเคราะห์ความเข้ากันของทั้งห้อง (ข้ามกลุ่ม) — คนละ scope กับ synergyNotes ต่อกลุ่มใน MatchedGroupSchema
const RoomInsightsSchema = new Schema({
  bestPairs:    { type: [SynergyNoteSchema], default: [] },
  cautionPairs: { type: [SynergyNoteSchema], default: [] },
  recommendedTypes: {
    type: [{ code: String, avgScore: Number, presentCount: Number, _id: false }],
    default: [],
  },
  evaluationUsed: { type: Boolean, default: true },
  scoringExplanation: { type: String, default: '' },
}, { _id: false });

// คำร้องที่สมาชิกในกลุ่มแจ้งว่าเพื่อนออกจากกลุ่มไปแล้ว (หลัง match) — host เป็นคนตัดสินใจเอาออกจริงหรือยกเลิกคำร้อง
const LeaveRequestSchema = new Schema({
  groupId:       { type: Number, required: true },
  targetGmail:   { type: String, required: true },
  targetName:    { type: String, required: true },
  reporterGmail: { type: String, required: true },
  reporterName:  { type: String, required: true },
}, { timestamps: true });

const RoomSchema = new Schema({
  roomId:         { type: String, required: true, unique: true },
  title:          { type: String, required: true },
  description:    { type: String, default: '' },
  totalMembers:   { type: Number, required: true },
  groupSize:      { type: Number, required: true },
  deadline:       { type: Date, default: null },
  template:       { type: String, default: 'PROGRAMMING' },
  hostName:       { type: String, required: true },
  hostGmail:      { type: String, default: '' },
  hostAvatarSeed: { type: Number, default: 0 },
  hostAvatarImage: { type: String, default: null },
  hostRole:       { type: String, default: 'host' },
  members:        { type: [RoomMemberSchema], default: [] },
  readyUsers:     { type: [String], default: [] },
  matchDone:      { type: Boolean, default: false },
  matchedAt:      { type: Date, default: null },
  endedManually:  { type: Boolean, default: false },
  matchedGroups:  { type: [MatchedGroupSchema], default: [] },
  roomInsights:   { type: RoomInsightsSchema },
  votes:          { type: Schema.Types.Mixed, default: {} },
  leaveRequests:  { type: [LeaveRequestSchema], default: [] },
}, { timestamps: true });

RoomSchema.index({ hostName: 1 });
RoomSchema.index({ 'members.gmail': 1 });
RoomSchema.index({ 'members.name': 1 });
RoomSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export const Room = mongoose.models.Room || mongoose.model('Room', RoomSchema);

// ─── PeerEvaluation ──────────────────────────────────────
// แบบประเมินเพื่อนร่วมทีมรายบุคคล เก็บหลังห้องสิ้นสุด ใช้ประกอบกับผล MBTI ในการจับกลุ่มครั้งต่อไป
const PeerEvaluationSchema = new Schema({
  roomId:    { type: String, required: true },
  groupId:   { type: Number, required: true },
  fromGmail: { type: String, required: true, lowercase: true },
  toGmail:   { type: String, required: true, lowercase: true },
  scores: {
    contribution:    { type: Number, required: true, min: 1, max: 5 },
    responsibility:  { type: Number, required: true, min: 1, max: 5 },
    communication:   { type: Number, required: true, min: 1, max: 5 },
    problemSolving:  { type: Number, required: true, min: 1, max: 5 },
    teamwork:        { type: Number, required: true, min: 1, max: 5 },
  },
  comment: { type: String, default: '', trim: true, maxlength: 1000 },
}, { timestamps: true });

PeerEvaluationSchema.index({ roomId: 1, fromGmail: 1, toGmail: 1 }, { unique: true });
PeerEvaluationSchema.index({ toGmail: 1 });
PeerEvaluationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export const PeerEvaluation = mongoose.models.PeerEvaluation || mongoose.model('PeerEvaluation', PeerEvaluationSchema);

// ─── Message ─────────────────────────────────────────────
const MessageSchema = new Schema({
  roomId:     { type: String, required: true },
  groupId:    { type: Number, required: true },
  sender:     { type: String, required: true },
  text:       { type: String, required: true },
  time:       { type: String, required: true },
  avatarSeed: { type: Number, default: 0 },
  avatarImage: { type: String, default: null },
}, { timestamps: true });

MessageSchema.index({ roomId: 1, groupId: 1 });
MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);