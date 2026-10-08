import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Area, AreaFilter, CompletionDispute, CompletionLog, HomeTask } from './models';
import { SupabaseService } from './supabase.service';

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly activeTab = signal<'home' | 'history' | 'ranking' | 'manage'>('home');
  readonly areaFilter = signal<AreaFilter>('All areas');
  readonly showComplete = signal<HomeTask | null>(null);
  readonly showAddTask = signal(false);
  readonly showAddMember = signal(false);
  readonly showAddRoom = signal(false);
  readonly contestTarget = signal<CompletionLog | null>(null);
  readonly roomForm = signal({ name: '', emoji: '🏠' });
  readonly contestReason = signal('');
  readonly resetTarget = signal<{ id: string; displayName: string } | null>(null);
  readonly resetPinValue = signal('');
  readonly loginUsername = signal('');
  readonly loginPin = signal('');
  readonly pinVisible = signal(false);
  readonly loginError = signal('');
  readonly actionError = signal('');
  readonly busy = signal(false);
  readonly completionPhoto = signal<File | null>(null);
  readonly photoPreview = signal('');
  readonly completionNote = signal('');
  readonly taskForm = signal({ title: '', roomId: '', description: '', frequency: 'Weekly', points: 10 });
  readonly memberForm = signal({ username: '', displayName: '', pin: '', role: 'member' as 'admin' | 'member' });
  readonly openTasks = computed(() => this.data.tasks().filter((task) => task.status === 'open'));
  readonly filteredTasks = computed(() => this.openTasks().filter((task) => this.areaFilter() === 'All areas' || task.area === this.areaFilter()));
  readonly recentLogs = computed(() => this.data.logs().slice(0, 3));
  readonly todaysCount = computed(() => this.data.logs().filter((log) => new Date(log.completedAt).toDateString() === new Date().toDateString()).length);
  readonly eligibleLogs = computed(() => this.data.logs().filter((log) => this.data.disputes().find((item) => item.completionLogId === log.id)?.status !== 'accepted'));
  readonly totalPoints = computed(() => this.eligibleLogs().reduce((sum, log) => sum + log.pointsEarned, 0));
  readonly areaOptions = computed<AreaFilter[]>(() => ['All areas', ...this.data.rooms().map((room) => room.name)]);
  readonly activityRankings = computed(() => {
    const groups = new Map<string, CompletionLog[]>();
    for (const log of this.eligibleLogs()) groups.set(log.activityGroupId, [...(groups.get(log.activityGroupId) ?? []), log]);
    const tasksByGroup = new Map<string, HomeTask[]>();
    for (const task of this.data.tasks()) tasksByGroup.set(task.activityGroupId, [...(tasksByGroup.get(task.activityGroupId) ?? []), task]);
    const groupIds = new Set([...groups.keys(), ...tasksByGroup.keys()]);
    return [...groupIds].map((id) => {
      const logs = groups.get(id) ?? [];
      const task = tasksByGroup.get(id)?.[0];
      const totals = this.data.members().map((member) => {
        const ownLogs = logs.filter((log) => log.memberId === member.id);
        return { memberId: member.id, name: member.displayName, count: ownLogs.length, points: ownLogs.reduce((sum, log) => sum + log.pointsEarned, 0) };
      }).sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name));
      return { id, title: logs[0]?.taskTitle ?? task?.title ?? 'Atividade', roomName: logs[0]?.roomName ?? task?.area ?? '', roomEmoji: logs[0]?.roomEmoji ?? this.roomEmoji(task?.area ?? ''), points: logs[0]?.pointsEarned ?? task?.points ?? 10, completions: logs.length, totals };
    }).sort((a, b) => b.completions - a.completions || a.title.localeCompare(b.title));
  });
  readonly pendingDisputes = computed(() => this.data.disputes().filter((item) => item.status === 'pending'));

  constructor(readonly data: SupabaseService) {}

  setFilter(filter: AreaFilter) { this.areaFilter.set(filter); }
  setTab(tab: 'home' | 'history' | 'ranking' | 'manage') { this.activeTab.set(tab); this.actionError.set(''); }
  togglePin() { this.pinVisible.update((visible) => !visible); }
  setPin(value: string) { this.loginPin.set(value.replace(/\D/g, '').slice(0, 4)); }
  setMemberPin(value: string) { this.memberForm.update((form) => ({ ...form, pin: value.replace(/\D/g, '').slice(0, 4) })); }
  setResetPin(value: string) { this.resetPinValue.set(value.replace(/\D/g, '').slice(0, 4)); }
  setTaskTitle(value: string) { this.taskForm.update((form) => ({ ...form, title: value })); }
  setTaskRoom(value: string) { this.taskForm.update((form) => ({ ...form, roomId: value })); }
  setTaskDescription(value: string) { this.taskForm.update((form) => ({ ...form, description: value })); }
  setTaskFrequency(value: string) { this.taskForm.update((form) => ({ ...form, frequency: value })); }
  setTaskPoints(value: string) { this.taskForm.update((form) => ({ ...form, points: Math.min(1000, Math.max(1, Number(value) || 1)) })); }
  setRoomName(value: string) { this.roomForm.update((form) => ({ ...form, name: value })); }
  setRoomEmoji(value: string) { this.roomForm.update((form) => ({ ...form, emoji: value })); }
  openTaskForm() { this.taskForm.update((form) => ({ ...form, roomId: form.roomId || this.data.rooms()[0]?.id || '' })); this.actionError.set(''); this.showAddTask.set(true); }
  setMemberName(value: string) { this.memberForm.update((form) => ({ ...form, displayName: value })); }
  setMemberUsername(value: string) { this.memberForm.update((form) => ({ ...form, username: value })); }
  setMemberRole(value: 'member' | 'admin') { this.memberForm.update((form) => ({ ...form, role: value })); }

  async login() {
    this.busy.set(true); this.loginError.set('');
    try { await this.data.login(this.loginUsername().trim(), this.loginPin()); this.loginPin.set(''); }
    catch (error) { this.loginError.set(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { this.busy.set(false); }
  }

  async logout() { await this.data.logout(); this.setTab('home'); }

  onPhotoPicked(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)) { this.actionError.set('Use uma foto em JPG, PNG, WebP ou HEIC.'); return; }
    if (file.size > 8 * 1024 * 1024) { this.actionError.set('A foto precisa ter menos de 8 MB.'); return; }
    this.completionPhoto.set(file);
    this.photoPreview.set(URL.createObjectURL(file));
    this.actionError.set('');
  }

  async saveCompletion() {
    const task = this.showComplete(); const photo = this.completionPhoto();
    if (!task || !photo) { this.actionError.set('Adicione uma foto do resultado para continuar.'); return; }
    this.busy.set(true); this.actionError.set('');
    try {
      await this.data.completeTask(task, photo, this.completionNote().trim());
      this.closeComplete();
      this.activeTab.set('history');
    } catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível salvar a tarefa concluída.'); }
    finally { this.busy.set(false); }
  }

  closeComplete() {
    if (this.photoPreview()) URL.revokeObjectURL(this.photoPreview());
    this.showComplete.set(null); this.completionPhoto.set(null); this.photoPreview.set(''); this.completionNote.set(''); this.actionError.set('');
  }

  async saveTask() {
    const form = this.taskForm();
    if (!form.title.trim() || !form.roomId) { this.actionError.set('Informe o nome da atividade e escolha um cômodo.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.createTask({ ...form, title: form.title.trim(), description: form.description.trim() }); this.showAddTask.set(false); this.taskForm.set({ title: '', roomId: this.data.rooms()[0]?.id ?? '', description: '', frequency: 'Weekly', points: 10 }); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível criar a tarefa.'); }
    finally { this.busy.set(false); }
  }

  async saveRoom() {
    const form = this.roomForm();
    if (!form.name.trim()) { this.actionError.set('Dê um nome para o cômodo.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.createRoom({ name: form.name.trim(), emoji: form.emoji || '🏠' }); this.showAddRoom.set(false); this.roomForm.set({ name: '', emoji: '🏠' }); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível adicionar o cômodo.'); }
    finally { this.busy.set(false); }
  }

  async submitContest() {
    const log = this.contestTarget();
    if (!log || this.contestReason().trim().length < 8) { this.actionError.set('Explique a contestação com pelo menos 8 caracteres.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.contestCompletion(log.id, this.contestReason().trim()); this.contestTarget.set(null); this.contestReason.set(''); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível enviar a contestação.'); }
    finally { this.busy.set(false); }
  }

  async resolveContest(dispute: CompletionDispute, status: 'accepted' | 'dismissed') {
    this.busy.set(true); this.actionError.set('');
    try { await this.data.resolveDispute(dispute.id, status); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível atualizar a contestação.'); }
    finally { this.busy.set(false); }
  }

  async saveMember() {
    const form = this.memberForm();
    if (!form.username.trim() || !form.displayName.trim() || !/^\d{4}$/.test(form.pin)) { this.actionError.set('Informe o nome, o usuário e um PIN de quatro dígitos.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.addMember({ ...form, username: form.username.trim().toLowerCase(), displayName: form.displayName.trim() }); this.showAddMember.set(false); this.memberForm.set({ username: '', displayName: '', pin: '', role: 'member' }); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível criar o perfil.'); }
    finally { this.busy.set(false); }
  }

  async savePinReset() {
    const target = this.resetTarget();
    if (!target || !/^\d{4}$/.test(this.resetPinValue())) { this.actionError.set('Informe um PIN de quatro dígitos.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.resetPin(target.id, this.resetPinValue()); this.resetTarget.set(null); this.resetPinValue.set(''); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível redefinir o PIN.'); }
    finally { this.busy.set(false); }
  }

  areaClass(area: Area) { return area.toLowerCase(); }
  areaLabel(area: Area) { return ({ Kitchen: 'Cozinha', Bathroom: 'Banheiro', Hallway: 'Corredor com carpete' } as Record<string, string>)[area] ?? area; }
  roomEmoji(area: Area) { return this.data.rooms().find((room) => room.name === area)?.emoji ?? ({ Kitchen: '🍳', Bathroom: '🛁', Hallway: '🧹' } as Record<string, string>)[area] ?? '🏠'; }
  frequencyLabel(frequency: string) {
    return ({ Daily: 'Diariamente', 'Several times a week': 'Várias vezes por semana', Weekly: 'Semanalmente', Monthly: 'Mensalmente', 'As needed': 'Quando necessário', Ongoing: 'Sempre disponível' } as Record<string, string>)[frequency] ?? frequency;
  }
  isTaskUpcoming(task: HomeTask) { return new Date(task.availableAt).getTime() > Date.now(); }
  areaIcon(area: Area) { return this.roomEmoji(area); }
  disputeFor(logId: string) { return this.data.disputes().find((dispute) => dispute.completionLogId === logId); }
  disputeTaskTitle(logId: string) { return this.data.logs().find((log) => log.id === logId)?.taskTitle ?? 'Atividade'; }
  roomTaskCount(roomId: string) { return this.data.tasks().filter((task) => task.roomId === roomId).length; }
  currentPoints() { return this.eligibleLogs().filter((log) => log.memberId === this.data.currentMember()?.id).reduce((sum, log) => sum + log.pointsEarned, 0); }
  canContest(log: CompletionLog) { return log.memberId !== this.data.currentMember()?.id && !this.disputeFor(log.id); }
  rankingFor(logs: CompletionLog[]) { return this.data.members().map((member) => { const own = logs.filter((log) => log.memberId === member.id); return { name: member.displayName, count: own.length, points: own.reduce((sum, log) => sum + log.pointsEarned, 0) }; }).sort((a, b) => b.points - a.points || b.count - a.count); }
  initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }
  friendlyDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' }).format(new Date(value)); }
  dateLabel(value: string) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Dublin' }).format(new Date(value)); }
  currentDateLabel() { return this.dateLabel(new Date().toISOString()); }
  currentFriendlyDate() { return this.friendlyDate(new Date().toISOString()); }
  get historyByDate(): { label: string; logs: CompletionLog[] }[] {
    const groups = new Map<string, CompletionLog[]>();
    for (const log of this.data.logs()) {
      const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' }).format(new Date(log.completedAt));
      groups.set(label, [...(groups.get(label) ?? []), log]);
    }
    return [...groups.entries()].map(([label, logs]) => ({ label, logs }));
  }
}
