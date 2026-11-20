/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_day from "../lib/day.js";
import type * as lib_lastReminder from "../lib/lastReminder.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_notifyPayload from "../lib/notifyPayload.js";
import type * as lib_paging from "../lib/paging.js";
import type * as lib_reminderText from "../lib/reminderText.js";
import type * as lib_requestDisplay from "../lib/requestDisplay.js";
import type * as lib_signedRequest from "../lib/signedRequest.js";
import type * as lib_toolOptions from "../lib/toolOptions.js";
import type * as notify from "../notify.js";
import type * as reminders from "../reminders.js";
import type * as requests from "../requests.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/day": typeof lib_day;
  "lib/lastReminder": typeof lib_lastReminder;
  "lib/notify": typeof lib_notify;
  "lib/notifyPayload": typeof lib_notifyPayload;
  "lib/paging": typeof lib_paging;
  "lib/reminderText": typeof lib_reminderText;
  "lib/requestDisplay": typeof lib_requestDisplay;
  "lib/signedRequest": typeof lib_signedRequest;
  "lib/toolOptions": typeof lib_toolOptions;
  notify: typeof notify;
  reminders: typeof reminders;
  requests: typeof requests;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
