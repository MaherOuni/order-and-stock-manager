import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { environment } from '../../environments/environment';

/** What the tab says when a route declares no title of its own. */
const DEMO_FALLBACK = 'Order & Stock';

/**
 * Puts "Demo ·" in front of every page title while demo mode is on.
 *
 * The banner only says "demo" to someone already looking at the page. A title says it in the
 * tab strip, in a bookmark and in the preview of a pasted link — which is where a shared demo
 * is most likely to be mistaken for the real thing.
 *
 * With demo mode off this behaves exactly like Angular's default strategy, down to leaving the
 * title untouched for a route that declares none.
 */
@Injectable({ providedIn: 'root' })
export class DemoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routed = this.buildTitle(snapshot);

    if (!environment.demoMode) {
      if (routed !== undefined) this.title.setTitle(routed);

      return;
    }

    this.title.setTitle(`Demo · ${routed ?? DEMO_FALLBACK}`);
  }
}
