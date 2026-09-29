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
      <span class="media">
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
          <span
            class="thumb thumb--fallback"
            [style.background]="fallbackColor()"
            aria-hidden="true"
          >
            {{ initial() }}
          </span>
        }

        @if (quantity() > 0) {
          <span class="badge">{{ quantity() }} in basket</span>
        }
      </span>

      <span class="name">{{ product().name }}</span>

      @if (product().description) {
        <span class="description">{{ product().description }}</span>
      }

      <span class="footer">
        <span class="price">{{ product().price | money: currency() }}</span>
        <span class="add" aria-hidden="true">+</span>
      </span>
    </button>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* A tile, not a row: image on top, then the name, then the price paired with the round
         add button. Two of these fit side by side, which is how the menu is drawn. */
      .card {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding: 0.5rem 0.5rem 0.875rem;
        border: 0;
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-xl);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          box-shadow var(--press-dur) var(--press-ease);
      }

      .card:active {
        transform: scale(var(--press-scale));
        box-shadow: var(--shadow-sm);
      }

      .media {
        position: relative;
        display: block;
        margin-bottom: 0.75rem;
      }

      .thumb {
        display: block;
        width: 100%;
        aspect-ratio: 1 / 1;
        /* Inset by the card's own padding, so the two curves sit concentric. */
        border-radius: calc(var(--radius-lg) - 0.5rem);
        object-fit: cover;
        background: var(--surface-2);
      }

      .thumb--fallback {
        display: grid;
        place-items: center;
        color: #fff;
        font-size: 2rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      /* Over the image rather than beside the price: the tile is narrow, and the price row has
         only enough room for the price and the button. */
      .badge {
        position: absolute;
        left: 0.5rem;
        bottom: 0.5rem;
        padding: 0.1875rem 0.5rem;
        border-radius: var(--radius-sm);
        background: var(--accent);
        color: var(--accent-contrast);
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 1.3;
      }

      .name {
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
        padding: 0 0.375rem;
        color: var(--text);
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.3;
      }

      .description {
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-top: 0.125rem;
        padding: 0 0.375rem;
        color: var(--text-muted);
        font-size: 0.8125rem;
        line-height: 1.4;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        /* Pins the price row to the bottom, so tiles of unequal text still line up. */
        margin-top: auto;
        padding: 0.625rem 0.375rem 0;
      }

      .price {
        color: var(--text);
        font-size: 1.0625rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .add {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 1.875rem;
        height: 1.875rem;
        border-radius: 50%;
        background: var(--accent);
        color: var(--accent-contrast);
        font-size: 1.125rem;
        font-weight: 700;
        line-height: 1;
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
