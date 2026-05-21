export type ThemeColor =
  | "blue" | "cyan" | "teal" | "green" | "lime" | "yellow"
  | "orange" | "red" | "pink" | "grape" | "violet" | "indigo" | "gray"
  | "custom";

export type ColorScheme = "light" | "dark" | "amoled" | "auto";

export type RadiusSize = "xs" | "sm" | "md" | "lg" | "xl";

export type FontSize = "sm" | "md" | "lg";

export interface ThemeConfig {
  preset: string;
  primaryColor: ThemeColor;
  primaryShade: number;
  colorScheme: ColorScheme;
  radius: RadiusSize;
  fontSize: FontSize;
  /** Hex color for the RGB picker (only when primaryColor is "custom"). */
  customPrimaryHex: string;
}

export const DEFAULT_CONFIG: ThemeConfig = {
  preset: "midnight",
  primaryColor: "blue",
  primaryShade: 8,
  colorScheme: "dark",
  radius: "sm",
  fontSize: "sm",
  customPrimaryHex: "",
};
