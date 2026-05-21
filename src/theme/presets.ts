import type { ThemeConfig } from "./types";

export interface ThemePreset {
  name: string;
  label: string;
  config: ThemeConfig;
}

export const PRESETS: ThemePreset[] = [
  {
    name: "midnight",
    label: "Midnight",
    config: {
      preset: "midnight",
      primaryColor: "blue",
      primaryShade: 8,
      colorScheme: "dark",
      radius: "sm",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
  {
    name: "ocean",
    label: "Ocean",
    config: {
      preset: "ocean",
      primaryColor: "cyan",
      primaryShade: 7,
      colorScheme: "dark",
      radius: "sm",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
  {
    name: "forest",
    label: "Forest",
    config: {
      preset: "forest",
      primaryColor: "green",
      primaryShade: 7,
      colorScheme: "dark",
      radius: "md",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
  {
    name: "sunset",
    label: "Sunset",
    config: {
      preset: "sunset",
      primaryColor: "orange",
      primaryShade: 7,
      colorScheme: "dark",
      radius: "sm",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
  {
    name: "lavender",
    label: "Lavender",
    config: {
      preset: "lavender",
      primaryColor: "grape",
      primaryShade: 7,
      colorScheme: "dark",
      radius: "md",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
  {
    name: "mono",
    label: "Mono",
    config: {
      preset: "mono",
      primaryColor: "gray",
      primaryShade: 7,
      colorScheme: "dark",
      radius: "xs",
      fontSize: "sm",
      customPrimaryHex: "",
    },
  },
];
