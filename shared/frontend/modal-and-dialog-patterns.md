---
title: "Modal and Dialog Patterns"
category: "design-systems"
applies_to: "Any browser UI that opens an overlay: React, Vue, Svelte, or plain DOM"
last_updated: "2026-09-30"
source: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog, https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/"
---

# Modal and Dialog Patterns

An accessible modal is mostly solved by the platform: `<dialog>` is Baseline widely available, and `showModal()` gives you the top layer, the focus containment, and Escape handling that libraries used to reimplement badly. What it does not give you is scroll locking, light-dismiss, or focus *return* — and those three are what you still have to build.

## When to Use

- The target project renders any overlay that must block interaction with the page behind it.
- A review asks whether the modal traps focus, returns focus on close, or is announced correctly.
- A component library ships its own modal primitive and the question is whether the dependency earns its place.

## Usage Example

### Start from `<dialog>`, not a portal + `z-index`

`<dialog>` is **Baseline widely available** per MDN. `showModal()` puts the element in the **top layer**, which is why a modal is no longer a `z-index` arms race against a header that sets `z-index: 9999`.

```jsx
function ConfirmDialog({ open, title, children, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby="confirm-title" onClose={onClose}>
      <h2 id="confirm-title">{title}</h2>
      {children}
      <form method="dialog">
        <button value="cancel">Cancel</button>
        <button value="ok">Confirm</button>
      </form>
    </dialog>
  );
}
```

`method="dialog"` closes the dialog on submit and sets `dialog.returnValue` to the activated button's value — no state juggling per button.

### What the platform gives you, and what it does not

| Concern | `<dialog>` + `showModal()` | You still build |
|---|---|---|
| Top layer / stacking | Yes — escapes `z-index` conflicts | — |
| Focus containment | Yes | Initial focus placement (`autofocus`, or `tabindex="-1"` on a container) |
| Escape to close | Yes, closes the most recently shown dialog | — |
| `role="dialog"` + `aria-modal="true"` | Implicit | `aria-labelledby` pointing at a visible title |
| Focus return to the trigger | **No** | Remember the opener, restore on close |
| Body scroll lock | **No** | `overflow: hidden` on `<html>`, or better: `::backdrop` sizing |
| Light dismiss (click outside) | **No** | Click handler that ignores clicks inside the box |
| Animation | Limited | `display` must be animatable; the discrete-type flip is subtle |

MDN's guidance on Escape is worth keeping intact: *"Keyboard users expect the Esc key to close modal dialogs; ensure that this behavior is implemented and maintained."* With stacked dialogs, Escape closes only the last one shown.

### The focus rules that are actually required

Per the WAI-ARIA Authoring Practices for the modal dialog pattern:

- The container has `role="dialog"` and `aria-modal="true"`.
- It has `aria-labelledby` referencing a **visible** title, or an `aria-label`.
- `Tab` cycles within the dialog; `Shift+Tab` cycles backwards. The APG specifies the wrap: from the last tabbable element, focus moves to the first.
- Escape closes.
- The tab sequence **must include a visible close control** — *"It is strongly recommended that the tab sequence of all dialogs include a visible element with role button that closes the dialog."*
- For long or structured content, the APG recommends `tabindex="-1"` on a static element at the start and focusing that, so a screen reader can navigate the structure rather than reading one unbroken string.

```css
/* scroll lock without the layout-shift of position:fixed on <body> */
html:has(dialog[open]) { overflow: hidden; }

/* the ::backdrop pseudo-element is the correct place for the scrim */
dialog::backdrop { background: rgb(0 0 0 / 0.5); }
```

### When a portal is still the right tool

`createPortal` solves **DOM position**, not accessibility. Reach for it when the overlay must escape an ancestor with `overflow: hidden` or `transform` (which creates a containing block), or when a modal must render outside a stacking-context-trapping subtree. Two things it does not give you: the top layer (use `<dialog>`), and focus containment.

The gotchas: React events **do** bubble through portals to the React parent, so an outside-click handler on the parent fires for clicks inside the portal unless you check `event.target`. And `transform`/`filter`/`will-change` on an ancestor creates a containing block that re-anchors a portalled fixed element.

## Caveats

- **`show()` is not `showModal()`.** The non-modal `show()` puts the dialog in normal flow: no top layer, no focus containment, and — MDN's own note — a non-modal dialog *"does not dismiss via the Esc key by default."* Using `show()` for something the user experiences as modal is an accessibility regression, not a styling choice.
- **`<dialog>` does not lock scroll.** This is the single most common gap. The `overflow: hidden` approach on `<html>` avoids the scrollbar-width jump; setting `position: fixed` on `<body>` avoids it only if you also restore scroll position on close.
- **Declarative opening is now possible** via the Invoker Commands API (`commandfor` / `command="show-modal"` on a `<button>`), which also wires the opener as the focus-return target. Baseline support is narrower than `<dialog>` itself — feature-detect before relying on it.
- **`useEffect`-driven `showModal()` is a workaround for React not having a declarative binding.** It is what the current ecosystem does, and it means the dialog is not in the DOM on the server render — check that your snapshots and tests do not depend on it existing pre-hydration.
- **Animation needs `display` to be animatable.** MDN notes browsers flip between `none` and another `display` value using the discrete animation type; animating `opacity` or `transform` on the dialog is more predictable than animating `display`.
- This asset covers the **modal** pattern. Non-modal transient surfaces (toasts, popovers, comboboxes) follow different APG patterns with different focus rules — do not reuse the modal's trap for them.