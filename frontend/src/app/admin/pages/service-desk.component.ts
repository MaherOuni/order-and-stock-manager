import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';

import {
  SERVICE_REQUEST_LABELS,
  ServiceRequestDto,
  ServiceRequestKind,
} from '../../core/api.models';
import { describeHttpError, loadResource } from '../../core/load-state';
import { AdminApiService } from '../data/admin-api.service';

const POLL_MS = 10_000;

/**
 * The floor queue: who is asking for a human, and what the customers thought afterwards.
 *
 * Polls like the order board does — a table pressing "call a waiter" is exactly the kind of
 * thing nobody should have to refresh a page to discover.
 */
@Component({
  selector: 'app-service-desk',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Service desk</h1>
          <p class="a-page__hint">Tables asking for a hand, and what people said afterwards.</p>
        </div>

        <button
          type="button"
          class="a-btn"
          [class.a-btn--primary]="live()"
          [attr.aria-pressed]="live()"
          (click)="live.set(!live())"
        >
          {{ live() ? 'Live' : 'Paused' }}
        </button>
      </div>

      @if (data.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (rowError(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (data.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else {
        <div class="a-card">
          <div class="a-card__head">
            <h2 class="a-card__title">Open requests</h2>
            <span class="a-badge" [class.a-badge--danger]="openRequests().length > 0">
              {{ openRequests().length }} waiting
            </span>
          </div>

          <div class="a-table-wrap">
            <table class="a-table">
              <tbody>
                @for (request of requests(); track request.id) {
                  <tr [class.a-row--alert]="request.status === 'Open'">
                    <td>
                      <strong>Table {{ request.tableNumber }}</strong>
                      <div class="a-muted">{{ label(request.kind) }}</div>
                    </td>
                    <td class="a-wrap">
                      @if (request.note) {
                        <span class="a-muted">“{{ request.note }}”</span>
                      } @else {
                        <span class="a-muted">—</span>
                      }
                    </td>
                    <td class="a-num a-muted">{{ request.createdAt | date: 'shortTime' }}</td>
                    <td>
                      <span class="a-badge" [class]="'a-badge ' + badge(request)">
                        {{ request.status }}
                      </span>
                    </td>
                    <td>
                      <div class="a-toolbar">
                        @if (request.status === 'Open') {
                          <button
                            type="button"
                            class="a-btn a-btn--sm"
                            [disabled]="busy() === request.id"
                            (click)="acknowledge(request)"
                          >
                            On my way
                          </button>
                        }
                        @if (request.status !== 'Resolved') {
                          <button
                            type="button"
                            class="a-btn a-btn--sm a-btn--primary"
                            [disabled]="busy() === request.id"
                            (click)="resolve(request)"
                          >
                            Done
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td><p class="a-empty">Nobody needs anything. Enjoy it.</p></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="a-card">
          <div class="a-card__head">
            <h2 class="a-card__title">Reviews</h2>
            @if (averageRating(); as average) {
              <span class="a-badge a-badge--accent">{{ average }} ★ average</span>
            }
          </div>

          <div class="a-table-wrap">
            <table class="a-table">
              <tbody>
                @for (review of reviews(); track review.id) {
                  <tr>
                    <td><strong>{{ stars(review.rating) }}</strong></td>
                    <td class="a-wrap">
                      {{ review.comment ?? '—' }}
                    </td>
                    <td class="a-num a-muted">{{ review.createdAt | date: 'shortTime' }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td><p class="a-empty">No reviews yet.</p></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
})
export class ServiceDeskComponent {
  readonly tenantSlug = input.required<string>();

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly live = signal(true);

  protected readonly data = loadResource(
    computed(() => this.tenantSlug()),
    (slug) => this.api.getServiceDesk(slug),
  );

  protected readonly requests = computed<readonly ServiceRequestDto[]>(
    () => this.data.data()?.requests ?? [],
  );

  protected readonly reviews = computed(() => this.data.data()?.reviews ?? []);

  protected readonly openRequests = computed(() =>
    this.requests().filter((request) => request.status !== 'Resolved'),
  );

  protected readonly averageRating = computed(() => {
    const reviews = this.reviews();

    if (reviews.length === 0) return null;

    const total = reviews.reduce((sum, review) => sum + review.rating, 0);

    return (total / reviews.length).toFixed(1);
  });

  protected readonly busy = signal<string | null>(null);
  protected readonly rowError = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      if (!this.live()) return;

      const subscription = interval(POLL_MS).subscribe(() =>
        this.data.reload({ silent: true }),
      );

      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected label(kind: ServiceRequestKind): string {
    return SERVICE_REQUEST_LABELS[kind] ?? kind;
  }

  protected badge(request: ServiceRequestDto): string {
    switch (request.status) {
      case 'Resolved':
        return 'a-badge--success';
      case 'Acknowledged':
        return 'a-badge--info';
      default:
        return 'a-badge--danger';
    }
  }

  protected stars(rating: number): string {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  protected acknowledge(request: ServiceRequestDto): void {
    this.run(request, this.api.acknowledgeRequest(this.tenantSlug(), request.id));
  }

  protected resolve(request: ServiceRequestDto): void {
    this.run(request, this.api.resolveRequest(this.tenantSlug(), request.id));
  }

  private run(request: ServiceRequestDto, call: import('rxjs').Observable<ServiceRequestDto>): void {
    if (this.busy()) return;

    this.busy.set(request.id);
    this.rowError.set(null);

    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.busy.set(null);
        // Folded in rather than refetched, so the queue does not reshuffle under a thumb.
        this.data.patch((view) => ({
          ...view,
          requests: view.requests.map((r) => (r.id === updated.id ? updated : r)),
        }));
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.rowError.set(describeHttpError(error));
      },
    });
  }
}
