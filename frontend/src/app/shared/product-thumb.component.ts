import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * A product's picture at table-row size, with a coloured initial as the fallback.
 *
 * Scanning a menu by name alone is slow; a 40px thumbnail is enough to find "the green one"
 * without paying for a real image grid. The fallback is deterministic per product id, so an
 * item without a photo still keeps the same tile every time you look at it.
 */
@Component({
  selector: 'app-product-thumb',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showImage()) {
      <img
        class="a-thumb"
        [class.a-thumb--lg]="large()"
        [src]="imageUrl()"
        [alt]="''"
        loading="lazy"
        decoding="async"
        (error)="failed.set(true)"
      />
    } @else {
      <span
        class="a-thumb"
        [class.a-thumb--lg]="large()"
        [style.background]="fallback()"
        aria-hidden="true"
      >
        {{ initial() }}
      </span>
    }
  `,
})
export class ProductThumbComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  /** Used only to keep the fallback colour stable for a given product. */
  readonly seed = input('');
  readonly large = input(false);

  protected readonly failed = signal(false);

  protected readonly showImage = computed(() => !!this.imageUrl() && !this.failed());

  protected readonly initial = computed(() => this.name().trim().charAt(0) || '?');

  protected readonly fallback = computed(() => {
    const key = this.seed() || this.name();
    let hash = 0;

    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;

    const hue = Math.abs(hash) % 360;

    return `linear-gradient(135deg, hsl(${hue} 55% 55%), hsl(${(hue + 38) % 360} 55% 45%))`;
  });
}
