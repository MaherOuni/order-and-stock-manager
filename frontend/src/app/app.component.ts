import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { DemoBannerComponent } from './demo/demo-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DemoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-demo-banner />
    <router-outlet />
  `,
})
export class AppComponent {}
