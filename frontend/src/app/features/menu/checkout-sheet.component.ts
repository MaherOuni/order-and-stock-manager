import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import {
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  OrderType,
  PaymentMethod,
} from '../../core/api.models';
import { CartItem } from '../../core/cart.store';
import { MoneyPipe } from '../../core/money.pipe';
import { IconComponent } from '../../shared/icon.component';
import { BottomSheetComponent } from './bottom-sheet.component';

export interface CheckoutDetails {
  readonly orderType: OrderType;
  readonly tableNumber: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly deliveryAddress: string | null;
  readonly allergyNotes: string | null;
  readonly covers: number | null;
  readonly paymentMethod: PaymentMethod;
}

/**
 * Checkout: what is in the basket, where it is going, and how it is paid.
 *
 * The fields shown follow the order type rather than being asked for always — a customer
 * sitting at table 12 should not be typing their address, and a delivery cannot go anywhere
 * without one. Those are the same rules the API enforces, checked here so the answer is
 * immediate rather than a round trip.
 */
@Component({
  selector: 'app-checkout-sheet',
  standalone: true,
  imports: [BottomSheetComponent, MoneyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-bottom-sheet
      title="Your order"
      [subtitle]="items().length + ' item' + (items().length === 1 ? '' : 's')"
      (dismiss)="dismiss.emit()"
    >
      <ul class="lines">
        @for (item of items(); track item.lineId) {
          <li class="line">
            <div class="line__text">
              <span class="line__name">{{ item.name }}</span>

              @if (item.customizations.length > 0) {
                <span class="chips">
                  @for (change of item.customizations; track change.ingredientId) {
                    <span class="chip" [class.chip--add]="change.kind === 'Added'">
                      {{ change.kind === 'Added' ? '+' : '−' }} {{ change.ingredientName }}
                    </span>
                  }
                </span>
              }

              @if (item.notes) {
                <span class="line__note">“{{ item.notes }}”</span>
              }
            </div>

            <div class="stepper" role="group" [attr.aria-label]="'Quantity of ' + item.name">
              <button
                type="button"
                (click)="quantityChange.emit({ lineId: item.lineId, quantity: item.quantity - 1 })"
                [attr.aria-label]="'Remove one ' + item.name"
              >
                &minus;
              </button>
              <span>{{ item.quantity }}</span>
              <button
                type="button"
                (click)="quantityChange.emit({ lineId: item.lineId, quantity: item.quantity + 1 })"
                [attr.aria-label]="'Add one ' + item.name"
              >
                +
              </button>
            </div>

            <span class="line__total">{{ item.unitPrice * item.quantity | money: currency() }}</span>
          </li>
        }
      </ul>

      <h3 class="c-label section">How would you like it?</h3>
      <div class="types">
        @for (type of orderTypes; track type) {
          <button
            type="button"
            class="type"
            [class.type--active]="orderType() === type"
            (click)="orderType.set(type)"
          >
            <app-icon [name]="typeIcon(type)" [size]="20" />
            <span>{{ typeLabel(type) }}</span>
          </button>
        }
      </div>

      @if (orderType() === 'DineIn') {
        <div class="a-grid-2">
          <label class="field">
            <span class="field__label">Table</span>
            <input class="c-field input" [value]="tableNumber()" (input)="tableOverride.set(text($event))" />
          </label>

          <label class="field">
            <span class="field__label">How many of you?</span>
            <input
              class="c-field input"
              type="number"
              min="1"
              max="30"
              [value]="covers()"
              (input)="covers.set(number($event))"
            />
          </label>
        </div>
      } @else {
        <label class="field">
          <span class="field__label">Your name</span>
          <input
            class="c-field input"
            [value]="customerName()"
            (input)="customerName.set(text($event))"
            placeholder="So we can call it out"
          />
        </label>

        <label class="field">
          <span class="field__label">
            Phone {{ orderType() === 'Delivery' ? '(required)' : '(optional)' }}
          </span>
          <input
            class="c-field input"
            type="tel"
            [value]="customerPhone()"
            (input)="customerPhone.set(text($event))"
            placeholder="+216 …"
          />
        </label>
      }

      @if (orderType() === 'Delivery') {
        <label class="field">
          <span class="field__label">Delivery address</span>
          <input
            class="c-field input"
            [value]="deliveryAddress()"
            (input)="deliveryAddress.set(text($event))"
            placeholder="Street, number, floor"
          />
        </label>
      }

      <label class="field">
        <span class="field__label">Allergies or anything the kitchen must know</span>
        <input
          class="c-field input"
          [value]="allergyNotes()"
          (input)="allergyNotes.set(text($event))"
          placeholder="Nut allergy, no pork…"
          maxlength="500"
        />
      </label>

      <h3 class="c-label section">Payment</h3>
      <div class="methods">
        @for (method of paymentMethods; track method) {
          <button
            type="button"
            class="method"
            [class.method--active]="paymentMethod() === method"
            (click)="paymentMethod.set(method)"
          >
            <span class="method__label">{{ methodLabel(method) }}</span>
            <span class="method__hint">
              {{ method === 'Cash' ? 'Pay when it arrives' : 'Pay now, on your phone' }}
            </span>
          </button>
        }
      </div>

      @if (validationError(); as message) {
        <p class="error">{{ message }}</p>
      }

      @if (errorMessage(); as message) {
        <p class="error">{{ message }}</p>
      }

      <div sheetActions class="actions">
        <span class="total">
          <span class="total__label">Total</span>
          <span class="total__value">{{ total() | money: currency() }}</span>
        </span>

        <button
          type="button"
          class="c-cta submit"
          [disabled]="submitting() || validationError() !== null"
          (click)="place()"
        >
          {{ submitting() ? 'Sending…' : payLabel() }}
        </button>
      </div>
    </app-bottom-sheet>
  `,
  styles: [
    `
      /* The basket sits on the file's dark navy, the way the cart screen puts the order on a
         dark ground and everything you fill in on white below it. It also does real work here:
         the form underneath is long, and the block keeps "what I ordered" visually separate
         from "how I want it". */
      .lines {
        list-style: none;
        margin: 0 0 1.5rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
        border-radius: var(--radius-lg);
        background: var(--ink);
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 0.625rem;
      }

      .line + .line {
        padding-top: 0.875rem;
        border-top: 1px solid rgb(255 255 255 / 8%);
      }

      .line__text {
        display: flex;
        flex-direction: column;
        gap: 0.1875rem;
        min-width: 0;
      }

      .line__name {
        color: #fff;
        font-size: 0.9375rem;
        font-weight: 700;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      .chip {
        padding: 0.0625rem 0.4375rem;
        border-radius: var(--radius-pill);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.6875rem;
        font-weight: 650;
      }

      .chip--add {
        background: var(--success-surface);
        color: var(--success-text);
      }

      .line__note {
        color: rgb(255 255 255 / 55%);
        font-size: 0.75rem;
      }

      /* Round buttons on the dark block, matching the cart screen's quantity control. */
      .stepper {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .stepper button {
        display: grid;
        place-items: center;
        width: 1.875rem;
        height: 1.875rem;
        border: 0;
        border-radius: 50%;
        background: rgb(255 255 255 / 12%);
        color: #fff;
        font: inherit;
        font-size: 1rem;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          background-color var(--press-dur) var(--press-ease);
      }

      .stepper button:active:not(:disabled) {
        transform: scale(var(--press-scale));
        background: rgb(255 255 255 / 22%);
      }

      .stepper span {
        min-width: 1.25rem;
        text-align: center;
        color: #fff;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .line__total {
        min-width: 4.5rem;
        text-align: right;
        color: #fff;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .section {
        margin: 1.5rem 0 0.75rem;
      }

      .a-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.625rem;
      }

      .types {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
      }

      /* Flat grey tiles that fill with the accent when chosen — the same selected/unselected
         language as the size chips on the detail screen. */
      .type {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
        padding: 0.875rem 0.25rem;
        border: 0;
        border-radius: var(--radius-sm);
        background: var(--surface-2);
        color: var(--text-muted);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          background-color var(--press-dur) var(--press-ease),
          color var(--press-dur) var(--press-ease);
      }

      .type:active {
        transform: scale(var(--press-scale));
      }

      .type--active {
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 1rem;
      }

      .field__label {
        color: var(--text-faint);
        font-size: 0.75rem;
        font-weight: 400;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .methods {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .method {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.125rem;
        padding: 0.875rem 1.125rem;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background: var(--surface-2);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          transform var(--press-dur) var(--press-ease),
          border-color var(--press-dur) var(--press-ease);
      }

      .method:active {
        transform: scale(var(--press-scale));
      }

      .method--active {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      .method__label {
        font-size: 0.875rem;
        font-weight: 700;
      }

      .method__hint {
        color: var(--text-muted);
        font-size: 0.75rem;
      }

      .error {
        margin: 0.875rem 0 0;
        padding: 0.625rem 0.75rem;
        border-radius: var(--radius-sm);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.8125rem;
        line-height: 1.4;
      }

      /* Total above the button rather than beside it, as the cart screen lays it out — the
         figure gets a line of its own and the button gets the full width. */
      .actions {
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
        width: 100%;
      }

      .total {
        display: flex;
        align-items: baseline;
        gap: 0.625rem;
      }

      .total__label {
        color: var(--text-faint);
        font-size: 0.75rem;
        font-weight: 400;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .total__value {
        color: var(--text);
        font-size: 1.5rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
    `,
  ],
})
export class CheckoutSheetComponent {
  readonly items = input.required<readonly CartItem[]>();
  readonly total = input.required<number>();
  readonly currency = input.required<string>();
  readonly defaultTable = input.required<string>();
  readonly submitting = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly dismiss = output<void>();
  readonly quantityChange = output<{ lineId: string; quantity: number }>();
  readonly submit = output<CheckoutDetails>();

  protected readonly orderTypes = ORDER_TYPES;
  protected readonly paymentMethods = PAYMENT_METHODS;

  protected readonly orderType = signal<OrderType>('DineIn');
  protected readonly paymentMethod = signal<PaymentMethod>('Cash');
  protected readonly customerName = signal('');
  protected readonly customerPhone = signal('');
  protected readonly deliveryAddress = signal('');
  protected readonly allergyNotes = signal('');

  /** Capacity is what the floor plan knows; this is who actually turned up. */
  protected readonly covers = signal(2);

  /**
   * Null until the customer types something, so the field shows the table the QR code named
   * without needing an effect to seed it.
   */
  protected readonly tableOverride = signal<string | null>(null);

  protected readonly tableNumber = computed(() => this.tableOverride() ?? this.defaultTable());

  protected readonly validationError = computed<string | null>(() => {
    if (this.items().length === 0) return 'Your basket is empty.';

    switch (this.orderType()) {
      case 'DineIn':
        return this.tableNumber().trim() ? null : 'Which table are you at?';
      case 'Delivery':
        if (!this.deliveryAddress().trim()) return 'We need an address to deliver to.';
        if (!this.customerPhone().trim()) return 'The driver needs a phone number.';
        return null;
      default:
        return null;
    }
  });

  protected readonly payLabel = computed(() =>
    this.paymentMethod() === 'Cash' ? 'Place order' : 'Pay & order',
  );

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected number(event: Event): number {
    const parsed = Number((event.target as HTMLInputElement).value);

    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  protected typeLabel(type: OrderType): string {
    return ORDER_TYPE_LABELS[type];
  }

  protected typeIcon(type: OrderType): string {
    return type === 'DineIn' ? 'dineIn' : type === 'Takeaway' ? 'takeaway' : 'delivery';
  }

  protected methodLabel(method: PaymentMethod): string {
    return PAYMENT_METHOD_LABELS[method];
  }

  protected place(): void {
    if (this.validationError() !== null || this.submitting()) return;

    const type = this.orderType();

    this.submit.emit({
      orderType: type,
      tableNumber: type === 'DineIn' ? this.tableNumber().trim() : null,
      customerName: this.customerName().trim() || null,
      customerPhone: this.customerPhone().trim() || null,
      deliveryAddress: type === 'Delivery' ? this.deliveryAddress().trim() : null,
      allergyNotes: this.allergyNotes().trim() || null,
      covers: type === 'DineIn' ? this.covers() : null,
      paymentMethod: this.paymentMethod(),
    });
  }
}
