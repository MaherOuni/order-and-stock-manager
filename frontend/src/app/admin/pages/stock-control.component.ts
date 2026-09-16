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

import { describeHttpError, loadResource } from '../../core/load-state';
import { AdminApiService } from '../data/admin-api.service';
import {
  IngredientDto,
  RESTOCK_REASONS,
  StockChangeReason,
  WRITE_OFF_REASONS,
} from '../data/admin.models';
import { ModalComponent } from '../ui/modal.component';

interface MovementDraft {
  readonly ingredient: IngredientDto;
  readonly direction: 'in' | 'out';
  readonly quantity: number;
  readonly reason: StockChangeReason;
  readonly note: string;
}

/**
 * The low-stock dashboard. Every ingredient, with the ones at or below their alert threshold
 * called out, and the quick restock that is the whole point of looking at this page.
 */
@Component({
  selector: 'app-stock-control',
  standalone: true,
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Low stock</h1>
          <p class="a-page__hint">
            Stock only moves through here, and every movement leaves a line in the ledger.
          </p>
        </div>

        <div class="a-toolbar">
          <button
            type="button"
            class="a-btn"
            [class.a-btn--primary]="lowOnly()"
            (click)="lowOnly.set(!lowOnly())"
          >
            {{ lowOnly() ? 'Showing low only' : 'Show low only' }}
          </button>
          <button type="button" class="a-btn" [disabled]="stock.loading()" (click)="stock.reload()">
            Refresh
          </button>
        </div>
      </div>

      @if (alertCount() > 0) {
        <p class="a-error" role="status">
          {{ alertCount() }}
          {{ alertCount() === 1 ? 'ingredient is' : 'ingredients are' }} at or below the alert
          threshold.
        </p>
      } @else if (!stock.loading() && !stock.error()) {
        <p class="a-note">Everything is above its alert threshold.</p>
      }

      @if (stock.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (rowError(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (stock.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else {
        <div class="a-card a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Status</th>
                <th class="a-num">In stock</th>
                <th class="a-num">Alert below</th>
                <th class="a-num">Headroom</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (ingredient of ingredients(); track ingredient.id) {
                <tr [class.a-row--alert]="ingredient.isBelowMinimum">
                  <td class="a-wrap"><strong>{{ ingredient.name }}</strong></td>
                  <td>
                    @if (ingredient.isBelowMinimum) {
                      <span class="a-badge a-badge--danger">Low</span>
                    } @else {
                      <span class="a-badge a-badge--success">OK</span>
                    }
                  </td>
                  <td class="a-num">{{ ingredient.currentStock }} {{ ingredient.unit }}</td>
                  <td class="a-num">{{ ingredient.minimumStockAlert }} {{ ingredient.unit }}</td>
                  <td class="a-num">
                    {{ headroom(ingredient) }} {{ ingredient.unit }}
                  </td>
                  <td>
                    <div class="a-toolbar">
                      <button
                        type="button"
                        class="a-btn a-btn--sm a-btn--primary"
                        (click)="openMovement(ingredient, 'in')"
                      >
                        Restock
                      </button>
                      <button
                        type="button"
                        class="a-btn a-btn--sm"
                        (click)="openMovement(ingredient, 'out')"
                      >
                        Write off
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6">
                    <p class="a-empty">
                      {{ lowOnly() ? 'Nothing is running low.' : 'No ingredients yet.' }}
                    </p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (draft(); as current) {
      <app-modal
        [title]="(current.direction === 'in' ? 'Restock ' : 'Write off ') + current.ingredient.name"
        [subtitle]="
          'Currently ' + current.ingredient.currentStock + ' ' + current.ingredient.unit + ' in stock.'
        "
        (dismiss)="closeMovement()"
      >
        <div class="a-grid a-grid--2">
          <label class="a-field">
            <span class="a-field__label">
              Quantity to {{ current.direction === 'in' ? 'add' : 'remove' }} ({{
                current.ingredient.unit
              }})
            </span>
            <input
              class="a-input a-input--num"
              type="number"
              min="0"
              step="0.0001"
              [value]="current.quantity"
              (input)="patch({ quantity: number($event) })"
            />
          </label>

          <label class="a-field">
            <span class="a-field__label">Reason</span>
            <select class="a-select" (change)="patch({ reason: reasonOf($event) })">
              @for (reason of reasons(); track reason) {
                <option [value]="reason" [selected]="reason === current.reason">{{ reason }}</option>
              }
            </select>
          </label>

          <label class="a-field" style="grid-column: 1 / -1">
            <span class="a-field__label">Note (optional)</span>
            <input
              class="a-input"
              [value]="current.note"
              (input)="patch({ note: text($event) })"
              placeholder="Pallet #42"
            />
          </label>
        </div>

        <p class="a-note" style="margin-top: 0.75rem">
          New stock will be
          <strong>{{ projected(current) }} {{ current.ingredient.unit }}</strong>.
          @if (projected(current) < 0) {
            You cannot remove more than there is — the API will refuse this.
          }
        </p>

        @if (formError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }

        <ng-container modalActions>
          <button type="button" class="a-btn" (click)="closeMovement()">Cancel</button>
          <button
            type="button"
            class="a-btn a-btn--primary"
            [disabled]="saving() || current.quantity <= 0 || projected(current) < 0"
            (click)="save()"
          >
            {{ saving() ? 'Saving…' : 'Log movement' }}
          </button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class StockControlComponent {
  readonly tenantSlug = input.required<string>();

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly lowOnly = signal(false);

  protected readonly stock = loadResource(
    computed(() => ({ slug: this.tenantSlug(), lowOnly: this.lowOnly() })),
    ({ slug, lowOnly }) => this.api.getIngredients(slug, lowOnly),
  );

  protected readonly ingredients = computed<readonly IngredientDto[]>(() => this.stock.data() ?? []);

  protected readonly alertCount = computed(
    () => this.ingredients().filter((ingredient) => ingredient.isBelowMinimum).length,
  );

  protected readonly draft = signal<MovementDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly rowError = signal<string | null>(null);

  protected readonly reasons = computed(() =>
    this.draft()?.direction === 'out' ? WRITE_OFF_REASONS : RESTOCK_REASONS,
  );

  protected headroom(ingredient: IngredientDto): number {
    return round4(ingredient.currentStock - ingredient.minimumStockAlert);
  }

  protected projected(draft: MovementDraft): number {
    const delta = draft.direction === 'in' ? draft.quantity : -draft.quantity;

    return round4(draft.ingredient.currentStock + delta);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value.trim();
  }

  protected number(event: Event): number {
    const parsed = Number((event.target as HTMLInputElement).value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  protected reasonOf(event: Event): StockChangeReason {
    return (event.target as HTMLSelectElement).value as StockChangeReason;
  }

  protected patch(change: Partial<MovementDraft>): void {
    this.draft.update((current) => (current ? { ...current, ...change } : current));
  }

  protected openMovement(ingredient: IngredientDto, direction: 'in' | 'out'): void {
    this.formError.set(null);
    this.rowError.set(null);

    this.draft.set({
      ingredient,
      direction,
      quantity: 0,
      reason: direction === 'in' ? 'Delivery' : 'Waste',
      note: '',
    });
  }

  protected closeMovement(): void {
    this.draft.set(null);
    this.formError.set(null);
  }

  protected save(): void {
    const current = this.draft();

    if (!current || this.saving() || current.quantity <= 0) return;

    this.saving.set(true);
    this.formError.set(null);

    const changeAmount = current.direction === 'in' ? current.quantity : -current.quantity;

    this.api
      .adjustStock(this.tenantSlug(), current.ingredient.id, {
        changeAmount,
        reason: current.reason,
        note: current.note.trim() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.closeMovement();

          // The response carries the ingredient's new state, so the row updates without a
          // refetch — and without the table blinking under someone mid-count.
          this.stock.patch((ingredients) =>
            ingredients.map((ingredient) =>
              ingredient.id === result.ingredientId
                ? {
                    ...ingredient,
                    currentStock: result.currentStock,
                    minimumStockAlert: result.minimumStockAlert,
                    isBelowMinimum: result.isBelowMinimum,
                  }
                : ingredient,
            ),
          );

          // The "low only" view has to drop rows that are no longer low.
          if (this.lowOnly()) this.stock.reload({ silent: true });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.formError.set(describeHttpError(error));
        },
      });
  }
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
