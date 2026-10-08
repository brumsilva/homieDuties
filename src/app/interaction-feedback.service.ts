import { Injectable, OnDestroy, signal } from '@angular/core';

type Cue = 'tap' | 'success' | 'complete' | 'error' | 'remove';

@Injectable({ providedIn: 'root' })
export class InteractionFeedback implements OnDestroy {
  readonly soundEnabled = signal(this.readPreference());
  readonly notice = signal<{ message: string; kind: 'success' | 'error'; points?: number } | null>(null);
  readonly particles = Array.from({ length: 18 }, (_, i) => ({ x: `${(i * 37) % 100}%`, delay: `${(i % 6) * 35}ms`, color: ['#79b98c', '#e9bc60', '#af9ed3', '#e4a18c'][i % 4], rotation: `${i * 47}deg` }));
  private context?: AudioContext;
  private readonly activeNotes = new Set<OscillatorNode>();
  private timer?: ReturnType<typeof setTimeout>;
  private lastCue = 0;

  private readPreference() { try { return localStorage.getItem('homie-sound') !== 'off'; } catch { return true; } }

  unlock() {
    if (!this.soundEnabled()) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Visual feedback remains available if audio is unsupported. */ }
  }

  toggleSound() {
    this.soundEnabled.update(value => !value);
    try { localStorage.setItem('homie-sound', this.soundEnabled() ? 'on' : 'off'); } catch { /* In-memory setting still works. */ }
    if (this.soundEnabled()) { this.unlock(); this.play('tap'); }
    else {
      for (const note of this.activeNotes) { try { note.stop(); } catch { /* Already stopped. */ } }
      this.activeNotes.clear();
      if (this.context) void this.context.suspend().catch(() => {});
    }
  }

  play(cue: Cue) {
    const context = this.context;
    if (!this.soundEnabled() || !context || context.state !== 'running' || document.hidden) return;
    if (cue === 'tap' && performance.now() - this.lastCue < 100) return;
    this.lastCue = performance.now();
    const notes: Record<Cue, number[]> = { tap: [520], success: [660, 880], complete: [523, 659, 784, 1047], error: [260, 220], remove: [440, 330] };
    try {
      notes[cue].forEach((frequency, i) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + i * .085;
        const duration = cue === 'tap' ? .06 : .18;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(cue === 'tap' ? .018 : .045, start + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        this.activeNotes.add(oscillator);
        oscillator.onended = () => { this.activeNotes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + duration + .02);
      });
    } catch { /* Sound must never interrupt an action. */ }
  }

  show(message: string, cue: Cue = 'success', points?: number) {
    this.dismiss();
    this.notice.set({ message, kind: cue === 'error' ? 'error' : 'success', points });
    this.play(cue);
    this.timer = setTimeout(() => this.notice.set(null), cue === 'error' ? 6500 : 4500);
  }

  dismiss() { clearTimeout(this.timer); this.notice.set(null); }
  ngOnDestroy() { this.dismiss(); if (this.context) void this.context.close().catch(() => {}); }
}
