import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  ActionIcon,
  Text,
  Group,
  Loader,
  Center,
  Tooltip,
  Kbd,
  Badge,
} from "@mantine/core";
import { IconX, IconChevronUp, IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import type { Tag as TagType } from "../types";

interface ImageViewerProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
  onOpenWithDefault: (path: string) => void;
  fileTags: Map<string, TagType[]>;
}

const THUMB_PRELOAD = 6;
const FULL_RES_DELAY = 150;

export default function ImageViewer({
  images,
  initialIndex,
  onClose,
  onOpenWithDefault,
  fileTags,
}: ImageViewerProps) {
  const total = images.length;

  const goNext = useCallback((i: number) => (i + 1) % total, [total]);
  const goPrev = useCallback((i: number) => (i - 1 + total) % total, [total]);

  const [currentIndex, setCurrentIndex] = useState(
    Math.min(initialIndex, total - 1),
  );
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());
  const [fullResUrls, setFullResUrls] = useState<Map<string, string>>(new Map());
  const [loadingFull, setLoadingFull] = useState(false);
  const loadedThumbsRef = useRef<Set<string>>(new Set());
  const fullResTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollCooldownRef = useRef<number>(0);

  const currentPath = images[currentIndex];

  // --- Thumbnail preloader ---
  useEffect(() => {
    const toLoad: string[] = [];
    for (let offset = 0; offset < THUMB_PRELOAD; offset++) {
      const idx = (currentIndex + offset) % total;
      const p = images[idx];
      if (!loadedThumbsRef.current.has(p)) {
        loadedThumbsRef.current.add(p);
        toLoad.push(p);
      }
    }
    if (toLoad.length === 0) return;

    for (const path of toLoad) {
      invoke<string>("get_system_thumbnail", { path })
        .then((url) => {
          if (url) {
            setThumbUrls((prev) => {
              if (prev.has(path)) return prev;
              const next = new Map(prev);
              next.set(path, url);
              return next;
            });
          }
        })
        .catch(() => {});
    }
  }, [currentIndex, images, total]);

  // --- Full-res loader: debounced, for current ±1 ---
  useEffect(() => {
    if (fullResTimerRef.current) clearTimeout(fullResTimerRef.current);

    setLoadingFull(true);

    fullResTimerRef.current = setTimeout(() => {
      for (const offset of [-1, 0, 1]) {
        const idx = (currentIndex + offset + total) % total;
        const path = images[idx];
        if (fullResUrls.has(path)) continue;

        invoke<string>("get_file_base64", { path })
          .then((url) => {
            setFullResUrls((prev) => {
              if (prev.has(path)) return prev;
              const next = new Map(prev);
              next.set(path, url);
              return next;
            });
          })
          .catch(() => {});
      }
    }, FULL_RES_DELAY);

    return () => {
      if (fullResTimerRef.current) clearTimeout(fullResTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, images, total]);

  // Track when full-res finishes for current image
  useEffect(() => {
    if (fullResUrls.has(currentPath)) {
      setLoadingFull(false);
    }
  }, [fullResUrls, currentPath]);

  // --- Keyboard ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentIndex((i) => goPrev(i));
        return;
      }
      if (e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setCurrentIndex((i) => goNext(i));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  // --- Scroll wheel ---
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - scrollCooldownRef.current < 120) return;
      scrollCooldownRef.current = now;

      if (e.deltaY > 0) {
        setCurrentIndex((i) => goNext(i));
      } else if (e.deltaY < 0) {
        setCurrentIndex((i) => goPrev(i));
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [goNext, goPrev]);

  const fileName = currentPath?.split("/").pop() || "";
  const thumbUrl = thumbUrls.get(currentPath);
  const fullUrl = fullResUrls.get(currentPath);
  const showLoader = !thumbUrl && !fullUrl;
  const showThumb = thumbUrl && !fullUrl;
  const tags = fileTags.get(currentPath) || [];

  if (!currentPath) return null;

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.92)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <Group
        px="md"
        py="xs"
        style={{
          borderBottom: "1px solid var(--app-border)",
          backdropFilter: "blur(8px)",
          flexShrink: 0,
        }}
        justify="space-between"
      >
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            onClick={() => setCurrentIndex((i) => goPrev(i))}
          >
            <IconChevronUp size={18} />
          </ActionIcon>
          <Badge size="lg" variant="light">
            {currentIndex + 1} / {total}
          </Badge>
          <ActionIcon
            variant="subtle"
            onClick={() => setCurrentIndex((i) => goNext(i))}
          >
            <IconChevronDown size={18} />
          </ActionIcon>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, justifyContent: "center", overflow: "hidden" }}>
          <Text size="sm" truncate maw={400}>
            {fileName}
          </Text>
          {tags.map((t) => (
            <Badge key={t.id} size="xs" color={t.color} variant="light">
              {t.name}
            </Badge>
          ))}
        </Group>
        <Group gap="xs">
          <Tooltip label="Open with default app">
            <ActionIcon
              variant="subtle"
              onClick={() => onOpenWithDefault(currentPath)}
            >
              <IconExternalLink size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close (Esc)">
            <ActionIcon variant="subtle" onClick={onClose}>
              <IconX size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Image area */}
      <Box
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Top half click → previous */}
        <Box
          onClick={() => setCurrentIndex((i) => goPrev(i))}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            height: "50%",
            cursor: "n-resize",
            zIndex: 10,
          }}
        />
        {/* Bottom half click → next */}
        <Box
          onClick={() => setCurrentIndex((i) => goNext(i))}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            right: 0,
            height: "50%",
            cursor: "s-resize",
            zIndex: 10,
          }}
        />

        {showLoader && (
          <Center>
            <Loader size="md" />
          </Center>
        )}

        {showThumb && (
          <img
            key={`thumb-${currentPath}`}
            src={thumbUrl}
            alt={fileName}
            style={{
              maxWidth: "95vw",
              maxHeight: "calc(100vh - 100px)",
              objectFit: "contain",
              display: "block",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          />
        )}

        {fullUrl && (
          <img
            key={`full-${currentPath}`}
            src={fullUrl}
            alt={fileName}
            style={{
              maxWidth: "95vw",
              maxHeight: "calc(100vh - 100px)",
              objectFit: "contain",
              display: "block",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          />
        )}

        {/* Up arrow overlay */}
        <ActionIcon
          variant="filled"
          size="lg"
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: 0.5,
            zIndex: 20,
          }}
          onClick={() => setCurrentIndex((i) => goPrev(i))}
        >
          <IconChevronUp size={22} />
        </ActionIcon>

        {/* Down arrow overlay */}
        <ActionIcon
          variant="filled"
          size="lg"
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: 0.5,
            zIndex: 20,
          }}
          onClick={() => setCurrentIndex((i) => goNext(i))}
        >
          <IconChevronDown size={22} />
        </ActionIcon>
      </Box>

      {/* Bottom bar */}
      <Group
        px="md"
        py={4}
        style={{
          borderTop: "1px solid var(--app-border)",
          backdropFilter: "blur(8px)",
          flexShrink: 0,
        }}
        justify="center"
        gap="md"
      >
        <Text size="xs" c="dimmed">
          <Kbd>↑</Kbd> Scroll up — Previous
        </Text>
        <Text size="xs" c="dimmed">
          <Kbd>↓</Kbd> Scroll down / <Kbd>Space</Kbd> — Next
        </Text>
        <Text size="xs" c="dimmed">
          <Kbd>Esc</Kbd> Close
        </Text>
        {loadingFull && (
          <Text size="xs" c="dimmed" fs="italic">
            Loading full resolution...
          </Text>
        )}
      </Group>
    </Box>
  );
}
