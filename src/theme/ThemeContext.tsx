import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { createTheme, type MantineTheme } from "@mantine/core";
import type { ThemeConfig, ColorScheme, FontSize } from "./types";
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

/** Generate 10 Mantine-compatible shades from a hex color. */
function hexToShades(hex: string): readonly [string, string, string, string, string, string, string, string, string, string] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const result: [string, string, string, string, string, string, string, string, string, string] = [
    "", "", "", "", "", "", "", "", "", "",
  ];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const mix = (v: number) => Math.round(v + (255 - v) * (1 - t) * 0.85);
    const dark = (v: number) => Math.round(v * (1 - t * 0.85));
    // i=0 → lightest (mixed with white), i=9 → darkest (mixed with black)
    const blend = t < 0.5
      ? `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`
      : `#${dark(r).toString(16).padStart(2, "0")}${dark(g).toString(16).padStart(2, "0")}${dark(b).toString(16).padStart(2, "0")}`;
    result[i] = blend as never;
  }
  return result;
}

interface ThemeContextValue {
  config: ThemeConfig;
  theme: MantineTheme;
  colorScheme: ColorScheme;
  /** The actual Mantine color scheme to use ("light" | "dark"). Amoled maps to "dark". */
  mantineColorScheme: "light" | "dark";
  updateConfig: (partial: Partial<ThemeConfig>) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveColorScheme(raw: ColorScheme): ColorScheme {
  if (raw === "auto") {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }
  return raw;
}

function toMantineColorScheme(raw: ColorScheme): "light" | "dark" {
  const resolved = resolveColorScheme(raw);
  if (resolved === "amoled") return "dark";
  return resolved as "light" | "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<ThemeConfig>(loadConfig);

  const theme = useMemo<MantineTheme>(() => {
    try {
      const isCustom = config.primaryColor === "custom" && !!config.customPrimaryHex;
      // If custom is selected but no hex applied, or primaryColor is undefined, fall back to "blue"
      const primary = isCustom
        ? "custom"
        : (!config.primaryColor || config.primaryColor === "custom")
          ? "blue"
          : config.primaryColor;

      const opts: Record<string, unknown> = {
        primaryColor: primary,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        primaryShade: { light: config.primaryShade as any, dark: config.primaryShade as any },
        defaultRadius: config.radius || "sm",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSizes: {
          xs: "12px",
          sm: FONT_SIZES[config.fontSize] || "14px",
          md: config.fontSize === "sm" ? "16px" : config.fontSize === "md" ? "18px" : "20px",
          lg: config.fontSize === "sm" ? "18px" : config.fontSize === "md" ? "20px" : "22px",
          xl: config.fontSize === "sm" ? "20px" : config.fontSize === "md" ? "24px" : "28px",
        },
      };

      if (isCustom) {
        opts.colors = { custom: hexToShades(config.customPrimaryHex) };
      }

      return createTheme(opts as Parameters<typeof createTheme>[0]) as MantineTheme;
    } catch {
      // Fallback to default theme on any error
      return createTheme({
        primaryColor: "blue",
        primaryShade: { light: 6, dark: 8 },
        defaultRadius: "sm",
      }) as MantineTheme;
    }
  }, [config]);

  const updateConfig = useCallback((partial: Partial<ThemeConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const colorScheme = resolveColorScheme(config.colorScheme);
  const mantineColorScheme = toMantineColorScheme(config.colorScheme);

  // Set data-color-scheme attribute on document for CSS targeting (e.g. amoled overrides)
  useEffect(() => {
    document.documentElement.setAttribute("data-color-scheme", colorScheme);
  }, [colorScheme]);

  // Mantine v9 removed --mantine-primary-color-N aliases.
  // Re-create them so App.css borders/scrollbars work by copying
  // the actual color's shade variables (e.g. --mantine-color-blue-8).
  useEffect(() => {
    const root = document.documentElement;
    const primary = config.primaryColor;
    // Read each shade from the actual Mantine variable and alias it
    for (let i = 0; i <= 9; i++) {
      const sourceVar = `--mantine-color-${primary}-${i}`;
      const aliasVar = `--mantine-primary-color-${i}`;
      const value = getComputedStyle(root).getPropertyValue(sourceVar).trim();
      if (value) {
        root.style.setProperty(aliasVar, value);
      }
    }
  }, [config.primaryColor, config.customPrimaryHex, config.colorScheme]);

  const value = useMemo(
    () => ({ config, theme, colorScheme, mantineColorScheme, updateConfig }),
    [config, theme, colorScheme, mantineColorScheme, updateConfig],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
