import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Area, CompletionDispute, CompletionLog, HomeTask, HouseMember, Room } from './models';

declare global {
  interface Window {
    HOMIE_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
}

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const demoMembers: HouseMember[] = [
  { id: 'demo-ava', username: 'ava', displayName: 'Ava', role: 'admin' },
  { id: 'demo-ben', username: 'ben', displayName: 'Ben', role: 'member' },
  { id: 'demo-cian', username: 'cian', displayName: 'Cian', role: 'member' },
  { id: 'demo-dara', username: 'dara', displayName: 'Dara', role: 'member' },
  { id: 'demo-erin', username: 'erin', displayName: 'Erin', role: 'member' },
];
const demoRooms: Room[] = [
  { id: 'demo-room-kitchen', name: 'Kitchen', emoji: '🍳' },
  { id: 'demo-room-bathroom', name: 'Bathroom', emoji: '🛁' },
  { id: 'demo-room-hallway', name: 'Hallway', emoji: '🧹' },
];

const demoActivityGroup = (id: string) => `activity-${id}`;

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured: boolean;
  readonly client?: SupabaseClient;
  readonly currentMember = signal<HouseMember | null>(null);
  readonly members = signal<HouseMember[]>(demoMembers);
  readonly rooms = signal<Room[]>(demoRooms);
  readonly disputes = signal<CompletionDispute[]>([]);
  readonly tasks = signal<HomeTask[]>([
    { id: 'demo-1', title: 'Organizar a cozinha', area: 'Kitchen', roomId: demoRooms[0].id, description: 'Limpar bancadas e mesa, limpar o fogão e deixar a pia vazia.', frequency: 'Daily', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), activityGroupId: demoActivityGroup('1'), points: 10 },
    { id: 'demo-2', title: 'Guardar os talheres', area: 'Kitchen', roomId: demoRooms[0].id, description: 'Guardar os talheres limpos no lugar.', frequency: 'Ongoing', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), activityGroupId: demoActivityGroup('2'), points: 3 },
    { id: 'demo-3', title: 'Levar o lixo para fora', area: 'Kitchen', roomId: demoRooms[0].id, description: 'Separar reciclagem e lixo comum e colocar sacos novos nas lixeiras.', frequency: 'Ongoing', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), activityGroupId: demoActivityGroup('3'), points: 5 },
    { id: 'demo-4', title: 'Limpar o banheiro', area: 'Bathroom', roomId: demoRooms[1].id, description: 'Limpar vaso, pia, espelho e chuveiro; trocar a toalha de mãos.', frequency: 'Weekly', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), activityGroupId: demoActivityGroup('4'), points: 15 },
    { id: 'demo-5', title: 'Aspirar o corredor', area: 'Hallway', roomId: demoRooms[2].id, description: 'Aspirar o carpete do corredor da porta de entrada até o andar de cima, inclusive as bordas.', frequency: 'Weekly', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), activityGroupId: demoActivityGroup('5'), points: 15 },
  ]);
  readonly logs = signal<CompletionLog[]>([]);
  readonly lastError = signal('');
  private realtimeChannel: ReturnType<SupabaseClient['channel']> | null = null;
  private refreshTimer: number | null = null;

  constructor() {
    const url = window.HOMIE_CONFIG?.supabaseUrl || env['NG_APP_SUPABASE_URL'];
    const key = window.HOMIE_CONFIG?.supabaseAnonKey || env['NG_APP_SUPABASE_ANON_KEY'];
    this.configured = Boolean(url && key);
    if (url && key) {
      this.client = createClient(url, key, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
      void this.restoreSession();
    }
  }

  async restoreSession() {
    if (!this.client) return;
    const { data } = await this.client.auth.getSession();
    if (data.session) {
      try { await this.loadMember(data.session.user.id); await this.refresh(); }
      catch { await this.client.auth.signOut(); }
    }
  }

  async login(username: string, pin: string): Promise<void> {
    if (!this.client) {
      const member = this.members().find((item) => item.username.toLowerCase() === username.toLowerCase());
      if (!member || pin !== '1234') throw new Error('Usuário ou PIN incorreto. No modo de demonstração, use o PIN 1234.');
      this.currentMember.set(member);
      return;
    }
    const { data, error } = await this.client.functions.invoke('pin-login', { body: { username, pin } });
    if (error) throw new Error('Não foi possível entrar. Confira o usuário e o PIN.');
    if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Não foi possível iniciar a sessão.');
    const { error: sessionError } = await this.client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessionError) throw sessionError;
    await this.loadMember(data.user_id);
    await this.refresh();
  }

  async logout() {
    if (this.client) await this.client.auth.signOut();
    this.currentMember.set(null);
    this.closeRealtime();
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async refresh(): Promise<boolean> {
    if (!this.client || !this.currentMember()) return false;
    this.lastError.set('');
    const [tasksResult, membersResult, logsResult, roomsResult, disputesResult] = await Promise.all([
      this.client.from('tasks').select('*').order('created_at'),
      this.client.from('profiles').select('id, username, display_name, role').eq('is_active', true).order('display_name'),
      this.client.from('completion_logs').select('id, task_id, member_id, completed_at, note, photo_path, activity_group_id, activity_title, room_name, room_emoji, points_earned, tasks(title, area), profiles(display_name)').order('completed_at', { ascending: false }).limit(1000),
      this.client.from('rooms').select('id, name, emoji').order('name'),
      this.client.from('completion_disputes').select('id, completion_log_id, reporter_id, reason, status, resolution_note, created_at, reporter:profiles!completion_disputes_reporter_id_fkey(display_name)').order('created_at', { ascending: false }).limit(500),
    ]);
    const error = tasksResult.error || membersResult.error || logsResult.error || roomsResult.error || disputesResult.error;
    if (error) { this.lastError.set('Não foi possível carregar os dados. Confira a configuração e as políticas do Supabase.'); return false; }
    this.rooms.set((roomsResult.data ?? []).map((row: any) => ({ id: row.id, name: row.name, emoji: row.emoji })));
    this.tasks.set((tasksResult.data ?? []).map((row: any) => ({ id: row.id, title: row.title, area: row.area, roomId: row.room_id, description: row.description, frequency: row.frequency, status: row.status, createdAt: row.created_at, availableAt: row.available_at, activityGroupId: row.activity_group_id, points: row.points })));
    this.members.set((membersResult.data ?? []).map((row: any) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role })));
    const current = this.members().find((member) => member.id === this.currentMember()?.id);
    if (current) this.currentMember.set(current);
    this.logs.set((logsResult.data ?? []).map((row: any) => ({
      id: row.id, taskId: row.task_id, taskTitle: row.activity_title ?? row.tasks?.title ?? 'Task', area: row.room_name ?? row.tasks?.area ?? 'Kitchen', roomName: row.room_name ?? row.tasks?.area ?? 'Kitchen', roomEmoji: row.room_emoji ?? '🏠', activityGroupId: row.activity_group_id, pointsEarned: row.points_earned ?? 10,
      memberId: row.member_id, memberName: row.profiles?.display_name ?? 'Housemate', completedAt: row.completed_at,
      note: row.note, photoPath: row.photo_path,
    })));
    this.disputes.set((disputesResult.data ?? []).map((row: any) => ({ id: row.id, completionLogId: row.completion_log_id, reporterId: row.reporter_id, reporterName: row.reporter?.display_name ?? 'Morador', reason: row.reason, status: row.status, resolutionNote: row.resolution_note, createdAt: row.created_at })));
    await this.signPhotoUrls();
    this.openRealtime();
    if (this.refreshTimer === null) this.refreshTimer = window.setInterval(() => void this.refresh(), 60_000);
    return true;
  }

  async createTask(input: { title: string; roomId: string; description: string; frequency: string; points: number }) {
    const room = this.rooms().find((item) => item.id === input.roomId);
    if (!room) throw new Error('Escolha um cômodo válido.');
    if (!this.client) {
      const now = new Date().toISOString();
      this.tasks.update((items) => [...items, { ...input, area: room.name, id: crypto.randomUUID(), status: 'open', createdAt: now, availableAt: now, activityGroupId: crypto.randomUUID() }]);
      return;
    }
    const member = this.currentMember();
    const { error } = await this.client.from('tasks').insert({ title: input.title, room_id: room.id, area: room.name, description: input.description, frequency: input.frequency, points: input.points, household_id: (await this.client.from('profiles').select('household_id').eq('id', member!.id).single()).data?.household_id, created_by: member!.id });
    if (error) throw error;
    await this.refresh();
  }

  async completeTask(task: HomeTask, image: File, note: string) {
    const member = this.currentMember();
    if (!member) throw new Error('Entre novamente para continuar.');
    if (!this.client) {
      const url = URL.createObjectURL(image);
      const log: CompletionLog = { id: crypto.randomUUID(), taskId: task.id, taskTitle: task.title, area: task.area, memberId: member.id, memberName: member.displayName, completedAt: new Date().toISOString(), note: note || null, photoPath: url, photoUrl: url, activityGroupId: task.activityGroupId, pointsEarned: task.points, roomName: task.area, roomEmoji: this.rooms().find((room) => room.id === task.roomId)?.emoji ?? '🏠' };
      this.logs.update((items) => [log, ...items]);
      const now = new Date();
      const next = new Date(now);
      if (task.frequency === 'Ongoing') next.setSeconds(next.getSeconds());
      else if (task.frequency === 'Daily') next.setDate(next.getDate() + 1);
      else if (task.frequency === 'Several times a week') next.setDate(next.getDate() + 3);
      else if (task.frequency === 'Weekly') next.setDate(next.getDate() + 7);
      else if (task.frequency === 'Monthly') next.setMonth(next.getMonth() + 1);
      this.tasks.update((items) => items.filter((item) => item.id !== task.id).concat(task.frequency === 'As needed' ? [] : [{ ...task, id: crypto.randomUUID(), createdAt: now.toISOString(), availableAt: next.toISOString() }]));
      return;
    }
    const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
    const extension = extensions[image.type];
    if (!extension) throw new Error('Use uma foto em JPG, PNG, WebP ou HEIC.');
    const imagePath = `${member.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await this.client.storage.from('completion-photos').upload(imagePath, image, { contentType: image.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: completionError } = await this.client.rpc('complete_task', { p_task_id: task.id, p_note: note || null, p_photo_path: imagePath });
    if (completionError) {
      const refreshed = await this.refresh();
      if (refreshed && this.logs().some((log) => log.taskId === task.id && log.memberId === member.id)) return;
      if (refreshed) await this.client.storage.from('completion-photos').remove([imagePath]);
      throw new Error('Não foi possível registrar a tarefa. Ela pode já ter sido concluída por outra pessoa.');
    }
    await this.refresh();
  }

  async createRoom(input: { name: string; emoji: string }) {
    const member = this.currentMember();
    if (!member) throw new Error('Entre novamente para continuar.');
    if (!this.client) {
      if (this.rooms().some((room) => room.name.toLowerCase() === input.name.toLowerCase())) throw new Error('Já existe um cômodo com esse nome.');
      this.rooms.update((rooms) => [...rooms, { ...input, id: crypto.randomUUID() }]);
      return;
    }
    const { data: profile } = await this.client.from('profiles').select('household_id').eq('id', member.id).single();
    const { error } = await this.client.from('rooms').insert({ ...input, household_id: profile?.household_id, created_by: member.id });
    if (error) throw error;
    await this.refresh();
  }

  async updateRoom(roomId: string, input: { name: string; emoji: string }) {
    const existing = this.rooms().find((room) => room.id === roomId);
    if (!existing) throw new Error('Cômodo não encontrado.');
    if (!this.client) {
      if (this.rooms().some((room) => room.id !== roomId && room.name.toLowerCase() === input.name.toLowerCase())) throw new Error('Já existe um cômodo com esse nome.');
      this.rooms.update((rooms) => rooms.map((room) => room.id === roomId ? { ...room, ...input } : room));
      this.tasks.update((tasks) => tasks.map((task) => task.roomId === roomId ? { ...task, area: input.name } : task));
      return;
    }
    const { error } = await this.client.rpc('update_household_room', { p_room_id: roomId, p_name: input.name, p_emoji: input.emoji });
    if (error) throw new Error(error.message.includes('rooms_household_name_ci_idx') ? 'Já existe um cômodo com esse nome.' : 'Não foi possível editar este cômodo.');
    await this.refresh();
  }

  async deleteRoom(roomId: string, replacementRoomId: string | null) {
    const room = this.rooms().find((item) => item.id === roomId);
    if (!room) throw new Error('Cômodo não encontrado.');
    if (!this.client) {
      if (this.tasks().some((task) => task.roomId === roomId) && !replacementRoomId) throw new Error('Escolha outro cômodo para as atividades vinculadas.');
      const replacement = this.rooms().find((item) => item.id === replacementRoomId);
      this.tasks.update((tasks) => tasks.map((task) => task.roomId === roomId && replacement ? { ...task, roomId: replacement.id, area: replacement.name } : task));
      this.rooms.update((rooms) => rooms.filter((item) => item.id !== roomId));
      return;
    }
    const { error } = await this.client.rpc('delete_household_room', { p_room_id: roomId, p_replacement_room_id: replacementRoomId });
    if (error) throw new Error(error.message.includes('Choose another room') ? 'Escolha outro cômodo para receber as atividades vinculadas.' : 'Não foi possível excluir este cômodo.');
    await this.refresh();
  }

  async contestCompletion(logId: string, reason: string) {
    const member = this.currentMember();
    if (!member) throw new Error('Entre novamente para continuar.');
    const log = this.logs().find((item) => item.id === logId);
    if (!log || log.memberId === member.id) throw new Error('Não é possível contestar esta atividade.');
    if (!this.client) {
      this.disputes.update((disputes) => [...disputes, { id: crypto.randomUUID(), completionLogId: logId, reporterId: member.id, reporterName: member.displayName, reason, status: 'pending', resolutionNote: null, createdAt: new Date().toISOString() }]);
      return;
    }
    const { data: profile } = await this.client.from('profiles').select('household_id').eq('id', member.id).single();
    const { error } = await this.client.from('completion_disputes').insert({ household_id: profile?.household_id, completion_log_id: logId, reporter_id: member.id, reason });
    if (error) throw error;
    await this.refresh();
  }

  async resolveDispute(id: string, status: 'accepted' | 'dismissed') {
    const member = this.currentMember();
    if (!member || member.role !== 'admin') throw new Error('Somente o administrador pode avaliar contestações.');
    if (!this.client) {
      this.disputes.update((items) => items.map((item) => item.id === id ? { ...item, status } : item));
      return;
    }
    const { error } = await this.client.from('completion_disputes').update({ status, resolved_by: member.id, resolved_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
    if (error) throw error;
    await this.refresh();
  }

  async addMember(input: { username: string; displayName: string; pin: string; role: 'admin' | 'member' }) {
    if (!this.client) {
      this.members.update((items) => [...items, { id: crypto.randomUUID(), username: input.username, displayName: input.displayName, role: input.role }]);
      return;
    }
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'create', ...input } });
    if (error) throw new Error('Não foi possível criar o perfil. Verifique se a função manage-member foi publicada.');
    await this.refresh();
  }

  async updateMember(memberId: string, input: { username: string; displayName: string; pin: string; role: 'admin' | 'member' }) {
    const target = this.members().find((item) => item.id === memberId);
    if (!target) throw new Error('Morador não encontrado.');
    if (!this.client) {
      if (input.username !== target.username && this.members().some((item) => item.id !== memberId && item.username.toLowerCase() === input.username.toLowerCase())) throw new Error('Esse usuário já está em uso.');
      this.members.update((items) => items.map((item) => item.id === memberId ? { ...item, username: input.username, displayName: input.displayName, role: input.role } : item));
      if (this.currentMember()?.id === memberId) this.currentMember.update((member) => member ? { ...member, username: input.username, displayName: input.displayName, role: input.role } : null);
      return;
    }
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'update', memberId, ...input } });
    if (error) throw new Error(error.message || 'Não foi possível editar o perfil.');
    await this.refresh();
  }

  async deleteMember(memberId: string) {
    if (memberId === this.currentMember()?.id) throw new Error('Você não pode excluir o próprio perfil.');
    if (!this.client) {
      this.members.update((items) => items.filter((member) => member.id !== memberId));
      return;
    }
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'delete', memberId } });
    if (error) throw new Error(error.message || 'Não foi possível excluir o perfil.');
    await this.refresh();
  }

  async resetPin(memberId: string, pin: string) {
    if (!this.client) return;
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'reset-pin', memberId, pin } });
    if (error) throw new Error('Could not reset this PIN. Confirm your admin access and try again.');
  }

  private async loadMember(id: string) {
    const { data, error } = await this.client!.from('profiles').select('id, username, display_name, role').eq('id', id).eq('is_active', true).single();
    if (error || !data) { await this.client!.auth.signOut(); throw new Error('Perfil não encontrado. Peça ao administrador para rever o acesso.'); }
    this.currentMember.set({ id: data.id, username: data.username, displayName: data.display_name, role: data.role });
  }

  private async signPhotoUrls() {
    if (!this.client) return;
    const rows = await Promise.all(this.logs().map(async (log) => {
      const { data } = await this.client!.storage.from('completion-photos').createSignedUrl(log.photoPath, 3600);
      return { ...log, photoUrl: data?.signedUrl };
    }));
    this.logs.set(rows);
  }

  private openRealtime() {
    if (!this.client || this.realtimeChannel) return;
    this.realtimeChannel = this.client.channel('homie-house-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => void this.refresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'completion_logs' }, () => void this.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => void this.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completion_disputes' }, () => void this.refresh())
      .subscribe();
  }

  private closeRealtime() {
    if (this.client && this.realtimeChannel) void this.client.removeChannel(this.realtimeChannel);
    this.realtimeChannel = null;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}
