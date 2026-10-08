import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Homie Duties', () => {
  let fixture: ComponentFixture<App>;
  let app: App;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: () => 'blob:completion-photo' });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  });

  it('shows the shared task list after a housemate signs in', async () => {
    await app.data.login('ava', '1234');
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Oi, Ava');
    expect(page.textContent).toContain('Organizar a cozinha');
    expect(page.textContent).toContain('Limpar o banheiro');
    expect(page.textContent).toContain('Aspirar o corredor');
  });

  it('filters shared tasks by room', async () => {
    await app.data.login('ava', '1234');
    app.setFilter('Hallway');
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelectorAll('.task-card')).toHaveLength(1);
    expect(page.textContent).toContain('Aspirar o corredor');
  });

  it('requires a photo before a task can be logged', async () => {
    await app.data.login('ava', '1234');
    app.showComplete.set(app.data.tasks()[0]);
    await app.saveCompletion();

    expect(app.actionError()).toContain('foto');
    expect(app.data.logs()).toHaveLength(0);
  });

  it('records the current member and timestamp, then schedules the next recurring task', async () => {
    await app.data.login('ava', '1234');
    const task = app.data.tasks()[0];
    app.showComplete.set(task);
    app.completionPhoto.set(new File(['proof'], 'proof.jpg', { type: 'image/jpeg' }));

    await app.saveCompletion();

    const [log] = app.data.logs();
    expect(log.memberId).toBe('demo-ava');
    expect(new Date(log.completedAt).getTime()).toBeGreaterThan(0);
    expect(log.photoUrl).toBe('blob:completion-photo');
    const nextOccurrence = app.data.tasks().find((item) => item.title === task.title);
    expect(nextOccurrence).toBeDefined();
    expect(new Date(nextOccurrence!.availableAt).getTime()).toBeGreaterThan(Date.now());
  });
});
