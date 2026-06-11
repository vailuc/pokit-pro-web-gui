/**
 * ThemeProvider applies CSS data attributes for theming.
 * Uses data-theme for dark/light mode and data-accent for accent colors.
 * Updates color-scheme for browser-native controls.
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { ui } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;

    // Apply theme
    if (ui.theme === "auto") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

      const applyTheme = () => {
        const isDark = prefersDark.matches;
        root.setAttribute("data-theme", isDark ? "dark" : "light");
        root.style.colorScheme = isDark ? "dark" : "light";
      };

      applyTheme();
      prefersDark.addEventListener("change", applyTheme);

      return () => {
        prefersDark.removeEventListener("change", applyTheme);
      };
    } else {
      root.setAttribute("data-theme", ui.theme);
      root.style.colorScheme = ui.theme;
    }

    // Apply accent color
    root.setAttribute("data-accent", ui.accent);
  }, [ui.theme, ui.accent]);

  return <>{children}</>;
}
