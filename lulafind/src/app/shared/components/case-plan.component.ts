import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from './icon.component';
import { DataService } from '../../core/services/data.service';
import { CASE_STEPS, CaseStepId, CaseStepSpec, Post } from '../../core/models/types';

/**
 * The first-hours checklist on a case.
 *
 * These are the steps the SAPS process and the search NGOs actually ask a family
 * to do: open a case and sign the SAPS 55(A) form, take the case number, save the
 * investigating officer's details, get a recent photo out, pick one spokesperson,
 * put the poster where the person usually goes, and tell the NGOs. It lives on
 * the case so a parent does not have to hold all of it in their head.
 *
 * The officer's details stay on this case - they are never part of the poster or
 * anything shareable, which is why the card says so out loud.
 */
@Component({
  selector: 'lf-case-plan',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (post.plan || editable) {
      <section class="plan" aria-label="First hours checklist">
        <button class="plan__head" type="button" (click)="open.set(!open())">
          <lf-icon name="check" [size]="16" [weight]="2.6" />
          <span class="plan__title">First hours</span>
          <span class="plan__count">{{ done() }} of {{ steps.length }}</span>
          <lf-icon [name]="open() ? 'chevronUp' : 'chevronDown'" [size]="16" />
        </button>

        @if (open()) {
          @for (step of steps; track step.id) {
            <button class="plan__row" type="button" [class.done]="isDone(step.id)"
                    [class.auto]="isDerived(step.id)" (click)="toggle(step)"
                    [disabled]="!editable || isDerived(step.id)">
              <span class="plan__box">@if (isDone(step.id)) { <lf-icon name="check" [size]="13" [weight]="3" /> }</span>
              <span class="plan__text">
                <strong>{{ step.label }}</strong>
                <small>{{ isDerived(step.id) ? 'Already on your post' : step.hint }}</small>
              </span>
            </button>
          }

          @if (editable) {
            <div class="plan__officer">
              <input placeholder="Investigating officer" [value]="officerName()"
                     (input)="officerName.set($any($event.target).value)" aria-label="Investigating officer name" />
              <input placeholder="Their number" [value]="officerContact()"
                     (input)="officerContact.set($any($event.target).value)" aria-label="Investigating officer number" />
              <button class="pill" type="button" (click)="saveOfficer()">Save</button>
            </div>
            <p class="plan__note">Officer details stay on this case and are never shown to the public.</p>
          } @else if (admin) {
            <p class="plan__note">The family&rsquo;s checklist. Only they can tick it.</p>
          }
        }
      </section>
    }
  `,
  styles: [`
    .plan { margin: 4px 0 10px; border: 1px solid var(--lf-line); border-radius: 10px; overflow: hidden; background: var(--lf-card); }
    .plan__head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 11px 12px; border: 0; background: transparent;
      color: inherit; font-family: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; text-align: left; }
    .plan__title { flex: 1; }
    .plan__count { font-size: 12.5px; color: var(--lf-muted); }
    .plan__row { display: flex; gap: 10px; align-items: flex-start; width: 100%; padding: 9px 12px; border: 0;
      border-top: 1px solid var(--lf-line); background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
    .plan__row.done .plan__text strong { text-decoration: line-through; color: var(--lf-muted); }
    .plan__row.auto { cursor: default; }
    .plan__row[disabled] { opacity: 1; }
    .plan__box { width: 19px; height: 19px; margin-top: 1px; flex-shrink: 0; border: 1.5px solid var(--lf-line);
      border-radius: 5px; display: grid; place-items: center; color: #fff; }
    .plan__row.done .plan__box { background: var(--lf-ubuntu); border-color: var(--lf-ubuntu); }
    .plan__text strong { display: block; font-size: 14px; font-weight: 600; }
    .plan__text small { display: block; margin-top: 1px; font-size: 12.5px; color: var(--lf-muted); line-height: 1.35; }
    .plan__officer { display: flex; gap: 6px; padding: 10px 12px 4px; border-top: 1px solid var(--lf-line); }
    .plan__officer input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 8px;
      background: var(--lf-card2); color: inherit; font-family: inherit; font-size: 13.5px; }
    .pill { padding: 8px 12px; border: 0; border-radius: 8px; background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text); font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .plan__note { margin: 0; padding: 4px 12px 11px; font-size: 12px; color: var(--lf-muted); }
  `]
})
export class CasePlanComponent {
  private data = inject(DataService);
  private toaster = inject(ToastController);

  @Input({ required: true }) post!: Post;
  /** The poster (or an admin acting on the case) may tick steps. */
  @Input() editable = false;
  @Input() admin = false;
  @Output() updated = new EventEmitter<Post>();

  protected readonly steps = CASE_STEPS;
  readonly open = signal(false);
  readonly officerName = signal('');
  readonly officerContact = signal('');
  readonly done = computed(() => CASE_STEPS.filter((s) => this.isDone(s.id)).length);

  ngOnInit(): void {
    this.syncOfficerFields();
  }

  /** Steps the post itself already proves. They tick themselves. */
  isDerived(id: CaseStepId): boolean {
    if (id === 'case_number') return !!this.post.caseNumber;
    if (id === 'recent_photo') return this.post.media.some((m) => m.kind === 'image');
    return false;
  }

  isDone(id: CaseStepId): boolean {
    if (this.isDerived(id)) return true;
    return this.post.plan?.done?.[id] === true;
  }

  async toggle(step: CaseStepSpec): Promise<void> {
    if (!this.editable || this.isDerived(step.id)) return;
    const next = await this.data.tickStep(this.post.id, step.id, !this.isDone(step.id));
    if (next) {
      this.post = next;
      this.updated.emit(next);
    }
  }

  async saveOfficer(): Promise<void> {
    const next = await this.data.saveOfficer(this.post.id, this.officerName(), this.officerContact());
    if (next) {
      this.post = next;
      this.updated.emit(next);
    }
    await this.say('Officer saved on this case');
  }

  private syncOfficerFields(): void {
    this.officerName.set(this.post.plan?.officerName ?? '');
    this.officerContact.set(this.post.plan?.officerContact ?? '');
  }

  private async say(message: string): Promise<void> {
    const t = await this.toaster.create({ message, duration: 2000, position: 'bottom' });
    await t.present();
  }
}
