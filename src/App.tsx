import { useState, useCallback, useEffect } from "react";
import { AppShell, ActionIcon, Tooltip, Group, Text, Stack, UnstyledButton, ScrollArea, Divider, Loader, Box } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconStar,
  IconStarFilled,
  IconFolder,
  IconX,
  IconPlus,
  IconChevronRight,
  IconDeviceDesktop,
  IconPlayerEject,
  IconRefresh,
} from "@tabler/icons-react";
import DirectoryTree from "./components/DirectoryTree";
import FileList from "./components/FileList";
import TagSidebar from "./components/TagSidebar";
import ErrorBoundary from "./components/ErrorBoundary";

const FAVORITES_KEY = "file-tagger-favorites";

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favs: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

function favName(path: string): string {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

// --- Disks Section Component ---

interface DiskInfo {
  device: string;
  fs_type: string;
  total: string;
  used: string;
  available: string;
  use_percent: string;
  mount_point: string;
}

function DisksSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadDisks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<DiskInfo[]>("list_mounted_disks");
      setDisks(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDisks();
    const interval = setInterval(loadDisks, 10000);
    return () => clearInterval(interval);
  }, [loadDisks]);

  const handleUnmount = async (device: string) => {
    try {
      await invoke("unmount_disk", { device });
      loadDisks();
    } catch (e) { console.error("Unmount failed:", e); }
  };

  return (
    <Box>
      <UnstyledButton
        onClick={() => setCollapsed((c) => !c)}
        px="xs" py="xs"
        style={{ width: "100%" }}
      >
        <Group gap={4} justify="space-between">
          <Group gap={4}>
            <IconDeviceDesktop size={16} />
            <Text size="sm" fw={600}>Disks</Text>
          </Group>
          <Group gap={4}>
            {loading && <Loader size={10} />}
            <ActionIcon size="xs" variant="subtle" onClick={(e) => { e.stopPropagation(); loadDisks(); }}>
              <IconRefresh size={12} />
            </ActionIcon>
            <IconChevronRight size={14} style={{
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 0.15s",
            }} />
          </Group>
        </Group>
      </UnstyledButton>
      {!collapsed && (
        <Stack gap={2} px={4}>
          {disks.map((disk) => (
            <Group key={disk.device} wrap="nowrap" justify="space-between" px={4} py={2}>
              <UnstyledButton
                onClick={() => onNavigate(disk.mount_point)}
                style={{ flex: 1 }}
              >
                <Group gap={4}>
                  <IconFolder size={14} />
                  <Box style={{ flex: 1 }}>
                    <Text size="xs" truncate>{favName(disk.mount_point)}</Text>
                    <Text size="xs" c="dimmed" truncate>{disk.device.replace("/dev/", "")} · {disk.available}B free</Text>
                  </Box>
                </Group>
              </UnstyledButton>
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={() => handleUnmount(disk.device)}
                title="Unmount"
              >
                <IconPlayerEject size={12} />
              </ActionIcon>
            </Group>
          ))}
          {!loading && disks.length === 0 && (
            <Text size="xs" c="dimmed" px="xs" pb="xs">No physical disks detected</Text>
          )}
        </Stack>
      )}
    </Box>
  );
}

