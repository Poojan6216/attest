import type { ComponentChildren, Ref } from 'preact';

export type ButtonVariant = 'secondary' | 'danger-outline' | 'danger';

export interface ButtonProps {
  readonly variant: ButtonVariant;
  readonly onClick: () => void;
  readonly children: ComponentChildren;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

const BASE = 'rounded-md border px-3 py-1.5 text-sm font-medium';

/**
 * Focus stays visible on every variant: the global `:focus-visible` outline uses `currentColor`, which is
 * white on the solid danger button, so that variant sets an outline colour that contrasts with the page.
 * The global rule is unlayered and so outranks Tailwind's layered utilities; the trailing `!` (important)
 * is what lets this one colour override it. The E2E test checks the ring's contrast in both themes.
 */
const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  secondary:
    'border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100 dark:border-neutral-500 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700',
  'danger-outline':
    'border-red-700 bg-white text-red-800 hover:bg-red-50 dark:border-red-400 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950',
  danger:
    'border-red-700 bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700! dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:outline-red-300!',
};

/** A plain `<button type="button">`. Labels are verbs (ux_engineer copy rules). */
export function Button({ variant, onClick, children, buttonRef }: ButtonProps) {
  return (
    <button
      type="button"
      ref={buttonRef ?? null}
      onClick={onClick}
      class={`${BASE} ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}
