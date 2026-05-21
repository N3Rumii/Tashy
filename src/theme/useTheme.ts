import { useState, useCallback, useMemo } from "react";
import { createTheme, type MantineTheme } from "@mantine/core";
import type { ThemeConfig, FontSize } from "./types";
import { DEFAULT_CONFIG } from "./types";

const STORAGE_KEY = "file-tagger-theme";

function loadConfig(): ThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: ThemeConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

const FONT_SIZES: Record<FontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
};

export function useTheme() {
  const [config, setConfigState] = useState<ThemeConfig>(loadConfig);

  const mantineTheme = useMemo<MantineTheme>(() => {
    return createTheme({
      primaryColor: config.primaryColor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      primaryShade: { light: config.primaryShade as any, dark: config.primaryShade as any },
      defaultRadius: config.radius,
      fontFamily: "Inter, system-ui, sans-serif",
      fontSizes: {
        xs: "12px",
        sm: FONT_SIZES[config.fontSize],
        md: config.fontSize === "sm" ? "16px" : config.fontSize === "md" ? "18px" : "20px",
        lg: config.fontSize === "sm" ? "18px" : config.fontSize === "md" ? "20px" : "22px",
        xl: config.fontSize === "sm" ? "20px" : config.fontSize === "md" ? "24px" : "28px",
      },
    }) as MantineTheme;
  }, [config]);

  const updateConfig = useCallback((partial: Partial<ThemeConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const colorScheme = config.colorScheme === "auto"
    ? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : config.colorScheme;

  return { config, theme: mantineTheme, colorScheme, updateConfig };
}
