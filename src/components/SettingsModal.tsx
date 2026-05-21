import {
  Modal,
  Tabs,
  Stack,
  Group,
  Text,
  SegmentedControl,
  UnstyledButton,
  Box,
  SimpleGrid,
  Tooltip,
  Divider,
  ColorInput,
  Button,
} from "@mantine/core";
import {
  IconPalette,
  IconSettings,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconCircleFilled,
  IconCheck,
} from "@tabler/icons-react";
import { useState, useCallback } from "react";
import type { ThemeConfig, ThemeColor, ColorScheme, RadiusSize, FontSize } from "../theme/types";
import { PRESETS } from "../theme/presets";

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
  config: ThemeConfig;
  onUpdate: (partial: Partial<ThemeConfig>) => void;
}

const RECENT_KEY = "file-tagger-recent-colors";
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(hex: string) {
  const recent = loadRecent().filter((h) => h !== hex);
  recent.unshift(hex);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

const ALL_COLORS: ThemeColor[] = [
  "blue", "cyan", "teal", "green", "lime", "yellow",
  "orange", "red", "pink", "grape", "violet", "indigo", "gray", "custom",
];

const RADIUS_OPTIONS: { value: RadiusSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "sm", label: "SM" },
  { value: "md", label: "MD" },
  { value: "lg", label: "LG" },
  { value: "xl", label: "XL" },
];

const FONT_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

function ColorSwatch({
  color,
  selected,
  onClick,
  customHex,
}: {
  color: ThemeColor;
  selected: boolean;
  onClick: () => void;
  customHex?: string;
}) {
  const bg = color === "custom" && customHex
    ? customHex
    : `var(--mantine-color-${color}-filled)`;
  return (
    <Tooltip label={color === "custom" ? "Custom RGB" : color}>
      <UnstyledButton onClick={onClick}>
        <Box
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--mantine-radius-md)",
            background: bg,
            border: selected
              ? "3px solid var(--mantine-color-white)"
              : "2px solid transparent",
            transition: "border 0.15s, transform 0.15s",
            transform: selected ? "scale(1.15)" : "scale(1)",
          }}
        />
      </UnstyledButton>
    </Tooltip>
  );
}

function RecentSwatch({
  hex,
  onClick,
}: {
  hex: string;
  onClick: () => void;
}) {
  return (
    <Tooltip label={hex}>
      <UnstyledButton onClick={onClick}>
        <Box
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: hex,
            border: "1px solid var(--app-border)",
            transition: "transform 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.2)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        />
      </UnstyledButton>
    </Tooltip>
  );
}

function PresetCard({
  preset,
  selected,
  onClick,
}: {
  preset: (typeof PRESETS)[number];
  selected: boolean;
  onClick: () => void;
}) {
  const primaryColor = `var(--mantine-color-${preset.config.primaryColor}-6)`;
  return (
    <UnstyledButton onClick={onClick}>
      <Box
        p="sm"
        style={{
          borderRadius: "var(--mantine-radius-md)",
          border: selected
            ? "2px solid var(--mantine-primary-color-6)"
            : "2px solid var(--app-border)",
          background: selected
            ? "var(--app-surface-raised)"
            : "var(--app-surface)",
          transition: "border 0.15s, background 0.15s",
        }}
      >
        <Group gap="xs" mb={8}>
          <Box
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: primaryColor,
              flexShrink: 0,
            }}
          />
          <Text size="sm" fw={600}>
            {preset.label}
          </Text>
        </Group>
        {/* Mini preview bars */}
        <Box
          style={{
            height: 8,
            background: primaryColor,
            borderRadius: 4,
            opacity: 0.6,
            marginBottom: 4,
          }}
        />
        <Box
          style={{
            height: 4,
            background: "var(--app-border-light)",
            borderRadius: 2,
          }}
        />
      </Box>
    </UnstyledButton>
  );
}

