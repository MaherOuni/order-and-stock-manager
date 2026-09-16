import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin } from 'rxjs';

import { ProductDto } from '../../core/api.models';
import { describeHttpError, loadResource } from '../../core/load-state';
import { AdminApiService } from '../data/admin-api.service';
import { IngredientDto, UNITS } from '../data/admin.models';
import { ProductThumbComponent } from '../../shared/product-thumb.component';
import { ModalComponent } from '../ui/modal.component';
import { RecipeEditorComponent } from './recipe-editor.component';

interface IngredientDraft {
  readonly id: string | null;
  readonly name: string;
  readonly unit: string;
  readonly currentStock: number;
  readonly minimumStockAlert: number;
}

const BLANK: IngredientDraft = {
  id: null,
  name: '',
  unit: 'kg',
  currentStock: 0,
  minimumStockAlert: 0,
};

@Component({
  selector: 'app-inventory-manager',
  standalone: true,
  imports: [ModalComponent, RecipeEditorComponent, ProductThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Ingredients &amp; recipes</h1>
          <p class="a-page__hint">
            Stock items, and how much of each a product consumes when it is ordered.
          </p>
        </div>

        <button type="button" class="a-btn a-btn--primary" (click)="openIngredient(null)">
          New ingredient
        </button>
      </div>

      @if (data.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (data.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      }

      @if (ingredients().length > 0) {
        <div class="a-card a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Unit</th>
                <th class="a-num">In stock</th>
                <th class="a-num">Alert below</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (ingredient of ingredients(); track ingredient.id) {
                <tr [class.a-row--alert]="ingredient.isBelowMinimum">
                  <td class="a-wrap">
                    <strong>{{ ingredient.name }}</strong>
                    @if (ingredient.isBelowMinimum) {
                      <span class="a-badge a-badge--danger" style="margin-left: 0.5rem">Low</span>
                    }
                  </td>
                  <td>{{ ingredient.unit }}</td>
                  <td class="a-num">{{ ingredient.currentStock }}</td>
                  <td class="a-num">{{ ingredient.minimumStockAlert }}</td>
                  <td>
                    <div class="a-toolbar">
                      <button
                        type="button"
                        class="a-btn a-btn--sm"
                        (click)="openIngredient(ingredient)"
                      >
                        Edit
                      </button>

                      @if (pendingDelete() === ingredient.id) {
                        <button
                          type="button"
                          class="a-btn a-btn--sm a-btn--danger"
                          [disabled]="saving()"
                          (click)="confirmDelete(ingredient)"
                        >
                          Confirm
                        </button>
                        <button type="button" class="a-btn a-btn--sm" (click)="pendingDelete.set(null)">
                          Cancel
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="a-btn a-btn--sm"
                          (click)="pendingDelete.set(ingredient.id)"
                        >
                          Delete
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (!data.loading()) {
        <div class="a-card"><p class="a-empty">No ingredients yet.</p></div>
      }

      @if (rowError(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      <h2 class="a-page__title" style="margin-top: 0.5rem">Recipes</h2>
      <p class="a-page__hint" style="margin-top: -0.75rem">
        Stock is deducted from these the moment a customer orders.
      </p>

      @if (products().length > 0) {
        <div class="a-card a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Product</th>
                <th class="a-num">Ingredients</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (product of products(); track product.id) {
                <tr>
                  <td class="a-wrap">
                    <div class="a-media">
                      <app-product-thumb
                        [name]="product.name"
                        [imageUrl]="product.imageUrl"
                        [seed]="product.id"
                      />
                      <div>
                        <strong>{{ product.name }}</strong>
                        @if (!product.isActive) {
                          <span class="a-badge" style="margin-left: 0.5rem">Hidden</span>
                        }
                      </div>
                    </div>
                  </td>
                  <td class="a-num">
                    @if (product.recipeItemCount > 0) {
                      {{ product.recipeItemCount }}
                    } @else {
                      <span class="a-muted">none</span>
                    }
                  </td>
                  <td>
                    <button type="button" class="a-btn a-btn--sm" (click)="editRecipe(product)">
                      {{ product.recipeItemCount > 0 ? 'Edit recipe' : 'Map ingredients' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (!data.loading()) {
        <div class="a-card">
          <p class="a-empty">No products yet — add some on the Menu page first.</p>
        </div>
      }
    </section>

    @if (recipeFor(); as product) {
      <app-recipe-editor
        [tenantSlug]="tenantSlug()"
        [productId]="product.id"
        [productName]="product.name"
        [ingredients]="ingredients()"
        (dismiss)="recipeFor.set(null)"
        (saved)="onRecipeSaved()"
      />
    }

    @if (draft(); as current) {
      <app-modal
        [title]="current.id ? 'Edit ingredient' : 'New ingredient'"
        [subtitle]="
          current.id
            ? 'Stock is not editable here — it only moves through Low stock, which writes the ledger.'
            : 'Any opening stock is recorded as the first line of its ledger.'
        "
        (dismiss)="closeIngredient()"
      >
        <div class="a-grid a-grid--2">
          <label class="a-field">
            <span class="a-field__label">Name</span>
            <input
              class="a-input"
              [value]="current.name"
              (input)="patch({ name: text($event) })"
              placeholder="Coffee beans"
            />
          </label>

          <label class="a-field">
            <span class="a-field__label">Unit</span>
            <select class="a-select" (change)="patch({ unit: text($event) })">
              @for (unit of units; track unit) {
                <option [value]="unit" [selected]="unit === current.unit">{{ unit }}</option>
              }
            </select>
          </label>

          @if (!current.id) {
            <label class="a-field">
              <span class="a-field__label">Opening stock</span>
              <input
                class="a-input a-input--num"
                type="number"
                min="0"
                step="0.0001"
                [value]="current.currentStock"
                (input)="patch({ currentStock: number($event) })"
              />
            </label>
          }

          <label class="a-field">
            <span class="a-field__label">Alert below</span>
            <input
              class="a-input a-input--num"
              type="number"
              min="0"
              step="0.0001"
              [value]="current.minimumStockAlert"
              (input)="patch({ minimumStockAlert: number($event) })"
            />
          </label>
        </div>

        @if (formError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }

        <ng-container modalActions>
          <button type="button" class="a-btn" (click)="closeIngredient()">Cancel</button>
          <button
            type="button"
            class="a-btn a-btn--primary"
            [disabled]="saving() || !current.name.trim()"
            (click)="saveIngredient()"
          >
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class InventoryManagerComponent {
  readonly tenantSlug = input.required<string>();

  protected readonly units = UNITS;

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = loadResource(
    computed(() => this.tenantSlug()),
    (slug) =>
      forkJoin({
        ingredients: this.api.getIngredients(slug),
        menu: this.api.getMenu(slug),
      }),
  );

  protected readonly ingredients = computed<readonly IngredientDto[]>(
    () => this.data.data()?.ingredients ?? [],
  );

  protected readonly products = computed<readonly ProductDto[]>(
    () => this.data.data()?.menu.products ?? [],
  );

  protected readonly draft = signal<IngredientDraft | null>(null);
  protected readonly recipeFor = signal<ProductDto | null>(null);
  protected readonly pendingDelete = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly rowError = signal<string | null>(null);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value.trim();
  }

  protected number(event: Event): number {
    const parsed = Number((event.target as HTMLInputElement).value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  protected patch(change: Partial<IngredientDraft>): void {
    this.draft.update((current) => (current ? { ...current, ...change } : current));
  }

  protected openIngredient(ingredient: IngredientDto | null): void {
    this.formError.set(null);
    this.pendingDelete.set(null);

    this.draft.set(
      ingredient
        ? {
            id: ingredient.id,
            name: ingredient.name,
            unit: ingredient.unit,
            currentStock: ingredient.currentStock,
            minimumStockAlert: ingredient.minimumStockAlert,
          }
        : BLANK,
    );
  }

  protected closeIngredient(): void {
    this.draft.set(null);
    this.formError.set(null);
  }

  protected saveIngredient(): void {
    const current = this.draft();

    if (!current || this.saving()) return;

    const request = current.id
      ? this.api.updateIngredient(this.tenantSlug(), current.id, {
          name: current.name.trim(),
          unit: current.unit,
          minimumStockAlert: current.minimumStockAlert,
        })
      : this.api.createIngredient(this.tenantSlug(), {
          name: current.name.trim(),
          unit: current.unit,
          currentStock: current.currentStock,
          minimumStockAlert: current.minimumStockAlert,
        });

    this.run(request, () => this.closeIngredient(), this.formError);
  }

  protected confirmDelete(ingredient: IngredientDto): void {
    this.run(
      this.api.deleteIngredient(this.tenantSlug(), ingredient.id),
      () => this.pendingDelete.set(null),
      this.rowError,
    );
  }

  protected editRecipe(product: ProductDto): void {
    this.rowError.set(null);
    this.recipeFor.set(product);
  }

  protected onRecipeSaved(): void {
    this.recipeFor.set(null);
    // The product's recipe count is computed server-side, so re-read rather than guess.
    this.data.reload({ silent: true });
  }

  private run(
    request: Observable<unknown>,
    onSuccess: () => void,
    errorSink: { set(value: string | null): void },
  ): void {
    this.saving.set(true);
    errorSink.set(null);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        onSuccess();
        this.data.reload({ silent: true });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        errorSink.set(describeHttpError(error));
      },
    });
  }
}
