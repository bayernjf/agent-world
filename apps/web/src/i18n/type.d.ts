/**
 * i18n type augmentation for react-i18next.
 *
 * Provides type-safe t() calls: the compiler knows every valid key in
 * every namespace and will flag typos or missing keys at build time.
 *
 * The `resources` type is derived from the zh locale JSON files (zh is
 * the source of truth; en must have the same key set — guarded by
 * keys.test.ts).
 */

import "react-i18next";

import type common from "./locales/zh/common.json";
import type canvas from "./locales/zh/canvas.json";
import type nodes from "./locales/zh/nodes.json";
import type modals from "./locales/zh/modals.json";
import type settings from "./locales/zh/settings.json";
import type run from "./locales/zh/run.json";
import type errors from "./locales/zh/errors.json";
import type auth from "./locales/zh/auth.json";
import type reviews from "./locales/zh/reviews.json";
import type park from "./locales/zh/park.json";
import type tour from "./locales/zh/tour.json";
import type feedback from "./locales/zh/feedback.json";
import type announcements from "./locales/zh/announcements.json";

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      canvas: typeof canvas;
      nodes: typeof nodes;
      modals: typeof modals;
      settings: typeof settings;
      run: typeof run;
      errors: typeof errors;
      auth: typeof auth;
      reviews: typeof reviews;
      park: typeof park;
      tour: typeof tour;
      feedback: typeof feedback;
      announcements: typeof announcements;
    };
  }
}
