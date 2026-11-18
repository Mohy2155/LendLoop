import { v } from "convex/values";

// Shared by the schema, the functions and the form, so this file imports only `convex/values`.
// The lists live in the validators; renaming or removing a value needs a data migration.
export const categoryValidator = v.union(
  v.literal("Power tools"),
  v.literal("Hand tools"),
  v.literal("Garden"),
  v.literal("Ladders and access"),
  v.literal("Cleaning"),
  v.literal("Other"),
);

export const conditionValidator = v.union(
  v.literal("New"),
  v.literal("Good"),
  v.literal("Fair"),
  v.literal("Worn"),
);

export const CATEGORIES = categoryValidator.members.map((m) => m.value);
export type Category = (typeof CATEGORIES)[number];
export const CONDITIONS = conditionValidator.members.map((m) => m.value);

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const MAX_TOOLS_PER_USER = 50;

// Text must contain a letter or digit, so invisible characters and punctuation alone are not a name.
export const VISIBLE_TEXT = /[\p{L}\p{N}]/u;
