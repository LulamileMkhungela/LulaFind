import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Post, SearchZone } from '../../core/models/types';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { SearchAction, SearchCommand } from '../../core/utils/search-coordination';

/** A command-driven coordination board: no live volunteer tracking. */
@Component({
  selector: 'lf-search-board',
  standalone: true,
  template: `
    <details class="board" (toggle)="expanded.set($any($event.target).open)">
      <summary><span>Community search board</span><small>{{ summary() }}</small></summary>
      @if (expanded()) {
        <div class="content">
          <p class="safety">Coordinate public areas, not private addresses. Do not enter unsafe places or confront anyone. This board does not dispatch emergency services.</p>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <p class="feedback" role="status" aria-live="polite">{{ message() }}</p>
          @if (post().searchParty; as party) {
            <div class="toolbar">
              <strong>{{ post().status !== 'active' ? 'Case closed — board read-only' : party.open ? 'Search open' : 'Search paused' }}</strong>
              @if (viewer()) { <button type="button" (click)="refresh()" [disabled]="busy()">Refresh board</button> }
              @if (coordinator() && post().status === 'active') {
                <button type="button" (click)="run({ action: party.open ? 'pause' : 'resume' })" [disabled]="busy()">{{ party.open ? 'Pause search' : 'Resume search' }}</button>
              }
            </div>
            <p class="meeting"><strong>Public meeting point:</strong> {{ party.meetAt }}
              @if (party.meetWhen) { <span> · {{ meetingTime(party.meetWhen) }}</span> }
            </p>
            <div class="stats" aria-label="Search coverage">
              <span><strong>{{ available() }}</strong> available</span>
              <span><strong>{{ inProgress() }}</strong> in progress</span>
              <span><strong>{{ completed() }}</strong> completed</span>
            </div>
            <progress [value]="completed()" [max]="party.zones.length || 1" aria-label="Areas completed"></progress>
            <div class="filters" role="group" aria-label="Filter search areas">
              @for (f of filters; track f.value) {
                <button type="button" [attr.aria-pressed]="filter() === f.value" (click)="filter.set(f.value)">{{ f.label }}</button>
              }
            </div>
            <ul class="zones">
              @for (zone of visibleZones(); track zone.id) {
                <li [class.done]="zone.done">
                  <div class="zone-heading"><h3>{{ zone.name }}</h3><span class="state">{{ zone.done ? 'Completed' : zone.takenBy ? (mine(zone) ? 'Your area' : 'Claimed') : 'Available' }}</span></div>
                  @if (zone.note) { <p class="report">{{ zone.note }}</p> }
                  @if (zone.updatedAt) { <small>Updated {{ meetingTime(zone.updatedAt) }}</small> }
                  @if (post().status === 'active' && party.open && viewer()) {
                    <div class="actions">
                      @if (!zone.takenBy && !zone.done) {
                        <button class="primary" type="button" [disabled]="busy()" (click)="zoneAction(zone, 'claim')">Claim area</button>
                      }
                      @if (mine(zone) && !zone.done) {
                        <label class="note">Public area update (optional)
                          <textarea maxlength="500" rows="2" [value]="notes()[zone.id] ?? ''" (input)="setNote(zone.id, $any($event.target).value)" [disabled]="busy()" placeholder="Area checked; report sensitive sightings privately through the appropriate authority"></textarea>
                        </label>
                        <button class="primary" type="button" [disabled]="busy()" (click)="zoneAction(zone, 'complete')">Mark completed</button>
                        <button type="button" [disabled]="busy()" (click)="zoneAction(zone, 'release')">Release area</button>
                      }
                      @if (mine(zone) && zone.done) {
                        <button type="button" [disabled]="busy()" (click)="zoneAction(zone, 'reopen')">Reopen my area</button>
                      }
                    </div>
                  }
                </li>
              } @empty { <li class="empty">No areas match this filter.</li> }
            </ul>
            @if (!viewer()) { <p>Sign in to claim an area. No volunteer live locations are shown.</p> }
          } @else if (coordinator() && post().status === 'active') {
            <form (submit)="$event.preventDefault(); open()">
              <label>Public meeting point<input name="meeting" required maxlength="160" [value]="meetAt" (input)="meetAt = $any($event.target).value" placeholder="For example, the community centre entrance" /></label>
              <label>Meeting time (optional, your local time)<input name="time" type="datetime-local" [value]="meetWhen" (input)="meetWhen = $any($event.target).value" /></label>
              <label>Areas to cover — one per line<textarea name="zones" required rows="4" maxlength="2020" [value]="zoneNames" (input)="zoneNames = $any($event.target).value" placeholder="Taxi rank\nPublic park\nCommunity centre"></textarea></label>
              <small>1–20 named public areas. Volunteers claim one area at a time; no GPS tracking.</small>
              <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Open search board' }}</button>
            </form>
          } @else { <p>The case owner can open a search board to coordinate areas and avoid duplicated effort.</p> }
        </div>
      }
    </details>
  `,
  styles: [`
    :host { display:block; margin:12px var(--lf-gap, 16px); }
    .board { border:1px solid var(--lf-line); border-radius:14px; background:var(--lf-card); overflow:hidden; }
    summary { cursor:pointer; padding:16px; font-weight:700; min-height:48px; }
    summary small { display:block; margin-top:4px; font-weight:400; color:var(--lf-muted); }
    .content { padding:0 16px 16px; } .safety, small { color:var(--lf-muted); font-size:13px; line-height:1.5; }
    .toolbar,.actions,.filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .toolbar strong { flex:1 1 150px; } .meeting,.report { overflow-wrap:anywhere; line-height:1.5; }
    .stats { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; padding:12px 0; font-size:13px; }
    .stats strong { display:block; font-size:22px; } progress { width:100%; height:8px; accent-color:var(--lf-primary); }
    .filters { margin:16px 0; } button { min-height:44px; padding:9px 13px; border:1px solid var(--lf-line); border-radius:9px; background:var(--lf-card); color:inherit; font:inherit; cursor:pointer; }
    button.primary,button[aria-pressed=true] { background:var(--lf-primary); color:#fff; border-color:var(--lf-primary); }
    button:disabled { opacity:.55; cursor:wait; } button:focus-visible,summary:focus-visible { outline:3px solid var(--lf-primary); outline-offset:2px; }
    .zones { padding:0; list-style:none; display:grid; gap:10px; } li { padding:12px; border:1px solid var(--lf-line); border-radius:10px; }
    .zone-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; } h3 { font-size:16px; margin:0; overflow-wrap:anywhere; }
    .state { font-size:12px; font-weight:700; } .done { border-style:dashed; } .actions { margin-top:12px; }
    form { display:grid; gap:12px; } label { display:grid; gap:6px; font-size:14px; font-weight:600; } .note { width:100%; }
    input,textarea { box-sizing:border-box; width:100%; min-width:0; padding:11px; border:1px solid var(--lf-line); border-radius:8px; background:var(--lf-bg); color:inherit; font:inherit; }
    .error { border-left:3px solid #bf3131; padding:10px; } .feedback:empty { display:none; } .feedback { font-size:14px; } .empty { color:var(--lf-muted); }
  `]
})
export class SearchBoardComponent {
  readonly post = input.required<Post>();
  readonly changed = output<Post>();
  private readonly auth = inject(AuthService);
  private readonly data = inject(DataService);
  readonly viewer = computed(() => this.auth.user());
  readonly coordinator = computed(() => !!this.viewer() && (this.viewer()!.id === this.post().authorId || this.viewer()!.isAdmin === true));
  readonly expanded = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly notes = signal<Record<string, string>>({});
  readonly filter = signal('all');
  readonly filters = [{ value: 'all', label: 'All' }, { value: 'available', label: 'Available' }, { value: 'mine', label: 'My areas' }, { value: 'done', label: 'Completed' }];
  readonly zones = computed(() => this.post().searchParty?.zones ?? []);
  readonly completed = computed(() => this.zones().filter(z => z.done).length);
  readonly available = computed(() => this.zones().filter(z => !z.done && !z.takenBy).length);
  readonly inProgress = computed(() => this.zones().filter(z => !z.done && !!z.takenBy).length);
  readonly summary = computed(() => this.post().searchParty ? `${this.completed()} of ${this.zones().length} areas completed · no live tracking` : 'Plan areas, volunteer and share progress');
  readonly visibleZones = computed(() => this.zones().filter(z => this.filter() === 'all' || (this.filter() === 'available' && !z.done && !z.takenBy) || (this.filter() === 'mine' && this.mine(z)) || (this.filter() === 'done' && z.done)));
  meetAt = '';
  meetWhen = '';
  zoneNames = '';

  mine(zone: SearchZone): boolean { return !!this.viewer() && zone.takenBy === this.viewer()!.id; }
  meetingTime(at: number): string { return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  setNote(id: string, note: string): void { this.notes.update(notes => ({ ...notes, [id]: note })); }
  open(): void {
    void this.run({ action: 'open', meetAt: this.meetAt, meetWhen: this.meetWhen ? new Date(this.meetWhen).getTime() : null, zones: this.zoneNames.split('\n').filter(n => n.trim()) });
  }
  zoneAction(zone: SearchZone, action: SearchAction): void {
    void this.run({ action, zoneId: zone.id, expectedVersion: zone.version ?? 0, note: this.notes()[zone.id] ?? '' });
  }
  async run(command: SearchCommand): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      this.changed.emit(await this.data.coordinateSearch(this.post().id, command));
      this.message.set('Search board saved.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The change could not be saved. Refresh and try again.');
    } finally { this.busy.set(false); }
  }
  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      const post = await this.data.refreshSearchBoard(this.post().id);
      this.changed.emit(post);
      this.message.set('Board refreshed.');
    } catch (error) { this.error.set(error instanceof Error ? error.message : 'The board could not be refreshed.'); }
    finally { this.busy.set(false); }
  }
}
