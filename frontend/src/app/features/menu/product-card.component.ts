import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { ProductDto } from '../../core/api.models';
import { MoneyPipe } from '../../core/money.pipe';

/**
 * One menu item. The whole card is the tap target — it opens the product sheet, where the
 * customer picks quantity and changes what is in it — with a "+" affordance for the common
 * case of adding one as it comes.
 */
@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="card" (click)="open.emit(product())">
      @if (showImage()) {
        <img
          class="thumb"
          [src]="product().imageUrl"
          [alt]="''"
          loading="lazy"
          decoding="async"
          (error)="imageFailed.set(true)"
        />
      } @else {
        <span class="thumb thumb--fallback" [style.background]="fallbackColor()" aria-hidden="true">
          {{ initial() }}
        </span>
      }

      <span class="body">
        <span class="name">{{ product().name }}</span>

        @if (product().description) {
          <span class="description">{{ product().description }}</span>
        }

        <span class="footer">
          <span class="price">{{ product().price | money: currency() }}</span>

          @if (quantity() > 0) {
            <span class="badge badge--count">{{ quantity() }} in basket</span>
          }
        </span>
      </span>

      <span class="add" aria-hidden="true">+</span>
    </button>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .card {
        display: grid;
        grid-template-columns: 5.25rem 1fr auto;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        padding: 0.75rem;
        /* Translucent hairline over an ambient pool: the card reads as floating on the page
           rather than drawn onto it, which is the whole point of the treatment. */
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-3xl);
        background: var(--surface);
        box-shadow: var(--shadow-xl);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          box-shadow var(--press-dur) var(--press-ease),
          border-color var(--press-dur) var(--press-ease);
      }

      .card:active {
        transform: scale(var(--press-scale));
        box-shadow: var(--shadow-sm);
      }

      .thumb {
        width: 5.25rem;
        height: 5.25rem;
        /* Nested radius: the inner curve has to be tighter than the outer one by the padding,
           or the corners read as two unrelated arcs. */
        border-radius: calc(var(--radius-3xl) - 0.75rem);
        object-fit: cover;
        background: var(--surface-3);
      }

      .thumb--fallback {
        display: grid;
        place-items: center;
        color: #fff;
        font-size: 1.75rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .body {
        display: flex;
        flex-direction: column;
        gap: 0.1875rem;
        min-width: 0;
      }

      /* The hierarchy the whole card hangs on: a near-black semibold title against a muted
         stone description, so the eye lands on the dish name first at arm's length. */
      .name {
        color: var(--text);
        font-size: 0.9375rem;
        font-weight: 600;
        line-height: 1.3;
        letter-spacing: -0.01em;
      }

      .description {
        color: var(--text-muted);
        font-size: 0.8125rem;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.375rem;
      }

      .price {
        color: var(--text);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0.25rem 0.75rem;
        border-radius: var(--radius-pill);
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.2;
        white-space: nowrap;
      }

      .badge--count {
        background: var(--accent-soft);
        color: var(--accent-hover);
      }

      .add {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 50%;
        background: var(--accent);
        color: var(--accent-contrast);
        font-size: 1.25rem;
        font-weight: 600;
        line-height: 1;
        box-shadow: 0 4px 12px -2px var(--accent-glow);
      }
    `,
  ],
})
export class ProductCardComponent {
  readonly product = input.required<ProductDto>();
  readonly currency = input.required<string>();

  /** How many are already in the basket, across every line of this product. */
  readonly quantity = input(0);

  readonly open = output<ProductDto>();

  /** A URL that 404s should fall back to the tile, not leave a broken-image icon. */
  protected readonly imageFailed = signal(false);

  protected readonly showImage = computed(() => !!this.product().imageUrl && !this.imageFailed());

  protected readonly initial = computed(() => this.product().name.trim().charAt(0) || '?');

  /** A stable colour per product, so a menu without photos still looks deliberate. */
  protected readonly fallbackColor = computed(() => {
    const id = this.product().id;
    let hash = 0;

    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;

    const hue = Math.abs(hash) % 360;

    return `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 38) % 360} 62% 42%))`;
  });
}
