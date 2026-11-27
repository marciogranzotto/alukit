import { chooseTheme, type ThemePreference, themePreference } from "./theme.ts";

/**
 * The theme's switch (D-UX-21): follow the system, or pin dark or light, remembered per browser.
 * A select, so it is keyboard- and screen-reader-ready as it stands. Owner: S4; the top bar (S2)
 * places it.
 */
export function ThemeSwitch() {
  return (
    <label class="theme-switch" title="The colour theme: follow the system, or choose one">
      <span class="sr-only">Theme</span>
      <select
        data-testid="theme-switch"
        value={themePreference.value}
        onChange={(e) =>
          chooseTheme((e.currentTarget as HTMLSelectElement).value as ThemePreference)
        }
      >
        <option value="system">Theme: system</option>
        <option value="dark">Theme: dark</option>
        <option value="light">Theme: light</option>
      </select>
    </label>
  );
}
