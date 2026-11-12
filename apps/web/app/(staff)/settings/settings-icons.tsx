"use client";

import {
  BuildingsIcon,
  CurrencyCircleDollarIcon,
  FileTextIcon,
  SealCheckIcon,
  IdentificationCardIcon,
  PlayCircleIcon,
  ScalesIcon,
  SparkleIcon,
  TrendUpIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

type Icon = ComponentType<{ size?: number; "aria-hidden"?: boolean }>;

/** One icon per settings page, as in the mockup hub. */
export const SETTINGS_ICONS: Record<string, Icon> = {
  "/settings/companies": BuildingsIcon,
  "/settings/kyc": IdentificationCardIcon,
  "/settings/rent-rules": CurrencyCircleDollarIcon,
  "/settings/rent-index": TrendUpIcon,
  "/settings/rulebook": ScalesIcon,
  "/settings/contracts": FileTextIcon,
  "/settings/registration": SealCheckIcon,
  "/settings/agent": SparkleIcon,
  "/settings/import": UploadSimpleIcon,
  "/settings/demo": PlayCircleIcon,
};
