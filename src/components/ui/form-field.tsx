import {
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type FormControlProps = {
  id?: string;
  className?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
};

export const formControlClassName =
  "focus-ring min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-base leading-5 text-[var(--ink)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:bg-[var(--danger-soft)]/35 motion-reduce:transition-none sm:text-sm";

export type FormFieldProps = {
  id: string;
  label: ReactNode;
  children: ReactElement<FormControlProps>;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  controlClassName?: string;
};

/**
 * Gives one native form control a visible label and deterministic description/error
 * relationships. A caller-provided aria-describedby value is preserved.
 */
export function FormField({
  id,
  label,
  children,
  description,
  error,
  required = false,
  className,
  controlClassName,
}: FormFieldProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [
    children.props["aria-describedby"],
    description ? descriptionId : undefined,
    error ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const isRequired = required || children.props.required === true;

  const control = cloneElement(children, {
    id,
    className: cn(formControlClassName, children.props.className, controlClassName),
    required: isRequired,
    "aria-describedby": describedBy,
    "aria-errormessage": error
      ? errorId
      : children.props["aria-errormessage"],
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });

  return (
    <div className={cn("min-w-0", className)} data-slot="form-field">
      <label
        htmlFor={id}
        className="mb-1.5 flex min-h-5 items-baseline justify-between gap-3 text-sm leading-5 font-semibold text-[var(--ink)]"
      >
        <span>{label}</span>
        {isRequired ? (
          <span className="shrink-0 text-xs font-medium text-[var(--ink-faint)]">
            Required
          </span>
        ) : null}
      </label>
      {control}
      {description ? (
        <p
          id={descriptionId}
          className="mt-1.5 text-xs leading-5 text-[var(--ink-faint)]"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-xs leading-5 font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
