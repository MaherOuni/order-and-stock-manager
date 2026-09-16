import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The sheet that slides up from the bottom — the phone-native way to show a secondary screen
 * without losing the one behind it. Escape and a backdrop tap both close it, because a sheet
 * you can only dismiss by finding a small × is the kind of thing that gets an app deleted.
 */
@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dismiss.emit()' },
  template: `
    <div class="backdrop" (click)="dismiss.emit()"></div>

    <section class="sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <button type="button" class="grabber" (click)="dismiss.emit()" aria-label="Close">
        <span></span>
      </button>

      <header class="head">
        <div>
          <h2 class="title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="subtitle">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[sheetHeadEnd]" />
      </header>

      <div class="body">
        <ng-content />
      </div>

      <footer class="foot">
        <ng-content select="[sheetActions]" />
      </footer>
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: end center;
      }

      .backdrop {
        position: absolute;
        inset: 0;
        background: rgb(28 25 23 / 45%);
        backdrop-filter: blur(2px);
      }

      .sheet {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(30rem, 100%);
        max-height: 92dvh;
        background: var(--surface);
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        box-shadow: var(--shadow-lg);
        animation: rise 0.22s ease-out;
      }

      @keyframes rise {
        from {
          transform: translateY(12px);
          opacity: 0.6;
        }
      }

      @media (min-width: 34rem) {
        :host {
          place-items: center;
        }

        .sheet {
          border-radius: var(--radius-lg);
          max-height: 88dvh;
        }
      }

      .grabber {
        display: grid;
        place-items: center;
        padding: 0.625rem 0 0.25rem;
        border: 0;
        background: transparent;
        cursor: pointer;
      }

      .grabber span {
        width: 2.5rem;
        height: 0.25rem;
        border-radius: var(--radius-pill);
        background: var(--border-strong);
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.25rem 1.25rem 0.875rem;
      }

      .title {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .subtitle {
        margin: 0.125rem 0 0;
        color: var(--text-muted);
        font-size: 0.8125rem;
      }

      .body {
        flex: 1;
        overflow-y: auto;
        padding: 0 1.25rem;
      }

      .foot:empty {
        display: none;
      }

      .foot {
        display: flex;
        gap: 0.625rem;
        padding: 0.875rem 1.25rem calc(0.875rem + env(safe-area-inset-bottom, 0));
        border-top: 1px solid var(--border);
        background: var(--surface);
      }
    `,
  ],
})
export class BottomSheetComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);

  readonly dismiss = output<void>();
}
