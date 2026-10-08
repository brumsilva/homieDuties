import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Area, CompletionLog, HomeTask, HouseMember } from './models';

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

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured: boolean;
  readonly client?: SupabaseClient;
  readonly currentMember = signal<HouseMember | null>(null);
  readonly members = signal<HouseMember[]>(demoMembers);
  readonly tasks = signal<HomeTask[]>([
    { id: 'demo-1', title: 'Organizar a cozinha', area: 'Kitchen', description: 'Limpar bancadas e mesa, limpar o fogão e deixar a pia vazia.', frequency: 'Daily', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString() },
    { id: 'demo-2', title: 'Levar o lixo para fora', area: 'Kitchen', description: 'Separar reciclagem e lixo comum e colocar sacos novos nas lixeiras.', frequency: 'As needed', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString() },
    { id: 'demo-3', title: 'Limpar o banheiro', area: 'Bathroom', description: 'Limpar vaso, pia, espelho e chuveiro; trocar a toalha de mãos.', frequency: 'Weekly', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString() },
    { id: 'demo-4', title: 'Aspirar o corredor', area: 'Hallway', description: 'Aspirar o carpete do corredor da porta de entrada até o andar de cima, inclusive as bordas.', frequency: 'Weekly', status: 'open', createdAt: new Date().toISOString(), availableAt: new Date().toISOString() },
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
    const [tasksResult, membersResult, logsResult] = await Promise.all([
      this.client.from('tasks').select('*').order('created_at'),
      this.client.from('profiles').select('id, username, display_name, role').order('display_name'),
      this.client.from('completion_logs').select('id, task_id, member_id, completed_at, note, photo_path, tasks(title, area), profiles(display_name)').order('completed_at', { ascending: false }).limit(100),
    ]);
    const error = tasksResult.error || membersResult.error || logsResult.error;
    if (error) { this.lastError.set('Não foi possível carregar os dados. Confira a configuração e as políticas do Supabase.'); return false; }
    this.tasks.set((tasksResult.data ?? []).map((row: any) => ({ id: row.id, title: row.title, area: row.area, description: row.description, frequency: row.frequency, status: row.status, createdAt: row.created_at, availableAt: row.available_at })));
    this.members.set((membersResult.data ?? []).map((row: any) => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role })));
    this.logs.set((logsResult.data ?? []).map((row: any) => ({
      id: row.id, taskId: row.task_id, taskTitle: row.tasks?.title ?? 'Task', area: row.tasks?.area ?? 'Kitchen',
      memberId: row.member_id, memberName: row.profiles?.display_name ?? 'Housemate', completedAt: row.completed_at,
      note: row.note, photoPath: row.photo_path,
    })));
    await this.signPhotoUrls();
    this.openRealtime();
    if (this.refreshTimer === null) this.refreshTimer = window.setInterval(() => void this.refresh(), 60_000);
    return true;
  }

  async createTask(input: { title: string; area: Area; description: string; frequency: string }) {
    if (!this.client) {
      const now = new Date().toISOString();
      this.tasks.update((items) => [...items, { ...input, id: crypto.randomUUID(), status: 'open', createdAt: now, availableAt: now }]);
      return;
    }
    const { error } = await this.client.from('tasks').insert(input);
    if (error) throw error;
    await this.refresh();
  }

  async completeTask(task: HomeTask, image: File, note: string) {
    const member = this.currentMember();
    if (!member) throw new Error('Entre novamente para continuar.');
    if (!this.client) {
      const url = URL.createObjectURL(image);
      const log: CompletionLog = { id: crypto.randomUUID(), taskId: task.id, taskTitle: task.title, area: task.area, memberId: member.id, memberName: member.displayName, completedAt: new Date().toISOString(), note: note || null, photoPath: url, photoUrl: url };
      this.logs.update((items) => [log, ...items]);
      const now = new Date();
      const next = new Date(now);
      if (task.frequency === 'Daily') next.setDate(next.getDate() + 1);
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

  async addMember(input: { username: string; displayName: string; pin: string; role: 'admin' | 'member' }) {
    if (!this.client) {
      this.members.update((items) => [...items, { id: crypto.randomUUID(), username: input.username, displayName: input.displayName, role: input.role }]);
      return;
    }
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'create', ...input } });
    if (error) throw new Error('Não foi possível criar o perfil. Verifique se a função manage-member foi publicada.');
    await this.refresh();
  }

  async resetPin(memberId: string, pin: string) {
    if (!this.client) return;
    const { error } = await this.client.functions.invoke('manage-member', { body: { action: 'reset-pin', memberId, pin } });
    if (error) throw new Error('Could not reset this PIN. Confirm your admin access and try again.');
  }

  private async loadMember(id: string) {
    const { data, error } = await this.client!.from('profiles').select('id, username, display_name, role').eq('id', id).single();
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
      .subscribe();
  }

  private closeRealtime() {
    if (this.client && this.realtimeChannel) void this.client.removeChannel(this.realtimeChannel);
    this.realtimeChannel = null;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}
