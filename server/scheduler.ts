import { Store } from './store.js';
import { RefreshService } from './refresh.js';

/** Persisted cadence, independent of frontend tabs. One catch-up after sleep/restart. */
export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  constructor(
    private store: Store,
    private refresh: RefreshService,
    private now = () => Date.now(),
  ) {}
  start() {
    this.stopped = false;
    this.ensureDue();
    this.timer = setInterval(() => {
      void this.tick();
    }, 10000);
    this.timer.unref();
    void this.tick();
  }
  ensureDue() {
    const settings = this.store.settings();
    if (settings.enabled && !settings.nextRefreshAt)
      this.store.saveSettings({
        ...settings,
        nextRefreshAt: new Date(this.now() + settings.intervalMinutes * 60000).toISOString(),
      });
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    const settings = this.store.settings();
    if (
      !settings.enabled ||
      !settings.nextRefreshAt ||
      Date.parse(settings.nextRefreshAt) > this.now()
    )
      return;
    this.ticking = true;
    try {
      // A full task already covers the due refresh; a single task must finish before a full one.
      const active = this.refresh.active;
      if (active) await this.refresh.wait();
      if (this.stopped || !this.store.settings().enabled) return;
      if (this.store.settings().nextRefreshAt !== settings.nextRefreshAt) return;
      const completedFull =
        active &&
        this.store
          .runs()
          .some(
            (r) => r.scope === 'all' && r.state === 'completed' && r.startedAt >= active.startedAt,
          );
      if (!active || (active.scope === 'single' && !completedFull)) {
        if (this.store.applications().some((a) => a.mode === 'auto')) {
          this.refresh.start(undefined, 'scheduled');
          await this.refresh.wait();
        }
      }
      if (!this.stopped) {
        const latest = this.store.settings();
        this.store.saveSettings({
          ...latest,
          nextRefreshAt: latest.enabled
            ? new Date(this.now() + latest.intervalMinutes * 60000).toISOString()
            : null,
        });
      }
    } finally {
      this.ticking = false;
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
