import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/**
 * Turn on the phone keyboard's own predictive text for an `ion-textarea`.
 *
 * Ionic forwards only a fixed allow-list of attributes from `<ion-textarea>` down
 * to the real `<textarea>` it builds. `inputmode`, `enterkeyhint`,
 * `autocapitalize` and `spellcheck` make it through; `autocorrect` and
 * `autocomplete` are silently dropped. Those two are exactly what switches on
 * autocorrect, word suggestions and the predictive bar on a phone, so without
 * this the attributes look right in the template and do nothing on the device.
 *
 * The directive waits for Ionic to build its inner element and then sets the two
 * attributes on that real `<textarea>`. Native `<textarea>` elements in this app
 * (the create-post body) carry the attributes directly and need no help.
 */
@Directive({ selector: 'ion-textarea[lfKeyboard]', standalone: true })
export class KeyboardDirective implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLIonTextareaElement>>(ElementRef);

  async ngAfterViewInit(): Promise<void> {
    const el = this.host.nativeElement;
    if (typeof el.getInputElement !== 'function') return;
    try {
      const inner = await el.getInputElement();
      if (!inner) return;
      inner.setAttribute('autocorrect', 'on');
      inner.setAttribute('autocomplete', 'on');
      inner.setAttribute('spellcheck', 'true');
    } catch {
      /* the keyboard just keeps its defaults - never worth breaking the page over */
    }
  }
}
