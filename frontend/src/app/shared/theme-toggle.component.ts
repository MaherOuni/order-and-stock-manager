import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="toggle"
      (click)="theme.toggle()"
      [attr.aria-pressed]="theme.isDark()"
      [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
      [title]="theme.isDark() ? 'Light mode' : 'Dark mode'"
    >
      @if (theme.isDark()) {
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
            <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
          </g>
        </svg>
      } @else {
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.7 8.7 0 1 0 11.1 11.1Z"
            fill="currentColor"
          />
        </svg>
      }
    </button>
  `,
  styles: [
    `
      .toggle {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text-muted);
        cursor: pointer;
      }

      .toggle:hover {
        color: var(--text);
        border-color: var(--border-strong);
      }
    `,
  ],
})
export class ThemeToggleComponent {
  protected readonly theme = inject(ThemeService);
}
