import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A plain overlay dialog. Escape and a backdrop click both close it, because a modal that can
 * only be dismissed by hunting for an × is the kind of thing that makes admin tools hated.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'dismiss.emit()',
  },
  template: `
    <div class="backdrop" (click)="dismiss.emit()"></div>

    <div class="panel" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="head">
        <div>
          <h2 class="title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="subtitle">{{ subtitle() }}</p>
          }
        </div>

        <button type="button" class="close" (click)="dismiss.emit()" aria-label="Close">×</button>
      </header>

      <div class="body">
        <ng-content />
      </div>

      <footer class="foot">
        <ng-content select="[modalActions]" />
      </footer>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: end center;
      }

      .backdrop {
        position: absolute;
        inset: 0;
        background: rgb(0 0 0 / 45%);
      }

      .panel {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(42rem, 100%);
        max-height: 92dvh;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius) var(--radius) 0 0;
        box-shadow: 0 -8px 40px rgb(0 0 0 / 30%);
      }

      @media (min-width: 40rem) {
        :host {
          place-items: center;
        }

        .panel {
          border-radius: var(--radius);
          max-height: 88dvh;
        }
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.25rem 0.75rem;
        border-bottom: 1px solid var(--border);
      }

      .title {
        margin: 0;
        font-size: 1.0625rem;
        font-weight: 700;
      }

      .subtitle {
        margin: 0.125rem 0 0;
        color: var(--text-muted);
        font-size: 0.8125rem;
      }

      .close {
        border: 0;
        background: transparent;
        color: var(--text-muted);
        font: inherit;
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
      }

      .body {
        flex: 1;
        overflow-y: auto;
        padding: 1rem 1.25rem;
      }

      .foot {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        padding: 0.875rem 1.25rem calc(0.875rem + env(safe-area-inset-bottom, 0));
        border-top: 1px solid var(--border);
      }
    `,
  ],
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);

  readonly dismiss = output<void>();
}