function App() {
  const [activePath, setActivePath] = useState<string>("/home/n7reny");
  const [refreshKey, setRefreshKey] = useState(0);
  const [tagRefreshKey, setTagRefreshKey] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [tagsPaused, setTagsPaused] = useState(false);
  const [tagContextPath, setTagContextPath] = useState("");
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

  const handleRefreshRequest = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleToggleTag = useCallback((tagId: number) => {
    setTagsPaused(false); // any tag interaction unpauses
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) { next.delete(tagId); } else { next.add(tagId); }
      return next;
    });
  }, []);

  const handleClearTags = useCallback(() => {
    setSelectedTagIds(new Set());
    setTagsPaused(false);
    setTagContextPath("");
  }, []);

  const handleResumeTags = useCallback(() => {
    setTagsPaused(false);
  }, []);

  const handleNavigateWithTags = useCallback((path: string) => {
    if (selectedTagIds.size > 0 && !tagsPaused) {
      // Entering a directory while tag browsing — pause tags
      setTagsPaused(true);
      setTagContextPath(activePath);
    } else if (tagsPaused && !path.startsWith(tagContextPath + "/") && path !== tagContextPath) {
      // Navigated outside the tag context — resume
      setTagsPaused(false);
    }
    setActivePath(path);
  }, [selectedTagIds, tagsPaused, activePath, tagContextPath]);

  const handleTagsChanged = useCallback(() => {
    setTagRefreshKey((k) => k + 1);
  }, []);

  // --- Favorites ---
  const isFavorite = favorites.includes(activePath);
  const toggleFavoritePath = (path: string) => {
    setFavorites((prev) => {
      const isFav = prev.includes(path);
      const next = isFav
        ? prev.filter((p) => p !== path)
        : [...prev, path];
      saveFavorites(next);
      return next;
    });
  };
  const toggleFavorite = () => toggleFavoritePath(activePath);
  const removeFavorite = (path: string) => {
    setFavorites((prev) => {
      const next = prev.filter((p) => p !== path);
      saveFavorites(next);
      return next;
    });
  };

  return (
    <ErrorBoundary>
      <AppShell      navbar={{
        width: leftSidebarCollapsed ? 44 : 260,
        breakpoint: 0,
      }}
      aside={{
        width: rightSidebarCollapsed ? 44 : 220,
        breakpoint: 0,
      }}
      padding={0}
    >
      {/* Left sidebar — Favorites + Explorer */}
      <AppShell.Navbar
        p={0}
        style={{
          borderRight: "1px solid var(--app-border)",
          overflow: "hidden",
        }}
      >
        {/* Toggle */}
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={() => setLeftSidebarCollapsed((c) => !c)}
          style={{
            position: "absolute",
            top: 4,
            right: leftSidebarCollapsed ? 10 : 8,
            zIndex: 10,
            transition: "right 0.15s",
          }}
        >
          {leftSidebarCollapsed ? (
            <Tooltip label="Expand sidebar" position="right" withArrow>
              <IconLayoutSidebarLeftExpand size={16} />
            </Tooltip>
          ) : (
            <IconLayoutSidebarLeftCollapse size={16} />
          )}
        </ActionIcon>

        {!leftSidebarCollapsed && (
          <ScrollArea h="100%" type="auto" offsetScrollbars>
            {/* Favorites */}
            <Group px="xs" py="xs" justify="space-between">
              <Group gap={4}>
                <IconStar size={16} />
                <Text size="sm" fw={600}>Favorites</Text>
              </Group>
              <Tooltip label={isFavorite ? "Unpin current folder" : "Pin current folder"}>
                <ActionIcon size="sm" variant="subtle" onClick={toggleFavorite}>
                  {isFavorite ? (
                    <IconStarFilled size={14} style={{ color: "var(--mantine-color-yellow-5)" }} />
                  ) : (
                    <IconPlus size={14} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>

            {favorites.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" pb="xs">
                Click + to pin the current folder
              </Text>
            ) : (
              <Stack gap={0} px={4} pb="xs">
                {favorites.map((path) => (
                  <Group key={path} wrap="nowrap" justify="space-between" px={4}>
                    <UnstyledButton onClick={() => setActivePath(path)} style={{ flex: 1 }}>
                      <Group gap={4}>
                        <IconFolder size={14} />
                        <Text size="sm" truncate maw={140}>{favName(path)}</Text>
                      </Group>
                    </UnstyledButton>
                    <ActionIcon size="xs" variant="subtle" color="red" onClick={() => removeFavorite(path)}>
                      <IconX size={10} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}

            <Divider />

            {/* Explorer tree — collapsible */}
            <UnstyledButton
              onClick={() => setExplorerCollapsed((c) => !c)}
              px="xs" py="xs"
              style={{ width: "100%" }}
            >
              <Group gap={4} justify="space-between">
                <Group gap={4}>
                  <IconFolder size={16} />
                  <Text size="sm" fw={600}>Explorer</Text>
                </Group>
                <IconChevronRight
                  size={14}
                  style={{
                    transform: explorerCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                    transition: "transform 0.15s",
                  }}
                />
              </Group>
            </UnstyledButton>
            {!explorerCollapsed && (
              <DirectoryTree
                key={refreshKey}
                onDirectorySelect={handleNavigateWithTags}
                activePath={activePath}
              />
            )}
            <Divider />
            <DisksSection onNavigate={setActivePath} />
          </ScrollArea>
        )}
      </AppShell.Navbar>

      {/* Right sidebar — Tags */}
      <AppShell.Aside
        p={0}
        style={{
          borderLeft: "1px solid var(--app-border)",
          overflow: "hidden",
        }}
      >
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={() => setRightSidebarCollapsed((c) => !c)}
          style={{
            position: "absolute",
            top: 4,
            left: rightSidebarCollapsed ? 10 : 196,
            zIndex: 10,
            transition: "left 0.15s",
          }}
        >
          {rightSidebarCollapsed ? (
            <Tooltip label="Expand sidebar" position="left" withArrow>
              <IconLayoutSidebarRightExpand size={16} />
            </Tooltip>
          ) : (
            <IconLayoutSidebarRightCollapse size={16} />
          )}
        </ActionIcon>

        {!rightSidebarCollapsed && (
          <TagSidebar
            key={tagRefreshKey}
            selectedTagIds={selectedTagIds}
            onToggleTag={handleToggleTag}
            onTagsChanged={handleTagsChanged}
          />
        )}
      </AppShell.Aside>

      {/* Main content */}
      <AppShell.Main
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <FileList
          key={tagRefreshKey}
          directoryPath={activePath}
          onDirectoryOpen={handleNavigateWithTags}
          onRefreshRequest={handleRefreshRequest}
          selectedTagIds={tagsPaused ? new Set() : selectedTagIds}
          onToggleTag={handleToggleTag}
          onClearTags={handleClearTags}
          onTagsChanged={handleTagsChanged}
          tagsPaused={tagsPaused}
          onResumeTags={handleResumeTags}
          favorites={favorites}
          onToggleFavorite={toggleFavoritePath}
        />
      </AppShell.Main>
    </AppShell>
    </ErrorBoundary>
  );
}

export default App;
