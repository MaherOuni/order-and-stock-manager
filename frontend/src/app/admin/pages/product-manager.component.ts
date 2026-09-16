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
import { Observable } from 'rxjs';

import { CategoryDto, ProductDto } from '../../core/api.models';
import { MoneyPipe } from '../../core/money.pipe';
import { describeHttpError, loadResource } from '../../core/load-state';
import { AdminApiService } from '../data/admin-api.service';
import { ProductPayload } from '../data/admin.models';
import { ProductThumbComponent } from '../../shared/product-thumb.component';
import { ModalComponent } from '../ui/modal.component';

interface ProductDraft extends ProductPayload {
  readonly id: string | null;
}

const BLANK: ProductDraft = {
  id: null,
  categoryId: '',
  name: '',
  price: 0,
  description: null,
  isActive: true,
  imageUrl: null,
};

@Component({
  selector: 'app-product-manager',
  standalone: true,
  imports: [ModalComponent, MoneyPipe, ProductThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Menu</h1>
          <p class="a-page__hint">
            What customers see when they scan. Hidden products stay in history but leave the menu.
          </p>
        </div>

        <div class="a-toolbar">
          <button type="button" class="a-btn" (click)="openCategory()">New category</button>
          <button
            type="button"
            class="a-btn a-btn--primary"
            [disabled]="categories().length === 0"
            (click)="openProduct(null)"
          >
            New product
          </button>
        </div>
      </div>

      @if (menu.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (menu.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else if (categories().length === 0) {
        <p class="a-note">
          Start with a category — every product belongs to one, and the menu groups by them.
        </p>
      }

      @if (products().length > 0) {
        <div class="a-card a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th class="a-num">Price</th>
                <th>Status</th>
                <th class="a-num">Recipe</th>
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
                        @if (product.description) {
                          <div class="a-muted">{{ product.description }}</div>
                        }
                      </div>
                    </div>
                  </td>
                  <td>{{ product.categoryName }}</td>
                  <td class="a-num">{{ product.price | money: currency() }}</td>
                  <td>
                    @if (product.isActive) {
                      <span class="a-badge a-badge--success">On the menu</span>
                    } @else {
                      <span class="a-badge">Hidden</span>
                    }
                  </td>
                  <td class="a-num">
                    @if (product.recipeItemCount > 0) {
                      {{ product.recipeItemCount }}
                    } @else {
                      <span class="a-muted">none</span>
                    }
                  </td>
                  <td>
                    <div class="a-toolbar">
                      <button type="button" class="a-btn a-btn--sm" (click)="openProduct(product)">
                        Edit
                      </button>

                      @if (pendingDelete() === product.id) {
                        <button
                          type="button"
                          class="a-btn a-btn--sm a-btn--danger"
                          [disabled]="saving()"
                          (click)="confirmDelete(product)"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          class="a-btn a-btn--sm"
                          (click)="pendingDelete.set(null)"
                        >
                          Cancel
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="a-btn a-btn--sm"
                          (click)="pendingDelete.set(product.id)"
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
      } @else if (!menu.loading() && categories().length > 0) {
        <div class="a-card"><p class="a-empty">No products yet.</p></div>
      }
    </section>

    @if (draft(); as current) {
      <app-modal
        [title]="current.id ? 'Edit product' : 'New product'"
        subtitle="Prices are what customers are charged; the API snapshots them onto each order."
        (dismiss)="closeProduct()"
      >
        <div class="a-grid a-grid--2">
          <label class="a-field">
            <span class="a-field__label">Name</span>
            <input
              class="a-input"
              [value]="current.name"
              (input)="patch({ name: text($event) })"
              placeholder="Café Latte"
            />
          </label>

          <label class="a-field">
            <span class="a-field__label">Category</span>
            <select class="a-select" (change)="patch({ categoryId: text($event) })">
              @for (category of categories(); track category.id) {
                <option [value]="category.id" [selected]="category.id === current.categoryId">
                  {{ category.name }}
                </option>
              }
            </select>
          </label>

          <label class="a-field">
            <span class="a-field__label">Price</span>
            <input
              class="a-input a-input--num"
              type="number"
              min="0"
              step="0.01"
              [value]="current.price"
              (input)="patch({ price: number($event) })"
            />
          </label>

          <label class="a-field">
            <span class="a-field__label">Image URL (optional)</span>
            <input
              class="a-input"
              [value]="current.imageUrl ?? ''"
              (input)="patch({ imageUrl: text($event) || null })"
              placeholder="https://…"
            />
          </label>

          <label class="a-field" style="grid-column: 1 / -1">
            <span class="a-field__label">Description (optional)</span>
            <input
              class="a-input"
              [value]="current.description ?? ''"
              (input)="patch({ description: text($event) || null })"
              placeholder="Espresso et lait vapeur."
            />
          </label>

          <label class="a-field" style="grid-column: 1 / -1">
            <span class="a-field__label">
              <input
                type="checkbox"
                [checked]="current.isActive"
                (change)="patch({ isActive: checked($event) })"
              />
              Show on the customer menu
            </span>
          </label>
        </div>

        @if (formError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }

        <ng-container modalActions>
          <button type="button" class="a-btn" (click)="closeProduct()">Cancel</button>
          <button
            type="button"
            class="a-btn a-btn--primary"
            [disabled]="saving() || !current.name.trim() || !current.categoryId"
            (click)="saveProduct()"
          >
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </ng-container>
      </app-modal>
    }

    @if (categoryDraft(); as category) {
      <app-modal title="New category" (dismiss)="categoryDraft.set(null)">
        <div class="a-grid a-grid--2">
          <label class="a-field">
            <span class="a-field__label">Name</span>
            <input
              class="a-input"
              [value]="category.name"
              (input)="patchCategory({ name: text($event) })"
              placeholder="Boissons"
            />
          </label>

          <label class="a-field">
            <span class="a-field__label">Sort order</span>
            <input
              class="a-input a-input--num"
              type="number"
              [value]="category.sortOrder"
              (input)="patchCategory({ sortOrder: number($event) })"
            />
          </label>
        </div>

        @if (formError(); as message) {
          <p class="a-error" style="margin-top: 0.75rem">{{ message }}</p>
        }

        <ng-container modalActions>
          <button type="button" class="a-btn" (click)="categoryDraft.set(null)">Cancel</button>
          <button
            type="button"
            class="a-btn a-btn--primary"
            [disabled]="saving() || !category.name.trim()"
            (click)="saveCategory()"
          >
            {{ saving() ? 'Saving…' : 'Create' }}
          </button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class ProductManagerComponent {
  readonly tenantSlug = input.required<string>();

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly menu = loadResource(
    computed(() => this.tenantSlug()),
    (slug) => this.api.getMenu(slug),
  );

  protected readonly currency = computed(() => this.menu.data()?.tenant.currency ?? 'USD');
  protected readonly categories = computed<readonly CategoryDto[]>(
    () => this.menu.data()?.categories ?? [],
  );
  protected readonly products = computed<readonly ProductDto[]>(
    () => this.menu.data()?.products ?? [],
  );

  protected readonly draft = signal<ProductDraft | null>(null);
  protected readonly categoryDraft = signal<{ name: string; sortOrder: number } | null>(null);
  protected readonly pendingDelete = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value.trim();
  }

  protected number(event: Event): number {
    const parsed = Number((event.target as HTMLInputElement).value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected patch(change: Partial<ProductDraft>): void {
    this.draft.update((current) => (current ? { ...current, ...change } : current));
  }

  protected patchCategory(change: Partial<{ name: string; sortOrder: number }>): void {
    this.categoryDraft.update((current) => (current ? { ...current, ...change } : current));
  }

  protected openProduct(product: ProductDto | null): void {
    this.formError.set(null);
    this.pendingDelete.set(null);

    this.draft.set(
      product
        ? {
            id: product.id,
            categoryId: product.categoryId,
            name: product.name,
            price: product.price,
            description: product.description,
            isActive: product.isActive,
            imageUrl: product.imageUrl,
          }
        : { ...BLANK, categoryId: this.categories()[0]?.id ?? '' },
    );
  }

  protected closeProduct(): void {
    this.draft.set(null);
    this.formError.set(null);
  }

  protected openCategory(): void {
    this.formError.set(null);
    this.categoryDraft.set({ name: '', sortOrder: this.categories().length + 1 });
  }

  protected saveProduct(): void {
    const current = this.draft();

    if (!current || this.saving()) return;

    const payload: ProductPayload = {
      categoryId: current.categoryId,
      name: current.name.trim(),
      price: current.price,
      description: current.description,
      isActive: current.isActive,
      imageUrl: current.imageUrl,
    };

    const request = current.id
      ? this.api.updateProduct(this.tenantSlug(), current.id, payload)
      : this.api.createProduct(this.tenantSlug(), payload);

    this.run(request, () => this.closeProduct());
  }

  protected saveCategory(): void {
    const current = this.categoryDraft();

    if (!current || this.saving()) return;

    this.run(
      this.api.createCategory(this.tenantSlug(), current.name.trim(), current.sortOrder),
      () => this.categoryDraft.set(null),
    );
  }

  protected confirmDelete(product: ProductDto): void {
    this.run(this.api.deleteProduct(this.tenantSlug(), product.id), () =>
      this.pendingDelete.set(null),
    );
  }

  /**
   * Runs a write, then reloads the menu. A product's category name and recipe count are both
   * computed server-side, so guessing the new row locally would be guessing wrong.
   */
  private run(request: Observable<unknown>, onSuccess: () => void): void {
    this.saving.set(true);
    this.formError.set(null);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        onSuccess();
        this.menu.reload({ silent: true });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.formError.set(describeHttpError(error));
      },
    });
  }
}
