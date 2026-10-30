import { runtimeDir } from "@/features/site-builder/server/runtime-bundle";

/**
 * The accessibility widget (components/a11y/*) copied whole into generated
 * zips. Relative imports only inside that folder, so it works verbatim.
 */
export function a11yFiles(): Record<string, string> {
  return runtimeDir("components/a11y", "components/a11y");
}
