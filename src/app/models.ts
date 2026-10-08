export type Area = 'Kitchen' | 'Bathroom' | 'Hallway';
export type TaskStatus = 'open' | 'done';

export interface HomeTask {
  id: string;
  title: string;
  area: Area;
  description: string;
  frequency: string;
  status: TaskStatus;
  createdAt: string;
  availableAt: string;
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
}

export type AreaFilter = 'All areas' | Area;
