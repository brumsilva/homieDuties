export type Area = string;
export type TaskStatus = 'open' | 'done';

export interface Room {
  id: string;
  name: string;
  emoji: string;
}

export interface HomeTask {
  id: string;
  title: string;
  area: Area;
  roomId: string;
  description: string;
  frequency: string;
  status: TaskStatus;
  createdAt: string;
  availableAt: string;
  activityGroupId: string;
  points: number;
}

export interface HouseMember {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

export interface CompletionLog {
  id: string;
  taskId: string;
  taskTitle: string;
  area: Area;
  memberId: string;
  memberName: string;
  completedAt: string;
  note: string | null;
  photoPath: string;
  photoUrl?: string;
  activityGroupId: string;
  pointsEarned: number;
  roomName: string;
  roomEmoji: string;
  dispute?: CompletionDispute;
}

export interface CompletionDispute {
  id: string;
  completionLogId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed';
  resolutionNote: string | null;
  createdAt: string;
}

export type AreaFilter = 'All areas' | Area;
