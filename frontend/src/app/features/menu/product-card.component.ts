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
            <span class="count">{{ quantity() }} in basket</span>
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
        grid-template-columns: 5rem 1fr auto;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        padding: 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .card:active {
        transform: scale(0.995);
      }

      .thumb {
        width: 5rem;
        height: 5rem;
        border-radius: calc(var(--radius) - 4px);
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

      .name {
        font-size: 0.9375rem;
        font-weight: 650;
        line-height: 1.3;
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
        align-items: baseline;
        gap: 0.5rem;
        margin-top: 0.1875rem;
      }

      .price {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .count {
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 650;
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
