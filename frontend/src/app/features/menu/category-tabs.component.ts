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
        background: var(--bg);
      }

      .tabs {
        display: flex;
        gap: 0.625rem;
        overflow-x: auto;
        /* Vertical padding leaves room for the chips' shadow, which would otherwise be clipped
           by the scroll container. */
        padding: 0.5rem var(--gutter) 0.875rem;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        /* A chip dragged into view settles flush with the gutter rather than half-cut. */
        scroll-snap-type: x proximity;
        scroll-padding-inline: var(--gutter);
      }

      .tabs::-webkit-scrollbar {
        display: none;
      }

      /* Raised white pills, the way the category row is drawn: no outline, a soft drop shadow,
         and the selected one filled with the accent. */
      .tab {
        flex: 0 0 auto;
        scroll-snap-align: start;
        padding: 0.625rem 1.25rem;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text-muted);
        font: inherit;
        font-weight: 700;
        font-size: 0.875rem;
        white-space: nowrap;
        box-shadow: var(--shadow-xl);
        cursor: pointer;
        transition:
          background-color var(--press-dur) var(--press-ease),
          color var(--press-dur) var(--press-ease),
          transform var(--press-dur) var(--press-ease);
      }

      .tab:active {
        transform: scale(var(--press-scale));
      }

      .tab--active {
        background: var(--accent);
        color: var(--accent-contrast);
        box-shadow: 0 6px 16px -4px var(--accent-glow);
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
