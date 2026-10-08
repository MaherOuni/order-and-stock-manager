import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { CustomizationKind, ProductDto } from '../../core/api.models';
import { CartCustomization } from '../../core/cart.store';
import { loadResource } from '../../core/load-state';
import { MoneyPipe } from '../../core/money.pipe';
import { OrderApiService } from '../../core/order-api.service';
import { BottomSheetComponent } from './bottom-sheet.component';

/** Keep it as the recipe has it, take it out, or have twice as much. */
type Choice = 'keep' | 'remove' | 'extra';

export interface ProductSelection {
  readonly product: ProductDto;
  readonly quantity: number;
  readonly notes: string | null;
  readonly customizations: readonly CartCustomization[];
}

/**
 * The product screen: picture, description, and the two things a customer actually wants to
 * change before ordering — what is in it, and how many.
 *
 * The choices come from the product's own recipe, so "no milk" is only offered on something
 * that has milk in it, and the server can act on it rather than reading a note and guessing.
 */
@Component({
  selector: 'app-product-sheet',
  standalone: true,
  imports: [BottomSheetComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-bottom-sheet [title]="product().name" (dismiss)="dismiss.emit()">
      <figure class="hero">
        @if (product().imageUrl) {
          <img [src]="product().imageUrl" [alt]="product().name" />
        } @else {
          <div class="hero__fallback" aria-hidden="true">{{ product().name.charAt(0) }}</div>
        }
      </figure>

      @if (product().description) {
        <p class="description">{{ product().description }}</p>
      }

      <div class="meta">
        <span class="price">{{ product().price | money: currency() }}</span>

        <div class="stepper" role="group" aria-label="Quantity">
          <button type="button" (click)="quantity.set(quantity() - 1)" [disabled]="quantity() <= 1">
            &minus;
          </button>
          <span aria-live="polite">{{ quantity() }}</span>
          <button type="button" (click)="quantity.set(quantity() + 1)">+</button>
        </div>
      </div>

      @if (recipe.loading()) {
        <p class="loading">Loading options…</p>
      } @else if (options().length > 0) {
        <h3 class="c-label section">Make it yours</h3>
        <ul class="options">
          @for (option of options(); track option.ingredientId) {
            <li class="option">
              <span class="option__name">{{ option.ingredientName }}</span>

              <div class="segmented" role="group" [attr.aria-label]="option.ingredientName">
                @for (choice of choices; track choice.value) {
                  <button
                    type="button"
                    class="segment"
                    [class.segment--active]="choiceFor(option.ingredientId) === choice.value"
                    (click)="choose(option.ingredientId, choice.value)"
                  >
                    {{ choice.label }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }

      <h3 class="c-label section">Anything else?</h3>
      <input
        class="c-field note"
        [value]="notes()"
        (input)="notes.set(text($event))"
        placeholder="Extra hot, no straw, little ice…"
        maxlength="300"
      />

      <div sheetActions class="actions">
        <button type="button" class="c-cta add" (click)="confirm()">
          Add to basket · {{ total() | money: currency() }}
        </button>
      </div>
    </app-bottom-sheet>
  `,
  styles: [
    `
      /* A rounded image block, inset from the sheet's edges the way the detail screen is
         drawn — the picture is a card in the layout, not a full-bleed banner. */
      .hero {
        margin: 0 0 1.25rem;
        aspect-ratio: 16 / 10;
        border-radius: var(--radius-lg);
        overflow: hidden;
        background: var(--surface-2);
      }

      .hero img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .hero__fallback {
        display: grid;
        place-items: center;
        height: 100%;
        font-size: 3rem;
        font-weight: 800;
        color: var(--text-faint);
      }

      .description {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.875rem;
        line-height: 1.6;
      }

      /* Price and quantity share a line, the way the detail screen pairs the price with its
         size selector — the two numbers the customer is deciding between, side by side. */
      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-top: 1.25rem;
      }

      .price {
        color: var(--text);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }

      .section {
        margin: 1.75rem 0 0.75rem;
      }

      .loading {
        margin: 1rem 0 0;
        color: var(--text-muted);
        font-size: 0.875rem;
      }

      .options {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .option__name {
        font-size: 0.875rem;
        font-weight: 700;
        min-width: 0;
      }

      /* Bare choices rather than a segmented track: the detail screen sets its size options as
         separate round chips, with the chosen one filled solid. */
      .segmented {
        display: flex;
        flex: 0 0 auto;
        gap: 0.375rem;
      }

      .segment {
        padding: 0.4375rem 0.875rem;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--surface-2);
        color: var(--text-muted);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
        transition:
          background-color var(--press-dur) var(--press-ease),
          color var(--press-dur) var(--press-ease),
          transform var(--press-dur) var(--press-ease);
      }

      .segment:active {
        transform: scale(var(--press-scale));
      }

      .segment--active {
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .actions {
        width: 100%;
      }

      /* Circular −/+ either side of the count, as the cart draws it. */
      .stepper {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 0 0 auto;
      }

      .stepper button {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border: 0;
        border-radius: 50%;
        background: var(--surface-2);
        color: var(--text);
        font: inherit;
        font-size: 1.125rem;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          background-color var(--press-dur) var(--press-ease);
      }

      .stepper button:active:not(:disabled) {
        transform: scale(var(--press-scale));
        background: var(--surface-3);
      }

      .stepper button:disabled {
        color: var(--text-faint);
      }

      .stepper span {
        min-width: 1.25rem;
        text-align: center;
        font-size: 1.0625rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .add {
        letter-spacing: 0.03em;
      }
    `,
  ],
})
export class ProductSheetComponent {
  readonly tenantSlug = input.required<string>();
  readonly product = input.required<ProductDto>();
  readonly currency = input.required<string>();

  readonly dismiss = output<void>();
  readonly add = output<ProductSelection>();

  protected readonly choices: readonly { value: Choice; label: string }[] = [
    { value: 'remove', label: 'None' },
    { value: 'keep', label: 'Normal' },
    { value: 'extra', label: 'Extra' },
  ];

  private readonly api = inject(OrderApiService);

  protected readonly recipe = loadResource(
    computed(() => ({ slug: this.tenantSlug(), productId: this.product().id })),
    ({ slug, productId }) => this.api.getCustomizations(slug, productId),
  );

  protected readonly options = computed(() => this.recipe.data()?.items ?? []);

  protected readonly quantity = signal(1);
  protected readonly notes = signal('');

  private readonly picks = signal<Record<string, Choice>>({});

  protected readonly total = computed(() => this.product().price * this.quantity());

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected choiceFor(ingredientId: string): Choice {
    return this.picks()[ingredientId] ?? 'keep';
  }

  protected choose(ingredientId: string, choice: Choice): void {
    this.picks.update((current) => ({ ...current, [ingredientId]: choice }));
  }

  protected confirm(): void {
    const customizations: CartCustomization[] = this.options()
      .map((option) => ({ option, choice: this.choiceFor(option.ingredientId) }))
      .filter(({ choice }) => choice !== 'keep')
      .map(({ option, choice }) => ({
        ingredientId: option.ingredientId,
        ingredientName: option.ingredientName,
        kind: (choice === 'remove' ? 'Removed' : 'Added') as CustomizationKind,
      }));

    this.add.emit({
      product: this.product(),
      quantity: this.quantity(),
      notes: this.notes().trim() || null,
      customizations,
    });
  }
}
