import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { describeHttpError, loadResource } from '../../core/load-state';
import { AdminApiService } from '../data/admin-api.service';
import { IngredientDto } from '../data/admin.models';
import { ModalComponent } from '../ui/modal.component';

interface RecipeLine {
  readonly ingredientId: string;
  readonly quantityRequired: number;
}

/**
 * Maps one product to the raw ingredients a single unit consumes — "1 Espresso = 0.018 kg
 * Coffee beans". Saving is a full replacement, matching `POST /api/v1/products/{id}/recipe`:
 * a line removed here is removed there.
 */
@Component({
  selector: 'app-recipe-editor',
  standalone: true,
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [title]="'Recipe · ' + productName()"
      subtitle="What one unit consumes from stock. Saving replaces the whole recipe."
      (dismiss)="dismiss.emit()"
    >
      @if (recipe.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else if (recipe.error()) {
        <p class="a-error">{{ recipe.error() }}</p>
      } @else {
        @if (ingredients().length === 0) {
          <p class="a-note">
            No ingredients defined yet. Add some in the ingredients table first — a recipe can
            only point at stock items that exist.
          </p>
        } @else {
          <div class="lines">
            @for (line of lines(); track $index) {
              <div class="line">
                <span class="line__lead">1 {{ productName() }} needs</span>

                <input
                  class="a-input a-input--num line__qty"
                  type="number"
                  min="0"
                  step="0.0001"
                  [value]="line.quantityRequired"
                  [attr.aria-label]="'Quantity required'"
                  (input)="update($index, { quantityRequired: number($event) })"
                />

                <span class="line__unit">{{ unitOf(line.ingredientId) }}</span>

                <span class="line__of">of</span>

                <select
                  class="a-select line__ingredient"
                  [attr.aria-label]="'Ingredient'"
                  (change)="update($index, { ingredientId: text($event) })"
                >
                  @for (ingredient of ingredients(); track ingredient.id) {
                    <option [value]="ingredient.id" [selected]="ingredient.id === line.ingredientId">
                      {{ ingredient.name }}
                    </option>
                  }
                </select>

                <button
                  type="button"
                  class="a-btn a-btn--sm"
                  [attr.aria-label]="'Remove ' + nameOf(line.ingredientId)"
                  (click)="remove($index)"
                >
                  Remove
                </button>
              </div>
            } @empty {
              <p class="a-empty">
                No ingredients mapped. This product sells without consuming any stock.
              </p>
            }
          </div>

          <div class="a-toolbar" style="margin-top: 0.75rem">
            <button
              type="button"
              class="a-btn"
              [disabled]="unusedIngredients().length === 0"
              (click)="add()"
            >
              Add ingredient
            </button>

            @if (recipe.data(); as loaded) {
              <span class="a-muted" style="font-size: 0.8125rem">
                Stock currently supports
                <strong>{{ producible(loaded.maxProducibleUnits) }}</strong> units.
              </span>
            }
          </div>
        }

        @if (validationError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }

        @if (saveError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }
      }

      <ng-container modalActions>
        <button type="button" class="a-btn" (click)="dismiss.emit()">Cancel</button>
        <button
          type="button"
          class="a-btn a-btn--primary"
          [disabled]="saving() || recipe.loading() || validationError() !== null"
          (click)="save()"
        >
          {{ saving() ? 'Saving…' : 'Save recipe' }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: [
    `
      .lines {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 0.375rem 0.5rem;
        padding: 0.625rem;
        border: 1px solid var(--border);
        border-radius: 10px;
      }

      .line__lead,
      .line__of,
      .line__unit {
        color: var(--text-muted);
        font-size: 0.8125rem;
        white-space: nowrap;
      }

      .line__qty {
        width: 7rem;
      }

      /* One row on anything wider than a phone, wrapped sentence-style below that. */
      @media (min-width: 40rem) {
        .line {
          grid-template-columns: auto 7rem auto auto 1fr auto;
        }
      }
    `,
  ],
})
export class RecipeEditorComponent {
  readonly tenantSlug = input.required<string>();
  readonly productId = input.required<string>();
  readonly productName = input.required<string>();
  readonly ingredients = input.required<readonly IngredientDto[]>();

  readonly dismiss = output<void>();
  readonly saved = output<void>();

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly recipe = loadResource(
    computed(() => ({ slug: this.tenantSlug(), productId: this.productId() })),
    ({ slug, productId }) => this.api.getRecipe(slug, productId),
  );

  /** Null until the first edit, so the loaded recipe stays the source of truth before that. */
  private readonly edits = signal<RecipeLine[] | null>(null);

  protected readonly lines = computed<readonly RecipeLine[]>(
    () =>
      this.edits() ??
      (this.recipe.data()?.items ?? []).map((item) => ({
        ingredientId: item.ingredientId,
        quantityRequired: item.quantityRequired,
      })),
  );

  protected readonly unusedIngredients = computed(() => {
    const used = new Set(this.lines().map((line) => line.ingredientId));

    return this.ingredients().filter((ingredient) => !used.has(ingredient.id));
  });

  protected readonly validationError = computed<string | null>(() => {
    const lines = this.lines();

    if (lines.some((line) => line.quantityRequired <= 0)) {
      return 'Every quantity must be greater than zero. Remove the line instead.';
    }

    const ids = lines.map((line) => line.ingredientId);

    if (new Set(ids).size !== ids.length) {
      return 'An ingredient can only appear once. Add its quantities together.';
    }

    return null;
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected text(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected number(event: Event): number {
    const parsed = Number((event.target as HTMLInputElement).value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  protected nameOf(ingredientId: string): string {
    return this.ingredients().find((ingredient) => ingredient.id === ingredientId)?.name ?? '';
  }

  protected unitOf(ingredientId: string): string {
    return this.ingredients().find((ingredient) => ingredient.id === ingredientId)?.unit ?? '';
  }

  /** The API returns int.MaxValue for a product that consumes nothing. */
  protected producible(max: number): string {
    return max >= 2_147_483_647 ? 'unlimited' : String(max);
  }

  protected add(): void {
    const next = this.unusedIngredients()[0];

    if (!next) return;

    this.edits.set([...this.lines(), { ingredientId: next.id, quantityRequired: 1 }]);
  }

  protected update(index: number, change: Partial<RecipeLine>): void {
    this.edits.set(
      this.lines().map((line, position) => (position === index ? { ...line, ...change } : line)),
    );
  }

  protected remove(index: number): void {
    this.edits.set(this.lines().filter((_, position) => position !== index));
  }

  protected save(): void {
    if (this.saving() || this.validationError() !== null) return;

    this.saving.set(true);
    this.saveError.set(null);

    this.api
      .setRecipe(this.tenantSlug(), this.productId(), {
        items: this.lines().map((line) => ({
          ingredientId: line.ingredientId,
          quantityRequired: line.quantityRequired,
        })),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.emit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.saveError.set(describeHttpError(error));
        },
      });
  }
}
