import type { ComponentChildren, Ref } from 'preact';

export type ButtonVariant = 'primary' | 'secondary' | 'danger-outline' | 'danger';

export interface ButtonProps {
  readonly variant: ButtonVariant;
  /** Absent for a form's submit button, whose form handles the press (`type: 'submit'`). */
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit';
  readonly children: ComponentChildren;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** While a step is under way (an import being sent), so a second press cannot start it twice. */
  readonly disabled?: boolean;
}

const BASE =
  'rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Focus stays visible on every variant: the global `:focus-visible` outline uses `currentColor`, which is
 * white on the solid primary and danger buttons, so those variants set an outline colour that contrasts with the
 * page. The global rule is unlayered and so outranks Tailwind's layered utilities; the trailing `!` (important)
 * is what lets this one colour override it. The E2E test checks the ring's contrast in both themes.
 */
const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700 focus-visible:outline-neutral-900! dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:focus-visible:outline-neutral-100!',
  secondary:
    'border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100 dark:border-neutral-500 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700',
  'danger-outline':
    'border-red-700 bg-white text-red-800 hover:bg-red-50 dark:border-red-400 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950',
  danger:
    'border-red-700 bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700! dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:outline-red-300!',
};

/**
 * A plain `<button type="button">`, or a form's submit button, shared by the options page, the side panel and the
 * popup. Labels are verbs (ux_engineer copy rules).
 */
export function Button({
  variant,
  onClick,
  type = 'button',
  children,
  buttonRef,
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type={type}
      ref={buttonRef ?? null}
      onClick={onClick}
      disabled={disabled}
      class={`${BASE} ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}
