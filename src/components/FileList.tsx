import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Table,
  Text,
  Group,
  Loader,
  Center,
  Box,
  Modal,
  TextInput,
  Button,
  Stack,
  UnstyledButton,
  Divider,
  Portal,
  Paper,
  Badge,
  ActionIcon,
  Tooltip,
  Combobox,
  useCombobox,
  InputBase,
  Checkbox,
  SegmentedControl,
  Popover,
  Card,
  Slider,
} from "@mantine/core";
import { useDisclosure, useClickOutside } from "@mantine/hooks";
import {
  IconFolder,
  IconFile,
  IconFileUnknown,
  IconPhoto,
  IconFileText,
  IconFileCode,
  IconFileZip,
  IconFileMusic,
  IconVideo,
  IconPencil,
  IconCopy,
  IconTrash,
  IconFolderPlus,
  IconTag,
  IconTagOff,
  IconX,
  IconPlus,
  IconScissors,
  IconClipboard,
  IconList,
  IconLayoutGrid,
  IconSettings,
  IconSortAscending,
  IconSortDescending,
  IconExternalLink,
  IconZip,
  IconArrowBack,
  IconArrowForward,
  IconSearch,
  IconFileDescription,
  IconTerminal2,
  IconInfoCircle,
  IconFilePencil,
  IconPalette,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import type { FileEntry, Tag as TagType, FileWithTags } from "../types";
import ImageViewer from "./ImageViewer";
import PropertyInspector from "./PropertyInspector";
import SettingsModal from "./SettingsModal";
import { useTheme } from "../theme/ThemeContext";

interface FileListProps {
  directoryPath: string;
  onDirectoryOpen: (path: string) => void;
  onRefreshRequest: () => void;
  selectedTagIds: Set<number>;
  onToggleTag: (tagId: number) => void;
  onClearTags: () => void;
  onTagsChanged: () => void;
  tagsPaused?: boolean;
  onResumeTags?: () => void;
  favorites: string[];
  onToggleFavorite: (path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getFileIcon(name: string, isDir: boolean): React.ReactNode {
  if (isDir) return <IconFolder size={18} />;
  const ext = name.split(".").pop()?.toLowerCase();
  const iconProps = { size: 18 };
  if (!ext) return <IconFile {...iconProps} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext))
    return <IconPhoto {...iconProps} />;
  if (["txt", "md", "pdf", "doc", "docx", "rtf"].includes(ext))
    return <IconFileText {...iconProps} />;
  if (["js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "xml", "yaml", "yml", "toml"].includes(ext))
    return <IconFileCode {...iconProps} />;
  if (["zip", "tar", "gz", "bz2", "xz", "7z", "rar"].includes(ext))
    return <IconFileZip {...iconProps} />;
  if (["mp3", "wav", "flac", "ogg", "aac"].includes(ext))
    return <IconFileMusic {...iconProps} />;
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext))
    return <IconVideo {...iconProps} />;
  return <IconFileUnknown {...iconProps} />;
}

// FileIcon component: shows Tabler icon first, then loads system icon asynchronously
const iconCache = new Map<string, string>(); // path -> base64 data URI

function FileIcon({ path, name, isDir, size = 18 }: { path: string; name: string; isDir: boolean; size?: number }) {
  const sysIcon = iconCache.get(path);
  if (sysIcon) {
    return <img src={sysIcon} alt="" style={{ width: size, height: size }} />;
  }
  return <>{getFileIcon(name, isDir)}</>;
}

// --- Inline TagComboBox component ---

function TagComboBox({
  allTags,
  inputValue,
  onInputChange,
  onSubmit,
}: {
  allTags: TagType[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const filteredTags = allTags.filter((t) =>
    t.name.toLowerCase().includes(inputValue.toLowerCase().trim()),
  );

  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === inputValue.toLowerCase().trim(),
  );

  const options = filteredTags.map((t) => (
    <Combobox.Option value={t.name} key={t.id}>
      <Group gap="xs">
        <Badge size="xs" color={t.color} circle />
        <Text size="sm">{t.name}</Text>
      </Group>
    </Combobox.Option>
  ));

  // Show "Create" option when input is non-empty and no exact match
  if (inputValue.trim() && !exactMatch) {
    options.push(
      <Combobox.Option value={`__create__${inputValue.trim()}`} key="__create__">
        <Group gap="xs">
          <IconPlus size={14} color="var(--mantine-primary-color-6)" />
          <Text size="sm" c="var(--mantine-primary-color-6)">
            Create &quot;{inputValue.trim()}&quot;
          </Text>
        </Group>
      </Combobox.Option>,
    );
  }

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        if (val.startsWith("__create__")) {
          onInputChange(val.replace("__create__", ""));
        } else {
          onInputChange(val);
        }
        combobox.closeDropdown();
        // Auto-submit on selection
        setTimeout(onSubmit, 50);
      }}
    >
      <Combobox.Target>
        <InputBase
          component="input"
          type="text"
          placeholder="Type tag name or select..."
          value={inputValue}
          onChange={(e) => {
            onInputChange(e.currentTarget.value);
            combobox.openDropdown();
          }}
          onClick={() => combobox.openDropdown()}
          onFocus={() => combobox.openDropdown()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              combobox.closeDropdown();
              onSubmit();
            }
          }}
          rightSection={<Combobox.Chevron />}
          autoFocus
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          {options.length === 0 && inputValue.trim() ? (
            <Combobox.Option value={`__create__${inputValue.trim()}`}>
              <Group gap="xs">
                <IconPlus size={14} color="var(--mantine-primary-color-6)" />
                <Text size="sm" c="var(--mantine-primary-color-6)">
                  Create &quot;{inputValue.trim()}&quot;
                </Text>
              </Group>
            </Combobox.Option>
          ) : options.length === 0 ? (
            <Combobox.Empty>Start typing to create a tag</Combobox.Empty>
          ) : (
            options
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

// ---------------------------------------------------------------------------
// LRU thumbnail cache with automatic eviction
// ---------------------------------------------------------------------------
const MAX_THUMBNAIL_CACHE = 300;
const thumbnailCacheRef = new Map<string, string>();

function addThumbnails(entries: [string, string][]): boolean {
  let changed = false;
  for (const [path, url] of entries) {
    if (!url || thumbnailCacheRef.has(path)) continue;
    thumbnailCacheRef.delete(path);
    thumbnailCacheRef.set(path, url);
    changed = true;
  }
  // Evict oldest if over limit
  while (thumbnailCacheRef.size > MAX_THUMBNAIL_CACHE) {
    const key = thumbnailCacheRef.keys().next().value;
    if (key === undefined) break;
    thumbnailCacheRef.delete(key);
    changed = true;
  }
  return changed;
}

function clearThumbnailCache() {
  thumbnailCacheRef.clear();
}

// ---------------------------------------------------------------------------
// Memoized GridCard — only re-renders when its specific props change
// ---------------------------------------------------------------------------
const CARD_HEIGHT = 150; // 100px image + 50px text/gap
const CARD_GAP = 8; // matches Mantine xs spacing

const GridCard = React.memo(function GridCard({
  entry,
  tags,
  isSelected,
  showThumb,
  thumbUrl,
  onDoubleClick,
  onContextMenu,
  onClick,
}: {
  entry: FileEntry;
  tags: TagType[];
  isSelected: boolean;
  showThumb: boolean;
  thumbUrl: string | undefined;
  onDoubleClick: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onClick: (path: string) => void;
}) {
  return (
    <Card
      padding="xs"
      radius="sm"
      onDoubleClick={() => onDoubleClick(entry)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onClick={() => onClick(entry.path)}
      style={{
        cursor: "default",
        border: isSelected
          ? "2px solid var(--mantine-primary-color-6)"
          : "1px solid var(--app-border)",
        height: "100%",
      }}
    >
      <Card.Section>
        {thumbUrl ? (
          <Box h={100} style={{ overflow: "hidden" }}>
            <img
              src={thumbUrl}
              alt={entry.name}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </Box>
        ) : (
          <Center h={100}>
            {showThumb ? (
              <Loader size="xs" />
            ) : (
              <FileIcon path={entry.path} name={entry.name} isDir={entry.is_dir} size={48} />
            )}
          </Center>
        )}
      </Card.Section>
      <Stack gap={2} mt="xs">
        <Text size="xs" truncate ta="center">
          {entry.name}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {entry.is_dir ? "Folder" : formatSize(entry.size)}
        </Text>
        {tags.length > 0 && (
          <Group gap={2} justify="center" wrap="wrap">
            {tags.map((t) => (
              <Badge key={t.id} size="xs" color={t.color} variant="light">
                {t.name}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
});

export default function FileList({
  directoryPath,
  onDirectoryOpen,
  onRefreshRequest,
  selectedTagIds,
  onClearTags,
  onTagsChanged,
  tagsPaused,
  onResumeTags,
  favorites,
  onToggleFavorite,
}: FileListProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [fileTags, setFileTags] = useState<Map<string, TagType[]>>(new Map());
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Rename modal
  const [renameOpened, { open: openRename, close: closeRename }] = useDisclosure(false);
  const [newName, setNewName] = useState("");

  // New folder modal
  const [newFolderOpened, { open: openNewFolder, close: closeNewFolder }] = useDisclosure(false);
  const [folderName, setFolderName] = useState("");

  // Tag assignment modal
  const [tagModalOpened, { open: openTagModal, close: closeTagModal }] = useDisclosure(false);
  const [tagTargetPath, setTagTargetPath] = useState<string>("");
  const [tagInputValue, setTagInputValue] = useState("");

  // Create file modal
  const [createFileOpened, { open: openCreateFile, close: closeCreateFile }] = useDisclosure(false);
  const [createFileName, setCreateFileName] = useState("");
  const [createFileIsText, setCreateFileIsText] = useState(false);

  // Properties modal
  const [propertiesPath, setPropertiesPath] = useState("");
  const [propertiesOpened, { open: openProperties, close: closeProperties }] = useDisclosure(false);

  // Settings modal
  const [settingsOpened, setSettingsOpened] = useState(false);
  const { config, updateConfig } = useTheme();

  const ctxMenuRef = useClickOutside(() => setCtxMenu(null));
  const bgCtxMenuRef = useClickOutside(() => setBgCtxMenu(null));

  // Clipboard for copy/move operations
  const [clipboard, setClipboard] = useState<{
    operation: "copy" | "move";
    source: string;
    sourceName: string;
  } | null>(null);

  // Tag assignment state
  const [inheritToContents, setInheritToContents] = useState(false);

  // View preferences
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem("fte-view-mode") as "list" | "grid") || "grid"; } catch { return "grid"; }
  });
  const [showThumbnails, setShowThumbnails] = useState(() => {
    try { return localStorage.getItem("fte-show-thumbnails") === "true"; } catch { return false; }
  });
  const [fileSize, setFileSize] = useState(() => {
    try { return parseInt(localStorage.getItem("fte-file-size") || "100", 10); } catch { return 100; }
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Navigation history
  const navHistory = useRef<string[]>([]);
  const navFuture = useRef<string[]>([]);
  const navLock = useRef(false);

  // Track directory changes for history
  useEffect(() => {
    if (navLock.current) { navLock.current = false; return; }
    navFuture.current = [];
    const prev = navHistory.current[navHistory.current.length - 1];
    if (prev !== directoryPath) {
      navHistory.current.push(directoryPath);
    }
  }, [directoryPath]);

  const goBack = useCallback(() => {
    if (navHistory.current.length < 2) return;
    const current = navHistory.current.pop()!;
    navFuture.current.push(current);
    const prev = navHistory.current[navHistory.current.length - 1];
    navLock.current = true;
    onDirectoryOpen(prev);
  }, [onDirectoryOpen]);

  const goForward = useCallback(() => {
    const next = navFuture.current.pop();
    if (!next) return;
    navLock.current = true;
    onDirectoryOpen(next);
  }, [onDirectoryOpen]);

  const isImageFile = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);
  };

  // Sort preferences
  const [sortField, setSortField] = useState<"name" | "size" | "modified">("name");
  const [sortAsc, setSortAsc] = useState(true);

  const getSortedEntries = useCallback((entries: FileEntry[]): FileEntry[] => {
    return [...entries].sort((a, b) => {
      // Dirs first
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "modified":
          cmp = a.modified.localeCompare(b.modified);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [sortField, sortAsc]);

  // Compute sorted display entries (used by virtual grid, list view, and image viewer)
  const displayEntries = getSortedEntries(searchResults !== null ? searchResults : entries);

  // --- Virtual Grid State ---
  const [virtualState, setVirtualState] = useState({
    firstVisible: 0,
    lastVisible: 0,
    columns: 1,
    totalRows: 0,
    cardWidth: 120,
  });
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const gridInnerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number>(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Compute card width from fileSize slider
  const computeCardWidth = useCallback((sizePct: number): number => {
    const baseWidth = Math.max(80, 120 * sizePct / 100);
    return baseWidth < 150 ? baseWidth : 150; // cap at 150px to keep reasonable grid density
  }, []);

  // Update visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    const container = gridContainerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const cwCard = computeCardWidth(fileSize);
    const cols = Math.max(1, Math.floor(cw / (cwCard + CARD_GAP)));
    const scrollTop = container.scrollTop;
    const vh = container.clientHeight;
    const totalRows = Math.max(1, Math.ceil(displayEntries.length / cols));

    const overscan = 1; // extra row above and below
    const firstRow = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - overscan);
    const lastRow = Math.min(totalRows, Math.ceil((scrollTop + vh) / CARD_HEIGHT) + overscan);
    const firstIdx = Math.max(0, firstRow * cols);
    const lastIdx = Math.min(displayEntries.length, lastRow * cols);

    setVirtualState((prev) => {
      if (
        prev.firstVisible === firstIdx &&
        prev.lastVisible === lastIdx &&
        prev.columns === cols &&
        prev.totalRows === totalRows &&
        prev.cardWidth === cwCard
      ) {
        return prev;
      }
      return { firstVisible: firstIdx, lastVisible: lastIdx, columns: cols, totalRows, cardWidth: cwCard };
    });
  }, [displayEntries.length, fileSize, computeCardWidth]);

  // Scroll handler
  const handleVirtualScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      updateVisibleRange();
    });
  }, [updateVisibleRange]);

  // --- Viewport-aware lazy thumbnail loading (ref-based LRU cache) ---
  const thumbQueue = useRef<string[]>([]);
  const thumbInflight = useRef(0);
  const MAX_INFLIGHT = 3;

  const [thumbnailVersion, setThumbnailVersion] = useState(0);

  const processThumbQueue = useCallback(() => {
    while (thumbInflight.current < MAX_INFLIGHT && thumbQueue.current.length > 0) {
      const batch = thumbQueue.current.splice(0, MAX_INFLIGHT - thumbInflight.current);
      if (batch.length === 0) break;
      thumbInflight.current += batch.length;
      invoke<[string, string][]>("get_system_thumbnails", { paths: batch })
        .then((results) => {
          if (results.length > 0 && addThumbnails(results)) {
            setThumbnailVersion((v) => v + 1);
          }
        })
        .catch(() => {})
        .finally(() => {
          thumbInflight.current -= batch.length;
          processThumbQueue();
        });
    }
  }, []);

  const enqueueThumbnail = useCallback((path: string) => {
    if (thumbnailCacheRef.has(path)) return;
    if (thumbQueue.current.includes(path)) return;
    thumbQueue.current.push(path);
    processThumbQueue();
  }, [processThumbQueue]);

  const displayEntriesRef = useRef(displayEntries);
  displayEntriesRef.current = displayEntries;

  // Enqueue thumbnails for currently visible entries
  const enqueueVisibleThumbnails = useCallback(() => {
    if (!showThumbnails) return;
    const entries = displayEntriesRef.current;
    for (let i = virtualState.firstVisible; i < virtualState.lastVisible; i++) {
      const entry = entries[i];
      if (!entry || entry.is_dir || !isImageFile(entry.name)) continue;
      enqueueThumbnail(entry.path);
    }
  }, [showThumbnails, virtualState.firstVisible, virtualState.lastVisible, enqueueThumbnail]);

  // Recompute visible range on scroll, resize, or data change
  useEffect(() => {
    updateVisibleRange();
  }, [updateVisibleRange]);

  // React to virtual range changes to enqueue thumbnails + update inner container height
  useEffect(() => {
    enqueueVisibleThumbnails();
    const inner = gridInnerRef.current;
    if (inner) {
      inner.style.height = `${virtualState.totalRows * CARD_HEIGHT}px`;
    }
  }, [virtualState, enqueueVisibleThumbnails]);

  // Set up scroll listener + ResizeObserver on grid container
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleVirtualScroll, { passive: true });
    resizeObserverRef.current = new ResizeObserver(() => {
      updateVisibleRange();
    });
    resizeObserverRef.current.observe(container);

    return () => {
      container.removeEventListener("scroll", handleVirtualScroll);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
    };
  }, [handleVirtualScroll, updateVisibleRange]);

  // Image viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Icon loading — version counter to trigger re-render when batch resolves
  const [iconLoadKey, setIconLoadKey] = useState(0);

  // Clear selectedPath when directory changes
  useEffect(() => {
    setSelectedPath(null);
  }, [directoryPath]);

  // Preload system icons for visible files in a single batch call
  useEffect(() => {
    if (entries.length === 0) return;
    const paths = entries.filter((e) => !e.is_dir).map((e) => e.path);
    invoke<[string, string][]>("get_system_icons", { paths })
      .then((results) => {
        for (const [path, url] of results) {
          if (url) iconCache.set(path, url);
        }
        setIconLoadKey((k) => k + 1);
      })
      .catch(() => {});
  }, [entries]);

  const loadAllTags = useCallback(async () => {
    try {
      const tags = await invoke<TagType[]>("get_all_tags");
      setAllTags(tags);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAllTags();
  }, [loadAllTags]);

  const loadTagsBatch = useCallback(async (paths: string[]) => {
    const map = new Map<string, TagType[]>();
    if (paths.length === 0) return map;
    try {
      const result = await invoke<Record<string, TagType[]>>("get_tags_for_files", {
        paths,
      });
      for (const [p, tags] of Object.entries(result)) {
        if (tags.length > 0) map.set(p, tags);
      }
    } catch {
      // fallback: skip silently
    }
    return map;
  }, []);

  const loadDirectory = useCallback(
    async (path: string, tagIds: Set<number>) => {
      clearThumbnailCache();
      setLoading(true);
      setError(null);
      try {
        if (tagIds.size > 0) {
          // Tag-filtered mode with pagination
          const tagLimit = 200;
          const result = await invoke<FileWithTags[]>("get_files_by_tags", {
            tagIds: Array.from(tagIds),
            maxResults: tagLimit,
          });
          const files: FileEntry[] = [];
          const tagMap = new Map<string, TagType[]>();
          for (const fwt of result) {
            files.push({
              name: fwt.file.name,
              path: fwt.file.path,
              is_dir: fwt.file.is_dir,
              size: 0,
              modified: "",
              is_executable: false,
            });
            tagMap.set(fwt.file.path, fwt.tags);
          }
          setEntries(files);
          setFileTags(tagMap);
        } else {
          // Normal directory listing — load all files at once (no pagination)
          const result = await invoke<FileEntry[]>("read_directory", {
            dirPath: path,
          });
          setEntries(result);
          // Load tags for visible files (batch)
          let tagMap = new Map<string, TagType[]>();
          if (allTags.length > 0) {
            const paths = result.map((e) => e.path);
            tagMap = await loadTagsBatch(paths);
          }
          setFileTags(tagMap);
        }
      } catch (err) {
        setError(String(err));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [loadTagsBatch],
  );

  useEffect(() => {
    loadDirectory(directoryPath, selectedTagIds);
  }, [directoryPath, selectedTagIds, loadDirectory]);

  const refresh = useCallback(() => {
    loadDirectory(directoryPath, selectedTagIds);
    onRefreshRequest();
  }, [directoryPath, selectedTagIds, loadDirectory, onRefreshRequest]);

  const handleRowDoubleClick = (entry: FileEntry) => {
    if (entry.is_dir) {
      onDirectoryOpen(entry.path);
    } else if (isArchiveFile(entry.name)) {
      invoke("open_file", { path: entry.path }).catch((err) => {
        setError(`Cannot open: ${err}`);
      });
    } else {
      const isImg = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(entry.name);
      if (isImg) {
        const allImages = displayEntries
          .filter((e) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(e.name) && !e.is_dir)
          .map((e) => e.path);
        const idx = allImages.indexOf(entry.path);
        setViewerImages(allImages);
        setViewerIndex(idx >= 0 ? idx : 0);
        setViewerOpen(true);
      } else if (entry.is_executable) {
        invoke("run_executable", { path: entry.path }).catch((err) => {
          setError(`Cannot run: ${err}`);
        });
      } else {
        invoke("open_file", { path: entry.path }).catch((err) => {
          setError(`Cannot open: ${err}`);
        });
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent bgCtxMenu from also firing
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 400);
    setCtxMenu({ x, y, entry });
  };

  const handleBgContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    // Don't show bg context menu if right-clicking on a file/folder row (list) or card (grid)
    if (target.closest("tr") || target.closest("[role='article']")) return;
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    setBgCtxMenu({ x, y });
  };

  // --- Search ---
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const results = await invoke<FileEntry[]>("search_files", {
        query: q,
        rootPath: directoryPath,
      });
      setSearchResults(results);
    } catch (err) {
      setError(String(err));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, directoryPath]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      } else {
        setSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      // Ctrl+F / Cmd+F: focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Ctrl+C: copy to clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && ctxMenu?.entry) {
        e.preventDefault();
        handleCopyToClipboard(ctxMenu.entry);
        return;
      }
      // Ctrl+X: cut to clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === "x" && ctxMenu?.entry) {
        e.preventDefault();
        handleCutToClipboard(ctxMenu.entry);
        return;
      }
      // Ctrl+V: paste
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) {
        e.preventDefault();
        handlePaste();
        return;
      }
      // F2: rename selected entry
      if (e.key === "F2" && ctxMenu?.entry) {
        e.preventDefault();
        setNewName(ctxMenu.entry.name);
        openRename();
        return;
      }
      // Delete: delete selected entry
      if (e.key === "Delete" && ctxMenu?.entry) {
        e.preventDefault();
        handleDelete(ctxMenu.entry);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [ctxMenu, clipboard]);

  const handleGoUp = () => {
    const parent = directoryPath.split("/").slice(0, -1).join("/") || "/";
    onDirectoryOpen(parent);
  };

  // --- Actions ---

  const handleRename = async () => {
    const entry = ctxMenu?.entry;
    if (!entry || !newName.trim()) return;
    try {
      await invoke("rename_file", { path: entry.path, newName: newName.trim() });
      closeRename();
      setCtxMenu(null);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    const confirmed = window.confirm(`Delete "${entry.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await invoke("delete_file", { path: entry.path });
      setCtxMenu(null);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCopyPath = (entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
    setCtxMenu(null);
  };

  const handleCopyToClipboard = (entry: FileEntry) => {
    setClipboard({ operation: "copy", source: entry.path, sourceName: entry.name });
    setCtxMenu(null);
  };

  const handleCutToClipboard = (entry: FileEntry) => {
    setClipboard({ operation: "move", source: entry.path, sourceName: entry.name });
    setCtxMenu(null);
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    const destPath = directoryPath + "/" + clipboard.sourceName;
    try {
      if (clipboard.operation === "copy") {
        await invoke("copy_file", { src: clipboard.source, dst: destPath });
      } else {
        await invoke("move_file", { src: clipboard.source, dst: destPath });
      }
      setClipboard(null);
      setBgCtxMenu(null);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const isArchiveFile = (name: string) => /\.(zip|7z|rar|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i.test(name);

  const handleExtractArchive = async (path: string, mode: string) => {
    try {
      // mode handles extraction destination — the Rust command creates the dir
      await invoke<string>("extract_archive", { path, destDir: directoryPath, mode });
      setError(null);
      // Navigate into the extracted folder by guessing its path
      const baseName = path.split("/").pop()?.replace(/\.(zip|7z|rar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar)$/i, "") || "extracted";
      if (mode === "named" || mode === "here") {
        onDirectoryOpen(directoryPath.replace(/\/+$/, "") + "/" + baseName);
      } else {
        onDirectoryOpen(mode);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    try {
      await invoke("create_folder", { parent: directoryPath, name: folderName.trim() });
      closeNewFolder();
      setFolderName("");
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCreateFile = async () => {
    const name = createFileName.trim();
    if (!name) return;
    const fullName = createFileIsText && !name.includes(".") ? `${name}.txt` : name;
    const fullPath = directoryPath.replace(/\/+$/, "") + "/" + fullName;
    try {
      await invoke("create_file", { path: fullPath });
      closeCreateFile();
      setCreateFileName("");
      setCreateFileIsText(false);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenInTerminal = () => {
    setBgCtxMenu(null);
    invoke("open_terminal", { path: directoryPath }).catch((err) => {
      setError(String(err));
    });
  };


  const handleAddTag = async () => {
    if (!tagTargetPath || !tagInputValue.trim()) return;

    // Check if input matches an existing tag
    const existingTag = allTags.find(
      (t) => t.name.toLowerCase() === tagInputValue.trim().toLowerCase(),
    );

    try {
      let tagId: number;

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        // Create new tag on-the-fly
        const newTag = await invoke<TagType>("create_tag", {
          name: tagInputValue.trim(),
          color: "#228be6",
        });
        tagId = newTag.id;
        // Reload all tags and notify sidebar
        await loadAllTags();
        onTagsChanged();
      }

      const tagTargetIsDir = entries.find(
        (e) => e.path === tagTargetPath,
      )?.is_dir;

      if (tagTargetIsDir && inheritToContents) {
        await invoke("add_tag_to_folder_recursive", {
          folderPath: tagTargetPath,
          tagId,
        });
      } else {
        await invoke("add_tag_to_file", { filePath: tagTargetPath, tagId });
      }

      closeTagModal();
      setCtxMenu(null);
      setTagInputValue("");
      setTagTargetPath("");
      setInheritToContents(false);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRemoveTag = async (filePath: string, tagId: number) => {
    try {
      await invoke("remove_tag_from_file", { filePath, tagId });
      refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  // --- Render ---

  const parentRow =
    directoryPath !== "/" && selectedTagIds.size === 0 ? (
      <Table.Tr
        key=".."
        onDoubleClick={handleGoUp}
        onClick={() => setSelectedPath(null)}
        style={{ cursor: "pointer" }}
      >
        <Table.Td>
          <Group gap="xs">
            <IconFolder size={18} />
            <Text size="sm" fs="italic" c="dimmed">..</Text>
          </Group>
        </Table.Td>
        <Table.Td w={90}></Table.Td>
        <Table.Td w={150}></Table.Td>
      </Table.Tr>
    ) : null;

  const rows = displayEntries.map((entry) => {
    const tags = fileTags.get(entry.path) || [];
    return (
      <Table.Tr
        key={entry.path}
        onDoubleClick={() => handleRowDoubleClick(entry)}
        onContextMenu={(e) => handleContextMenu(e, entry)}
        onClick={() => setSelectedPath(entry.path)}
        style={{ cursor: "default", background: selectedPath === entry.path ? "var(--app-hover)" : undefined }}
      >
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <FileIcon path={entry.path} name={entry.name} isDir={entry.is_dir} />
            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>{entry.name}</Text>
            {tags.map((t) => (
              <Badge
                key={t.id}
                size="xs"
                color={t.color}
                variant="light"
                rightSection={
                  <IconX
                    size={10}
                    style={{ cursor: "pointer" }}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      handleRemoveTag(entry.path, t.id);
                    }}
                  />
                }
              >
                {t.name}
              </Badge>
            ))}
          </Group>
        </Table.Td>
        <Table.Td w={90}>
          <Text size="sm" c="dimmed">
            {entry.is_dir ? "Folder" : formatSize(entry.size)}
          </Text>
        </Table.Td>
        <Table.Td w={150}>
          <Text size="sm" c="dimmed">{entry.modified}</Text>
        </Table.Td>
      </Table.Tr>
    );
  });

  // Virtual grid: only render visible cards, position them absolutely
  // thumbnailVersion in scope ensures re-render when new thumbnails arrive
  void thumbnailVersion;
  const gridItems = (() => {
    const { firstVisible, lastVisible, columns, cardWidth } = virtualState;
    const items: React.ReactNode[] = [];
    for (let i = firstVisible; i < lastVisible; i++) {
      const entry = displayEntries[i];
      if (!entry) continue;
      const tags = fileTags.get(entry.path) || [];
      const showThumb = showThumbnails && !entry.is_dir && isImageFile(entry.name);
      const thumbUrl = showThumb ? thumbnailCacheRef.get(entry.path) : undefined;
      const rowIdx = Math.floor(i / columns);
      const colIdx = i % columns;
      items.push(
        <Box
          key={entry.path}
          style={{
            position: "absolute",
            top: rowIdx * CARD_HEIGHT,
            left: colIdx * (cardWidth + CARD_GAP),
            width: cardWidth,
            height: CARD_HEIGHT - CARD_GAP,
          }}
        >
          <GridCard
            entry={entry}
            tags={tags}
            isSelected={selectedPath === entry.path}
            showThumb={showThumb}
            thumbUrl={thumbUrl}
            onDoubleClick={handleRowDoubleClick}
            onContextMenu={handleContextMenu}
            onClick={setSelectedPath}
          />
        </Box>
      );
    }
    return items;
  })();

  return (
    <>
      <Box h="100%" style={{ display: "flex", flexDirection: "column" }}>
        {/* Header bar */}
        <Box px="xs" py={4}>
          <Group gap="xs" mb={4}>
            <Tooltip label="Back">
              <ActionIcon variant="subtle" onClick={goBack} disabled={navHistory.current.length < 2}>
                <IconArrowBack size={20} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Forward">
              <ActionIcon variant="subtle" onClick={goForward} disabled={navFuture.current.length === 0}>
                <IconArrowForward size={20} />
              </ActionIcon>
            </Tooltip>
            {searchMode ? (
              <TextInput
                ref={searchInputRef}
                size="xs"
                placeholder="Search files and contents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setSearchMode(false); setSearchQuery(""); setSearchResults(null); } }}
                rightSection={
                  <ActionIcon size="xs" variant="subtle" onClick={() => { setSearchMode(false); setSearchQuery(""); setSearchResults(null); }}>
                    <IconX size={14} />
                  </ActionIcon>
                }
                leftSection={<IconSearch size={14} />}
                autoFocus
                style={{ flex: 1 }}
              />
            ) : (
              <TextInput
                size="xs"
                placeholder="/path/to/directory"
                defaultValue={directoryPath}
                key={directoryPath}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value.trim(); if (v.startsWith("/")) onDirectoryOpen(v); e.currentTarget.blur(); } }}
                rightSection={
                  <ActionIcon size="sm" variant="subtle" onClick={() => setSearchMode(true)}>
                    <IconSearch size={16} />
                  </ActionIcon>
                }
                style={{ flex: 1 }}
              />
            )}
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={(v) => { setViewMode(v as "list" | "grid"); try { localStorage.setItem("fte-view-mode", v); } catch {} }}
              data={[
                { value: "list", label: <IconList size={14} /> },
                { value: "grid", label: <IconLayoutGrid size={14} /> },
              ]}
            />
            <Popover width={200} position="bottom-end" shadow="md">
              <Popover.Target>
                <ActionIcon size="sm" variant="subtle">
                  <IconSettings size={16} />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <Text size="xs" fw={600}>Thumbnails</Text>
                  <Checkbox
                    size="xs"
                    label="Show thumbnails"
                    checked={showThumbnails}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setShowThumbnails(v);
                      try { localStorage.setItem("fte-show-thumbnails", String(v)); } catch {}
                    }}
                  />
                  <Divider />
                  <Text size="xs" fw={600}>Icon size</Text>
                  <Slider
                    size="xs"
                    min={50} max={200} step={10}
                    value={fileSize}
                    onChange={(v) => { setFileSize(v); try { localStorage.setItem("fte-file-size", String(v)); } catch {} }}
                    marks={[
                      { value: 50, label: "50%" },
                      { value: 100, label: "100%" },
                      { value: 150, label: "150%" },
                      { value: 200, label: "200%" },
                    ]}
                  />
                  <Divider />
                  <Text size="xs" fw={600}>Sort by</Text>
                  <Group gap={4} wrap="nowrap">
                    {(["name", "size", "modified"] as const).map((field) => (
                      <Button
                        key={field}
                        size="compact-xs"
                        variant={sortField === field ? "light" : "subtle"}
                        onClick={() => {
                          if (sortField === field) setSortAsc((a) => !a);
                          else { setSortField(field); setSortAsc(field === "name" ? true : false); }
                        }}
                        rightSection={sortField === field ? (sortAsc ? <IconSortAscending size={12} /> : <IconSortDescending size={12} />) : undefined}
                      >
                        {field === "modified" ? "Date" : field.charAt(0).toUpperCase() + field.slice(1)}
                      </Button>
                      ))}
                      </Group>
                      <Divider />
                      <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={<IconPalette size={14} />}
                      fullWidth
                      onClick={() => setSettingsOpened(true)}
                      >
                      Theme
                      </Button>
                      </Stack>              </Popover.Dropdown>
            </Popover>
            {selectedTagIds.size === 0 && searchResults === null && (
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconFolderPlus size={14} />}
                onClick={() => { setFolderName(""); openNewFolder(); }}
              >
                New
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {tagsPaused && (
              <Badge size="xs" color="yellow" variant="light" mr="xs">
                Tags paused —
                <UnstyledButton
                  onClick={onResumeTags}
                  style={{ textDecoration: "underline", cursor: "pointer", marginLeft: 4 }}
                >
                  Resume
                </UnstyledButton>
              </Badge>
            )}
            {clipboard && (
              <Badge size="xs" variant="light" mr="xs">
                {clipboard.operation === "copy" ? "📋" : "✂"} {clipboard.sourceName} — right-click to paste
              </Badge>
            )}
            {searchResults !== null
              ? `Search: "${searchQuery}" — ${searchResults.length} result(s)`
              : selectedTagIds.size > 0
                ? `Filtered by ${selectedTagIds.size} tag(s)`
                : ""}
            {selectedTagIds.size > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                ml="xs"
                onClick={onClearTags}
              >
                Clear filter
              </Button>
            )}
          </Text>
        </Box>

        <Box data-icon-version={iconLoadKey} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }} onContextMenu={handleBgContextMenu}>
          {loading ? (
            <Center h="100%"><Loader size="md" /></Center>
          ) : error ? (
            <Center h="100%">
              <Stack align="center" gap="sm">
                <Text c="red" size="sm">{error}</Text>
                <Button size="xs" variant="light" onClick={refresh}>Retry</Button>
              </Stack>
            </Center>
          ) : viewMode === "list" ? (
            <Box style={{ flex: 1, overflow: "auto" }}>
            <Table highlightOnHover stickyHeader style={{ border: "1px solid var(--app-border)", borderRadius: "var(--mantine-radius-sm)" }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th w={90}>Size</Table.Th>
                  <Table.Th w={150}>Modified</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {parentRow}
                {rows}
                {displayEntries.length === 0 && !loading && !searching && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>
                      <Text size="sm" c="dimmed" ta="center" py="lg">
                        {searchResults !== null
                          ? `No files matching "${searchQuery}" found.`
                          : selectedTagIds.size > 0
                            ? "No tagged files match the selected tags."
                            : "This folder is empty."}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
            </Box>
          ) : (
            <Box
              ref={gridContainerRef}
              style={{
                flex: 1, overflow: "auto",
                padding: "var(--mantine-spacing-xs)",
                position: "relative",
              }}
              onContextMenu={undefined}
            >
              <Box ref={gridInnerRef} style={{ position: "relative", minHeight: "100%" }}>
                {gridItems}
              </Box>
              {displayEntries.length === 0 && !loading && !searching && (
                <Text size="sm" c="dimmed" ta="center" py="lg">
                  {searchResults !== null
                    ? `No files matching "${searchQuery}" found.`
                    : selectedTagIds.size > 0
                      ? "No tagged files match the selected tags."
                      : "This folder is empty."}
                </Text>
              )}
            </Box>
          )}

        </Box>
      </Box>

      {/* Context menu for files */}
      {ctxMenu && (
        <Portal>
          <Box
            ref={ctxMenuRef}
            style={{
              position: "fixed",
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1000,
            }}
          >
            <Paper shadow="md" p={4} w={200} withBorder>
              <Stack gap={2}>
                {/* Open */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    if (ctxMenu.entry.is_dir) {
                      onDirectoryOpen(ctxMenu.entry.path);
                    } else if (isArchiveFile(ctxMenu.entry.name)) {
                      handleExtractArchive(ctxMenu.entry.path, "named");
                    } else {
                      const isImg = /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(ctxMenu.entry.name);
                      if (isImg) {
                        const allImages = displayEntries
                          .filter((e) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(e.name) && !e.is_dir)
                          .map((e) => e.path);
                        const idx = allImages.indexOf(ctxMenu.entry.path);
                        setViewerImages(allImages);
                        setViewerIndex(idx >= 0 ? idx : 0);
                        setViewerOpen(true);
                      } else if (ctxMenu.entry.is_executable) {
                        invoke("run_executable", { path: ctxMenu.entry.path }).catch(() => {});
                      } else {
                        invoke("open_file", { path: ctxMenu.entry.path }).catch(() => {});
                      }
                    }
                    setCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    {ctxMenu.entry.is_dir ? (
                      <IconFolder size={14} />
                    ) : (
                      <FileIcon path={ctxMenu.entry.path} name={ctxMenu.entry.name} isDir={false} size={14} />
                    )}
                    <Text size="sm">Open</Text>
                  </Group>
                </UnstyledButton>
                {/* Edit in text editor */}
                {!ctxMenu.entry.is_dir &&
                  !/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(ctxMenu.entry.name) &&
                  !isArchiveFile(ctxMenu.entry.name) && (
                  <UnstyledButton
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                    onClick={() => {
                      invoke("open_in_editor", { path: ctxMenu.entry.path }).catch(() => {});
                      setCtxMenu(null);
                    }}
                  >
                    <Group gap="xs">
                      <IconFilePencil size={14} />
                      <Text size="sm">Edit in text editor</Text>
                    </Group>
                  </UnstyledButton>
                )}
                {/* Run in terminal */}
                {!ctxMenu.entry.is_dir && ctxMenu.entry.is_executable && (
                  <UnstyledButton
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                    onClick={() => {
                      invoke("run_executable", { path: ctxMenu.entry.path }).catch(() => {});
                      setCtxMenu(null);
                    }}
                  >
                    <Group gap="xs">
                      <IconTerminal2 size={14} />
                      <Text size="sm">Run in terminal</Text>
                    </Group>
                  </UnstyledButton>
                )}
                {/* Open with default app (images) */}
                {!ctxMenu.entry.is_dir && /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(ctxMenu.entry.name) && (
                  <UnstyledButton
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                    onClick={() => {
                      invoke("open_file", { path: ctxMenu.entry.path }).catch(() => {});
                      setCtxMenu(null);
                    }}
                  >
                    <Group gap="xs">
                      <IconExternalLink size={14} />
                      <Text size="sm">Open with default app</Text>
                    </Group>
                  </UnstyledButton>
                  )}
                  <Divider />
                  {/* Extract archive options */}
                  {!ctxMenu.entry.is_dir && isArchiveFile(ctxMenu.entry.name) && (
                  <UnstyledButton p="xs" style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => { handleExtractArchive(ctxMenu.entry.path, "here"); setCtxMenu(null); }}>
                  <Group gap="xs"><IconZip size={14} /><Text size="sm">Extract here</Text></Group>
                  </UnstyledButton>
                  )}
                  {!ctxMenu.entry.is_dir && isArchiveFile(ctxMenu.entry.name) && (
                  <UnstyledButton p="xs" style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => { handleExtractArchive(ctxMenu.entry.path, "named"); setCtxMenu(null); }}>
                  <Group gap="xs"><IconZip size={14} /><Text size="sm">Extract to /{ctxMenu.entry.name.replace(/\.(zip|7z|rar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar)$/i, "")}/</Text></Group>
                  </UnstyledButton>
                  )}
                  {!ctxMenu.entry.is_dir && isArchiveFile(ctxMenu.entry.name) && (
                  <UnstyledButton p="xs" style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={async () => {
                    const dest = window.prompt("Extract to path:", directoryPath + "/" + ctxMenu.entry.name.replace(/\.(zip|7z|rar|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz)$/i, ""));
                    if (dest) { await handleExtractArchive(ctxMenu.entry.path, dest); }
                    setCtxMenu(null);
                  }}>
                  <Group gap="xs"><IconZip size={14} /><Text size="sm">Extract to...</Text></Group>
                  </UnstyledButton>
                  )}
                  {!ctxMenu.entry.is_dir && isArchiveFile(ctxMenu.entry.name) && <Divider />}
                  {/* Copy to clipboard */}                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => handleCopyToClipboard(ctxMenu.entry)}
                >
                  <Group gap="xs">
                    <IconCopy size={14} />
                    <Text size="sm">Copy</Text>
                  </Group>
                </UnstyledButton>
                {/* Cut / Move */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => handleCutToClipboard(ctxMenu.entry)}
                >
                  <Group gap="xs">
                    <IconScissors size={14} />
                    <Text size="sm">Cut</Text>
                  </Group>
                </UnstyledButton>
                {/* Copy path */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => handleCopyPath(ctxMenu.entry)}
                >
                  <Group gap="xs">
                    <IconClipboard size={14} />
                    <Text size="sm">Copy path</Text>
                  </Group>
                </UnstyledButton>
                {/* Rename */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setNewName(ctxMenu.entry.name);
                    openRename();
                  }}
                >
                  <Group gap="xs">
                    <IconPencil size={14} />
                    <Text size="sm">Rename</Text>
                  </Group>
                </UnstyledButton>
                <Divider />
                {/* Add tag */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setTagTargetPath(ctxMenu.entry.path);
                    setTagInputValue("");
                    openTagModal();
                  }}
                >
                  <Group gap="xs">
                    <IconTag size={14} />
                    <Text size="sm">Add tag...</Text>
                  </Group>
                </UnstyledButton>
                {/* Remove tags */}
                {(fileTags.get(ctxMenu.entry.path) || []).map((t) => (
                  <UnstyledButton
                    key={t.id}
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                    onClick={() => {
                      handleRemoveTag(ctxMenu.entry.path, t.id);
                      setCtxMenu(null);
                    }}
                  >
                    <Group gap="xs">
                      <IconTagOff size={14} color="var(--mantine-color-red-6)" />
                      <Text size="sm" c="red">
                        Remove "{t.name}"
                      </Text>
                    </Group>
                  </UnstyledButton>
                ))}
                <Divider />
                {/* Properties */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setPropertiesPath(ctxMenu.entry.path);
                    openProperties();
                    setCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconInfoCircle size={14} />
                    <Text size="sm">Properties</Text>
                  </Group>
                </UnstyledButton>
                {/* Pin / Unpin */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    onToggleFavorite(ctxMenu.entry.path);
                    setCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    {favorites.includes(ctxMenu.entry.path) ? (
                      <IconStarFilled size={14} style={{ color: "var(--mantine-color-yellow-5)" }} />
                    ) : (
                      <IconStar size={14} />
                    )}
                    <Text size="sm">
                      {favorites.includes(ctxMenu.entry.path) ? "Unpin from favorites" : "Pin to favorites"}
                    </Text>
                  </Group>
                </UnstyledButton>
                {/* Delete */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => handleDelete(ctxMenu.entry)}
                >
                  <Group gap="xs">
                    <IconTrash size={14} color="var(--mantine-color-red-6)" />
                    <Text size="sm" c="red">Delete</Text>
                  </Group>
                </UnstyledButton>
              </Stack>
            </Paper>
          </Box>
        </Portal>
      )}

      {/* Context menu for empty space */}
      {bgCtxMenu && (
        <Portal>
          <Box
            ref={bgCtxMenuRef}
            style={{
              position: "fixed",
              left: bgCtxMenu.x,
              top: bgCtxMenu.y,
              zIndex: 1000,
            }}
          >
            <Paper shadow="md" p={4} w={200} withBorder>
              <Stack gap={2}>
                {/* Create file submenu */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setCreateFileName("");
                    setCreateFileIsText(false);
                    openCreateFile();
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconFile size={14} />
                    <Text size="sm">Create blank file</Text>
                  </Group>
                </UnstyledButton>
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setCreateFileName("");
                    setCreateFileIsText(true);
                    openCreateFile();
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconFileDescription size={14} />
                    <Text size="sm">Create text file</Text>
                  </Group>
                </UnstyledButton>
                <Divider />
                {/* Open in terminal */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={handleOpenInTerminal}
                >
                  <Group gap="xs">
                    <IconTerminal2 size={14} />
                    <Text size="sm">Open in terminal</Text>
                  </Group>
                </UnstyledButton>
                {/* Copy current path */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    navigator.clipboard.writeText(directoryPath).catch(() => {});
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconClipboard size={14} />
                    <Text size="sm">Copy path</Text>
                  </Group>
                </UnstyledButton>
                {/* Properties for current folder */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setPropertiesPath(directoryPath);
                    openProperties();
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconInfoCircle size={14} />
                    <Text size="sm">Properties</Text>
                  </Group>
                </UnstyledButton>
                {/* Pin / Unpin current folder */}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    onToggleFavorite(directoryPath);
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    {favorites.includes(directoryPath) ? (
                      <IconStarFilled size={14} style={{ color: "var(--mantine-color-yellow-5)" }} />
                    ) : (
                      <IconStar size={14} />
                    )}
                    <Text size="sm">
                      {favorites.includes(directoryPath) ? "Unpin from favorites" : "Pin to favorites"}
                    </Text>
                  </Group>
                </UnstyledButton>
                <Divider />
                {clipboard && (
                  <UnstyledButton
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                    onClick={handlePaste}
                  >
                    <Group gap="xs">
                      <IconClipboard size={14} />
                      <Text size="sm">
                        Paste ({clipboard.operation === "copy" ? "Copy" : "Move"}) "{clipboard.sourceName}"
                      </Text>
                    </Group>
                  </UnstyledButton>
                )}
                {clipboard && <Divider />}
                <UnstyledButton
                  p="xs"
                  style={{ borderRadius: "var(--mantine-radius-sm)" }}
                  onClick={() => {
                    setFolderName("");
                    openNewFolder();
                    setBgCtxMenu(null);
                  }}
                >
                  <Group gap="xs">
                    <IconFolderPlus size={14} />
                    <Text size="sm">New Folder</Text>
                  </Group>
                </UnstyledButton>
              </Stack>
            </Paper>
          </Box>
        </Portal>
      )}

      {/* Rename modal */}
      <Modal opened={renameOpened} onClose={closeRename} title="Rename" size="sm">
        <TextInput
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          placeholder="New name"
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
          autoFocus
          data-autofocus
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeRename}>Cancel</Button>
          <Button onClick={handleRename}>Rename</Button>
        </Group>
      </Modal>

      {/* New folder modal */}
      <Modal opened={newFolderOpened} onClose={closeNewFolder} title="New Folder" size="sm">
        <TextInput
          value={folderName}
          onChange={(e) => setFolderName(e.currentTarget.value)}
          placeholder="Folder name"
          onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
          autoFocus
          data-autofocus
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeNewFolder}>Cancel</Button>
          <Button onClick={handleCreateFolder}>Create</Button>
        </Group>
      </Modal>

      {/* Tag assignment modal */}
      <Modal opened={tagModalOpened} onClose={closeTagModal} title="Add Tag" size="sm">
        <TagComboBox
          allTags={allTags}
          inputValue={tagInputValue}
          onInputChange={setTagInputValue}
          onSubmit={handleAddTag}
        />
        {tagTargetPath && (
          <Checkbox
            mt="xs"
            size="xs"
            label="Apply to all files inside this folder"
            checked={inheritToContents}
            onChange={(e) => setInheritToContents(e.currentTarget.checked)}
          />
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeTagModal}>Cancel</Button>
          <Button onClick={handleAddTag} disabled={!tagInputValue.trim()}>Add</Button>
        </Group>
      </Modal>

      {/* Create file modal */}
      <Modal opened={createFileOpened} onClose={closeCreateFile} title={createFileIsText ? "Create Text File" : "Create Blank File"} size="sm">
        <TextInput
          value={createFileName}
          onChange={(e) => setCreateFileName(e.currentTarget.value)}
          placeholder={`File name${createFileIsText ? " (e.g. notes)" : ""}`}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreateFile(); }}
          autoFocus
          data-autofocus
          rightSection={createFileIsText ? <Text size="xs" c="dimmed">.txt</Text> : undefined}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeCreateFile}>Cancel</Button>
          <Button onClick={handleCreateFile} disabled={!createFileName.trim()}>Create</Button>
        </Group>
      </Modal>

      {/* Properties inspector */}
      <PropertyInspector
        path={propertiesPath}
        opened={propertiesOpened}
        onClose={closeProperties}
      />

      <SettingsModal
        opened={settingsOpened}
        onClose={() => setSettingsOpened(false)}
        config={config}
        onUpdate={updateConfig}
      />

      {viewerOpen && (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
          onOpenWithDefault={(path) => invoke("open_file", { path }).catch(() => {})}
          fileTags={fileTags}
        />
      )}
    </>
  );
}
