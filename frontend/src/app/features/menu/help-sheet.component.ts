import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import {
  SERVICE_REQUEST_KINDS,
  SERVICE_REQUEST_LABELS,
  ServiceRequestKind,
} from '../../core/api.models';
import { BottomSheetComponent } from './bottom-sheet.component';

export interface HelpRequest {
  readonly kind: ServiceRequestKind;
  readonly note: string | null;
}

/**
 * The "someone please come over" button, which is the one thing a QR menu removes from a
 * restaurant and has to give back — there is no waiter to catch the eye of when the menu is a
 * sticker.
 */
@Component({
  selector: 'app-help-sheet',
  standalone: true,
  imports: [BottomSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-bottom-sheet
      title="Need a hand?"
      [subtitle]="'Table ' + tableNumber()"
      (dismiss)="dismiss.emit()"
    >
      @if (sent()) {
        <div class="done" role="status">
          <span class="tick" aria-hidden="true">✓</span>
          <p><strong>Someone is on their way.</strong></p>
          <p class="muted">We have told the floor. No need to ask twice.</p>
        </div>
      } @else {
        <div class="kinds">
          @for (kind of kinds; track kind) {
            <button
              type="button"
              class="kind"
              [class.kind--active]="selected() === kind"
              (click)="selected.set(kind)"
            >
              {{ label(kind) }}
            </button>
          }
        </div>

        <label class="field">
          <span class="field__label">Anything to add? (optional)</span>
          <input
            class="input"
            [value]="note()"
            (input)="note.set(text($event))"
            placeholder="We are the table by the window"
            maxlength="500"
          />
        </label>

        @if (errorMessage(); as message) {
          <p class="error">{{ message }}</p>
        }
      }

      <div sheetActions class="actions">
        @if (sent()) {
          <button type="button" class="submit" (click)="dismiss.emit()">Done</button>
        } @else {
          <button type="button" class="ghost" (click)="dismiss.emit()">Cancel</button>
          <button type="button" class="submit" [disabled]="sending()" (click)="send()">
            {{ sending() ? 'Sending…' : 'Send' }}
          </button>
        }
      </div>
    </app-bottom-sheet>
  `,
  styles: [
    `
      .kinds {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .kind {
        padding: 0.8125rem 0.9375rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 0.9375rem;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }

      .kind--active {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.3125rem;
        margin-top: 1rem;
      }

      .field__label {
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 650;
      }

      .input {
        width: 100%;
        padding: 0.6875rem 0.875rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 0.9375rem;
      }

      .done {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
        padding: 1.5rem 0;
        text-align: center;
      }

      .done p {
        margin: 0;
      }

      .muted {
        color: var(--text-muted);
        font-size: 0.875rem;
      }

      .tick {
        display: grid;
        place-items: center;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        background: var(--success-surface);
        color: var(--success-text);
        font-size: 1.5rem;
        font-weight: 700;
      }

      .error {
        margin: 0.875rem 0 0;
        padding: 0.625rem 0.75rem;
        border-radius: var(--radius-sm);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.8125rem;
      }

      .actions {
        width: 100%;
      }

      .ghost,
      .submit {
        flex: 1;
        padding: 0.8125rem 1rem;
        border-radius: var(--radius-pill);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .ghost {
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
      }

      .submit {
        border: 0;
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .submit:disabled {
        opacity: 0.55;
      }
    `,
  ],
})
export class HelpSheetComponent {
  readonly tableNumber = input.required<string>();
  readonly sending = input(false);
  readonly sent = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly dismiss = output<void>();
  readonly send_ = output<HelpRequest>();

  protected readonly kinds = SERVICE_REQUEST_KINDS;
  protected readonly selected = signal<ServiceRequestKind>('CallWaiter');
  protected readonly note = signal('');

  protected label(kind: ServiceRequestKind): string {
    return SERVICE_REQUEST_LABELS[kind];
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected send(): void {
    this.send_.emit({ kind: this.selected(), note: this.note().trim() || null });
  }
}
