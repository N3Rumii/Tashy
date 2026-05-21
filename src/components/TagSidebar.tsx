import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ScrollArea,
  Text,
  Group,
  Stack,
  UnstyledButton,
  ActionIcon,
  TextInput,
  ColorInput,
  Badge,
  Tooltip,
  Box,
} from "@mantine/core";
import {
  IconTag,
  IconPlus,
  IconTrash,
  IconPencil,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import type { Tag } from "../types";

interface TagSidebarProps {
  selectedTagIds: Set<number>;
  onToggleTag: (tagId: number) => void;
  onTagsChanged: () => void;
}

const DEFAULT_COLORS = [
  "#228be6", "#40c057", "#fab005", "#fd7e14",
  "#e64980", "#be4bdb", "#15aabf", "#82c91e",
];

export default function TagSidebar({
  selectedTagIds,
  onToggleTag,
  onTagsChanged,
}: TagSidebarProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(DEFAULT_COLORS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const loadTags = useCallback(async () => {
    try {
      const result = await invoke<Tag[]>("get_all_tags");
      setTags(result);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    try {
      await invoke("create_tag", { name: newTagName.trim(), color: newTagColor });
      setNewTagName("");
      setAdding(false);
      loadTags();
      onTagsChanged();
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoke("delete_tag", { id });
      loadTags();
      onTagsChanged();
    } catch (err) {
      console.error("Failed to delete tag:", err);
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await invoke("update_tag", { id, name: editName.trim(), color: editColor });
      setEditingId(null);
      loadTags();
      onTagsChanged();
    } catch (err) {
      console.error("Failed to update tag:", err);
    }
  };

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Group px="xs" py="xs" justify="space-between">
        <Group gap={4}>
          <IconTag size={16} />
          <Text size="sm" fw={600}>Tags</Text>
        </Group>
        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <IconPlus size={14} />
        </ActionIcon>
      </Group>

      <Stack gap={4} px="xs">
        {adding && (
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              placeholder="Tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setAdding(false);
              }}
              autoFocus
              style={{ flex: 1 }}
            />
            <ColorInput
              size="xs"
              value={newTagColor}
              onChange={(v) => setNewTagColor(v)}
              swatches={DEFAULT_COLORS}
              swatchesPerRow={4}
              w={36}
              popoverProps={{ withinPortal: false }}
            />
            <ActionIcon size="xs" variant="light" onClick={handleCreate}>
              <IconCheck size={12} />
            </ActionIcon>
            <ActionIcon size="xs" variant="subtle" onClick={() => setAdding(false)}>
              <IconX size={12} />
            </ActionIcon>
          </Group>
        )}

        {tags.map((tag) => (
          <Box key={tag.id}>
            {editingId === tag.id ? (
              <Group gap={4} wrap="nowrap">
                <TextInput
                  size="xs"
                  value={editName}
                  onChange={(e) => setEditName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdate(tag.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <ColorInput
                  size="xs"
                  value={editColor}
                  onChange={(v) => setEditColor(v)}
                  swatches={DEFAULT_COLORS}
                  swatchesPerRow={4}
                  w={36}
                  popoverProps={{ withinPortal: false }}
                />
                <ActionIcon size="xs" variant="light" onClick={() => handleUpdate(tag.id)}>
                  <IconCheck size={12} />
                </ActionIcon>
                <ActionIcon size="xs" variant="subtle" onClick={() => setEditingId(null)}>
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            ) : (
              <Group wrap="nowrap" justify="space-between">
                <UnstyledButton
                  onClick={() => onToggleTag(tag.id)}
                  style={{ flex: 1 }}
                >
                  <Badge
                    variant={selectedTagIds.has(tag.id) ? "filled" : "light"}
                    color={tag.color}
                    style={{ cursor: "pointer" }}
                    fullWidth
                    size="sm"
                  >
                    {tag.name}
                  </Badge>
                </UnstyledButton>
                <Group gap={0}>
                  <Tooltip label="Edit tag">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        setEditName(tag.name);
                        setEditColor(tag.color);
                        setEditingId(tag.id);
                      }}
                    >
                      <IconPencil size={10} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete tag">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => handleDelete(tag.id)}
                    >
                      <IconTrash size={10} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            )}
          </Box>
        ))}
      </Stack>
    </ScrollArea>
  );
}