export default function SettingsModal({
  opened,
  onClose,
  config,
  onUpdate,
}: SettingsModalProps) {
  // Draft hex — what's in the picker, not yet applied
  const [draftHex, setDraftHex] = useState(config.customPrimaryHex || "");
  const [recentColors, setRecentColors] = useState<string[]>(loadRecent);

  const handleApplyCustom = useCallback(() => {
    const hex = draftHex.trim();
    if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      saveRecent(hex);
      setRecentColors(loadRecent());
      onUpdate({ primaryColor: "custom", preset: "custom", customPrimaryHex: hex });
    }
  }, [draftHex, onUpdate]);

  const handleRecentClick = useCallback((hex: string) => {
    setDraftHex(hex);
  }, []);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconSettings size={18} />
          <Text fw={600}>Settings</Text>
        </Group>
      }
      size="lg"
    >
      <Tabs defaultValue="theme">
        <Tabs.List>
          <Tabs.Tab value="theme" leftSection={<IconPalette size={14} />}>
            Theme
          </Tabs.Tab>
          <Tabs.Tab value="general" leftSection={<IconSettings size={14} />}>
            General
          </Tabs.Tab>
        </Tabs.List>

        {/* ───── Theme tab ───── */}
        <Tabs.Panel value="theme" pt="md">
          <Stack gap="md">
            {/* Presets */}
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Presets
            </Text>
            <SimpleGrid cols={3} spacing="sm">
              {PRESETS.map((preset) => (
                <PresetCard
                  key={preset.name}
                  preset={preset}
                  selected={config.preset === preset.name}
                  onClick={() => {
                    const { colorScheme: _, ...rest } = preset.config;
                    setDraftHex("");
                    onUpdate({ ...rest, preset: preset.name, customPrimaryHex: "" });
                  }}
                />
              ))}
            </SimpleGrid>

            <Divider />

            {/* Custom Primary Color */}
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Primary Color
            </Text>
            <Group gap={4}>
              {ALL_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  customHex={config.customPrimaryHex}
                  selected={config.primaryColor === color}
                  onClick={() => {
                    setDraftHex("");
                    onUpdate({ primaryColor: color, preset: "custom", customPrimaryHex: "" });
                  }}
                />
              ))}
            </Group>

            {/* RGB Picker + Apply */}
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <ColorInput
                size="xs"
                placeholder="#ff6600"
                value={draftHex}
                onChange={(v) => setDraftHex(v)}
                format="hex"
                swatches={[]}
                popoverProps={{ withinPortal: true }}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                leftSection={<IconCheck size={14} />}
                onClick={handleApplyCustom}
                disabled={!draftHex || !/^#[0-9a-fA-F]{6}$/.test(draftHex.trim())}
              >
                Apply
              </Button>
            </Group>

            {/* Recent colors */}
            {recentColors.length > 0 && (
              <Group gap={4}>
                <Text size="xs" c="dimmed" mr={4}>
                  Recent:
                </Text>
                {recentColors.map((hex) => (
                  <RecentSwatch
                    key={hex}
                    hex={hex}
                    onClick={() => handleRecentClick(hex)}
                  />
                ))}
              </Group>
            )}

            <Divider />

            {/* Color Scheme */}
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Color Scheme
            </Text>
            <SegmentedControl
              value={config.colorScheme}
              onChange={(v) =>
                onUpdate({ colorScheme: v as ColorScheme })
              }
              data={[
                {
                  value: "light",
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconSun size={14} />
                      <Text size="xs">Light</Text>
                    </Group>
                  ),
                },
                {
                  value: "dark",
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconMoon size={14} />
                      <Text size="xs">Dark</Text>
                    </Group>
                  ),
                },
                {
                  value: "amoled",
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconCircleFilled size={14} />
                      <Text size="xs">AMOLED</Text>
                    </Group>
                  ),
                },
                {
                  value: "auto",
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconDeviceDesktop size={14} />
                      <Text size="xs">Auto</Text>
                    </Group>
                  ),
                },
              ]}
            />
          </Stack>
        </Tabs.Panel>

        {/* ───── General tab ───── */}
        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            {/* Font Size */}
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Font Size
            </Text>
            <SegmentedControl
              value={config.fontSize}
              onChange={(v) => onUpdate({ fontSize: v as FontSize })}
              data={FONT_OPTIONS.map((fo) => ({
                value: fo.value,
                label: (
                  <Text size={fo.value === "lg" ? "md" : "xs"}>
                    {fo.label}
                  </Text>
                ),
              }))}
            />

            {/* Border Radius */}
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">
              Border Radius
            </Text>
            <SegmentedControl
              value={config.radius}
              onChange={(v) => onUpdate({ radius: v as RadiusSize })}
              data={RADIUS_OPTIONS.map((ro) => ({
                value: ro.value,
                label: (
                  <Stack gap={2} align="center">
                    <Box
                      style={{
                        width: 48,
                        height: 28,
                        borderRadius:
                          ro.value === "xs" ? 2 :
                          ro.value === "sm" ? 4 :
                          ro.value === "md" ? 8 :
                          ro.value === "lg" ? 12 : 16,
                        background: "var(--mantine-primary-color-6)",
                        border: "1px solid var(--mantine-primary-color-4)",
                      }}
                    />
                    <Text size="xs" c="dimmed">{ro.label}</Text>
                  </Stack>
                ),
              }))}
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
