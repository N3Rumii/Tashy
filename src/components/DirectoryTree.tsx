import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NavLink, ScrollArea, Box } from "@mantine/core";
import {
  IconFolder,
  IconFolderOpen,
  IconChevronRight,
} from "@tabler/icons-react";
import type { FileEntry } from "../types";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  loaded: boolean;
}

interface DirectoryTreeProps {
  onDirectorySelect: (path: string) => void;
  activePath: string;
}

function buildTreeRoot(): TreeNode {
  return {
    name: "/",
    path: "/",
    children: [],
    loaded: false,
  };
}

async function loadChildren(node: TreeNode): Promise<void> {
  if (node.loaded) return;
  try {
    const entries = await invoke<FileEntry[]>("read_directory", {
      dirPath: node.path,
    });
    const dirs = entries.filter((e) => e.is_dir);
    node.children = dirs.map((d) => ({
      name: d.name,
      path: d.path,
      children: [],
      loaded: false,
    }));
    node.loaded = true;
  } catch {
    node.loaded = true;
  }
}

export default function DirectoryTree({
  onDirectorySelect,
  activePath,
}: DirectoryTreeProps) {
  const [root, setRoot] = useState<TreeNode>(buildTreeRoot);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set(["/"]),
  );

  useEffect(() => {
    const loadRoot = async () => {
      const r = buildTreeRoot();
      await loadChildren(r);
      setRoot({ ...r });
    };
    loadRoot();
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      onDirectorySelect(path);
      const newExpanded = new Set(expandedPaths);
      newExpanded.add(path);
      setExpandedPaths(newExpanded);
    },
    [onDirectorySelect, expandedPaths],
  );

  const loadAndExpand = useCallback(
    async (node: TreeNode) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(node.path)) {
        newExpanded.delete(node.path);
      } else {
        newExpanded.add(node.path);
        if (!node.loaded) {
          await loadChildren(node);
          setRoot({ ...root });
        }
      }
      setExpandedPaths(newExpanded);
    },
    [expandedPaths, root],
  );

  const renderNode = (
    node: TreeNode,
    depth: number = 0,
  ): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = activePath === node.path;

    return (
      <Box key={node.path}>
        <NavLink
          label={node.name}
          leftSection={
            isExpanded ? (
              <IconFolderOpen size={18} />
            ) : (
              <IconFolder size={18} />
            )
          }
          active={isActive}
          onClick={() => handleSelect(node.path)}
          rightSection={
            node.loaded && node.children.length > 0 ? (
              <IconChevronRight
                size={14}
                style={{
                  transform: isExpanded
                    ? "rotate(90deg)"
                    : "rotate(0deg)",
                  transition: "transform 0.15s",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  loadAndExpand(node);
                }}
              />
            ) : undefined
          }
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          variant={isActive ? "light" : "subtle"}
        >
          {isExpanded &&
            node.children.map((child) =>
              renderNode(child, depth + 1),
            )}
        </NavLink>
      </Box>
    );
  };

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      {root.children.map((child) => renderNode(child, 0))}
    </ScrollArea>
  );
}
