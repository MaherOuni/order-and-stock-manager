import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot } from '@angular/router';

import { environment } from '../../environments/environment';
import { DemoTitleStrategy } from './demo-title.strategy';

/**
 * What the strategy adds is the decoration, not the tree walk — `buildTitle` is Angular's own
 * and reads a private symbol off the route data, which cannot be built by hand. So these stub
 * it and assert on what happens to the title it returns.
 */
describe('DemoTitleStrategy', () => {
  const ANY_SNAPSHOT = {} as RouterStateSnapshot;

  let strategy: DemoTitleStrategy;
  let title: Title;
  let wasDemo: boolean;

  // `demoMode` is only readonly to TypeScript; the flag is a plain property at runtime.
  function setDemoMode(value: boolean): void {
    (environment as { demoMode: boolean }).demoMode = value;
  }

  function routedTitle(value: string | undefined): void {
    spyOn(strategy, 'buildTitle').and.returnValue(value);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});

    strategy = TestBed.inject(DemoTitleStrategy);
    title = TestBed.inject(Title);

    wasDemo = environment.demoMode;
  });

  afterEach(() => {
    setDemoMode(wasDemo);
  });

  it('marks every page as a demo while demo mode is on', () => {
    setDemoMode(true);
    routedTitle('Overview · Admin');

    strategy.updateTitle(ANY_SNAPSHOT);

    expect(title.getTitle()).toBe('Demo · Overview · Admin');
  });

  it('still says demo on a route that declares no title', () => {
    setDemoMode(true);
    routedTitle(undefined);

    strategy.updateTitle(ANY_SNAPSHOT);

    expect(title.getTitle()).toBe('Demo · Order & Stock');
  });

  it('leaves the routed title untouched off demo mode', () => {
    setDemoMode(false);
    routedTitle('Overview · Admin');

    strategy.updateTitle(ANY_SNAPSHOT);

    expect(title.getTitle()).toBe('Overview · Admin');
  });

  it('does not touch the document title for an untitled route off demo mode', () => {
    setDemoMode(false);
    routedTitle(undefined);
    title.setTitle('Order');

    strategy.updateTitle(ANY_SNAPSHOT);

    expect(title.getTitle()).toBe('Order');
  });
});
