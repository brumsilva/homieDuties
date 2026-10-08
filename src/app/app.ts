import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Area, AreaFilter, CompletionLog, HomeTask } from './models';
import { SupabaseService } from './supabase.service';

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly areaOptions: AreaFilter[] = ['All areas', 'Kitchen', 'Bathroom', 'Hallway'];
  readonly activeTab = signal<'home' | 'history' | 'manage'>('home');
  readonly areaFilter = signal<AreaFilter>('All areas');
  readonly showComplete = signal<HomeTask | null>(null);
  readonly showAddTask = signal(false);
  readonly showAddMember = signal(false);
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
  readonly taskForm = signal({ title: '', area: 'Kitchen' as Area, description: '', frequency: 'Weekly' });
  readonly memberForm = signal({ username: '', displayName: '', pin: '', role: 'member' as 'admin' | 'member' });
  readonly openTasks = computed(() => this.data.tasks().filter((task) => task.status === 'open'));
  readonly filteredTasks = computed(() => this.openTasks().filter((task) => this.areaFilter() === 'All areas' || task.area === this.areaFilter()));
  readonly recentLogs = computed(() => this.data.logs().slice(0, 3));
  readonly todaysCount = computed(() => this.data.logs().filter((log) => new Date(log.completedAt).toDateString() === new Date().toDateString()).length);

  constructor(readonly data: SupabaseService) {}

  setFilter(filter: AreaFilter) { this.areaFilter.set(filter); }
  setTab(tab: 'home' | 'history' | 'manage') { this.activeTab.set(tab); this.actionError.set(''); }
  togglePin() { this.pinVisible.update((visible) => !visible); }
  setPin(value: string) { this.loginPin.set(value.replace(/\D/g, '').slice(0, 4)); }
  setMemberPin(value: string) { this.memberForm.update((form) => ({ ...form, pin: value.replace(/\D/g, '').slice(0, 4) })); }
  setResetPin(value: string) { this.resetPinValue.set(value.replace(/\D/g, '').slice(0, 4)); }
  setTaskTitle(value: string) { this.taskForm.update((form) => ({ ...form, title: value })); }
  setTaskArea(value: Area) { this.taskForm.update((form) => ({ ...form, area: value })); }
  setTaskDescription(value: string) { this.taskForm.update((form) => ({ ...form, description: value })); }
  setTaskFrequency(value: string) { this.taskForm.update((form) => ({ ...form, frequency: value })); }
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
    if (!form.title.trim()) { this.actionError.set('Informe o nome da tarefa.'); return; }
    this.busy.set(true); this.actionError.set('');
    try { await this.data.createTask({ ...form, title: form.title.trim(), description: form.description.trim() }); this.showAddTask.set(false); this.taskForm.set({ title: '', area: 'Kitchen', description: '', frequency: 'Weekly' }); }
    catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Não foi possível criar a tarefa.'); }
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
  areaLabel(area: Area) { return area === 'Kitchen' ? 'Cozinha' : area === 'Bathroom' ? 'Banheiro' : 'Corredor'; }
  frequencyLabel(frequency: string) {
    return ({ Daily: 'Diariamente', 'Several times a week': 'Várias vezes por semana', Weekly: 'Semanalmente', Monthly: 'Mensalmente', 'As needed': 'Quando necessário' } as Record<string, string>)[frequency] ?? frequency;
  }
  isTaskUpcoming(task: HomeTask) { return new Date(task.availableAt).getTime() > Date.now(); }
  areaIcon(area: Area) { return area === 'Kitchen' ? '⌂' : area === 'Bathroom' ? '◌' : '⌁'; }
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
