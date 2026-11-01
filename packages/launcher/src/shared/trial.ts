/** Set by the private trial packaging command; absent in upstream-style builds. */
declare const __TRIAL_ORIGIN__: string | undefined
export const TRIAL_ORIGIN = typeof __TRIAL_ORIGIN__ === "undefined" ? undefined : __TRIAL_ORIGIN__
export const IS_TRIAL = Boolean(TRIAL_ORIGIN)
