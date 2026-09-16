import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The handful of glyphs the admin needs, inline rather than from an icon font: a font is a
 * blocking network request and a flash of missing icons, for eleven shapes.
 *
 * All drawn on a 24×24 grid with a 1.8 stroke so they sit together.
 */
const PATHS: Record<string, string> = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  menu: 'M4 6h16M4 12h16M4 18h10',
  inventory: 'M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5v-7Zm0 0L12 13m0 0 8.5-4.5M12 13v7',
  stock: 'M12 3v18M5 8l7-5 7 5M5 8v8l7 5 7-5V8',
  orders: 'M8 4h9l3 3v13H8V4Zm0 0H5v16h3M11 10h6M11 14h6',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cash: 'M3 7h18v10H3V7Zm9 5a2 2 0 1 0 0-.01M6 10v4M18 10v4',
  alert: 'M12 9v4m0 3h.01M10.3 4.3 2.6 17.5A1.9 1.9 0 0 0 4.3 20.4h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z',
  dineIn: 'M6 3v8a3 3 0 0 0 6 0V3M9 11v10M17 3c-1.5 1.5-2 3-2 5.5s.7 3.5 2 3.5V3Zm0 9v9',
  takeaway: 'M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Zm3.5 0V6a3.5 3.5 0 0 1 7 0v2',
  delivery: 'M3 7h10v9H3V7Zm10 3h4l3 3v3h-7v-6ZM7 19a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 7 19Zm10 0a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z',
  external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }'],
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input(18);

  protected readonly path = computed(() => PATHS[this.name()] ?? '');
}
