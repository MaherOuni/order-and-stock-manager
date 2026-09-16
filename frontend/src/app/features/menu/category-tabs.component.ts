import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CategoryDto } from '../../core/api.models';

/**
 * Horizontal category bar pinned under the header. It scrolls sideways rather than wrapping,
 * so a menu with twelve categories still leaves the food visible on a phone.
 */
@Component({
  selector: 'app-category-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabs" role="tablist" aria-label="Menu categories">
      <button
        type="button"
        role="tab"
        class="tab"
        [class.tab--active]="selectedId() === null"
        [attr.aria-selected]="selectedId() === null"
        (click)="select.emit(null)"
      >
        All
      </button>

      @for (category of categories(); track category.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.tab--active]="selectedId() === category.id"
          [attr.aria-selected]="selectedId() === category.id"
          (click)="select.emit(category.id)"
        >
          {{ category.name }}
        </button>
      }
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
        position: sticky;
        top: 0;
        z-index: 20;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .tabs {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding: 0.6rem var(--gutter);
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }

      .tabs::-webkit-scrollbar {
        display: none;
      }

      .tab {
        flex: 0 0 auto;
        padding: 0.5rem 1rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface-2);
        color: var(--text-muted);
        font: inherit;
        font-weight: 600;
        font-size: 0.875rem;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }

      .tab--active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-contrast);
      }
    `,
  ],
})
export class CategoryTabsComponent {
  readonly categories = input.required<readonly CategoryDto[]>();

  /** Null means "All". */
  readonly selectedId = input<string | null>(null);

  readonly select = output<string | null>();
}
