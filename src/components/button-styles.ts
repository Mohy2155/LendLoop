const base =
  "inline-flex min-h-10 items-center justify-center rounded-md text-sm font-semibold transition-colors";
const primary = "bg-primary text-primary-foreground hover:opacity-90";
const quiet = "border border-border bg-surface text-foreground hover:border-foreground";

export const primaryButton = `${base} px-4 ${primary}`;
export const quietButton = `${base} px-4 ${quiet}`;
/** Narrower variants for the header, which must fit a 320px screen. */
export const compactPrimaryButton = `${base} px-3 ${primary}`;
export const compactQuietButton = `${base} px-3 ${quiet}`;
