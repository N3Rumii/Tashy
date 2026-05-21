import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Modal,
  Text,
  Group,
  Stack,
  CopyButton,
  ActionIcon,
  Tooltip,
  Loader,
  Center,
  Divider,
  Tabs,
  Checkbox,
  Button,
  Alert,
  TextInput,
  Select,
} from "@mantine/core";
import { IconCopy, IconCheck, IconPlayerPlay, IconInfoCircle } from "@tabler/icons-react";
import type { FileProperties } from "../types";

interface PropertyInspectorProps {
  path: string;
  opened: boolean;
  onClose: () => void;
}

interface UserEntry { uid: number; name: string }
interface GroupEntry { gid: number; name: string }

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={120} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Group gap={4} wrap="nowrap" align="flex-start">
            <Text size="sm" style={{ wordBreak: "break-all" }}>
              {value || "\u2014"}
            </Text>
            <Tooltip label={copied ? "Copied" : "Copy"}>
              <ActionIcon size="xs" variant="subtle" onClick={copy} style={{ flexShrink: 0 }}>
                {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </CopyButton>
    </Group>
  );
}

/** Parse octal mode from permissions string like "-rwxr-xr-x (755)" */
function parseOctal(perms: string): string {
  const m = perms.match(/\((\d{3})\)/);
  return m ? m[1] : "000";
}

/** Parse individual rwx bits from octal string */
function parseBits(octal: string): { ur: boolean; uw: boolean; ux: boolean; gr: boolean; gw: boolean; gx: boolean; or_: boolean; ow: boolean; ox: boolean } {
  const n = parseInt(octal, 8) || 0;
  return {
    ur: !!(n & 0o400), uw: !!(n & 0o200), ux: !!(n & 0o100),
    gr: !!(n & 0o040), gw: !!(n & 0o020), gx: !!(n & 0o010),
    or_: !!(n & 0o004), ow: !!(n & 0o002), ox: !!(n & 0o001),
  };
}

/** Compute octal from individual bits */
function bitsToOctal(bits: ReturnType<typeof parseBits>): string {
  let n = 0;
  if (bits.ur) n |= 0o400; if (bits.uw) n |= 0o200; if (bits.ux) n |= 0o100;
  if (bits.gr) n |= 0o040; if (bits.gw) n |= 0o020; if (bits.gx) n |= 0o010;
  if (bits.or_) n |= 0o004; if (bits.ow) n |= 0o002; if (bits.ox) n |= 0o001;
  return n.toString(8).padStart(3, "0");
}

export default function PropertyInspector({ path, opened, onClose }: PropertyInspectorProps) {
  const [props, setProps] = useState<FileProperties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chmodLoading, setChmodLoading] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [chmodSuccess, setChmodSuccess] = useState(false);
  const [octalMode, setOctalMode] = useState("");
  const [octalLoading, setOctalLoading] = useState(false);
  const [chownLoading, setChownLoading] = useState(false);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Permission checkboxes
  const [bits, setBits] = useState({ ur: false, uw: false, ux: false, gr: false, gw: false, gx: false, or_: false, ow: false, ox: false });

  const loadProps = useCallback(async () => {
    if (!opened || !path) return;
    setLoading(true);
    setError(null);
    setProps(null);
    setChmodSuccess(false);
    setExecError(null);
    try {
      const [result, userList, groupList] = await Promise.all([
        invoke<FileProperties>("get_file_properties", { path }),
        invoke<UserEntry[]>("list_users").catch(() => [] as UserEntry[]),
        invoke<GroupEntry[]>("list_groups").catch(() => [] as GroupEntry[]),
      ]);
      setProps(result);
      setUsers(userList);
      setGroups(groupList);
      const oct = parseOctal(result.permissions);
      setBits(parseBits(oct));
      setSelectedOwner(result.owner?.split("(")[0]?.trim() || null);
      setSelectedGroup(result.group?.split("(")[0]?.trim() || null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [opened, path]);

  useEffect(() => { loadProps(); }, [loadProps]);

  const applyPermissionBits = async (newBits: typeof bits) => {
    if (!props) return;
    const octal = bitsToOctal(newBits);
    setChmodLoading(true);
    setChmodSuccess(false);
    setExecError(null);
    try {
      await invoke("chmod_file", { path: props.path, mode: octal });
      setChmodSuccess(true);
      const result = await invoke<FileProperties>("get_file_properties", { path: props.path });
      setProps(result);
      setBits(parseBits(parseOctal(result.permissions)));
    } catch (err) {
      setExecError(String(err));
      setBits(parseBits(parseOctal(props.permissions))); // revert
    } finally {
      setChmodLoading(false);
    }
  };

  const toggleBit = (key: keyof typeof bits) => {
    const next = { ...bits, [key]: !bits[key] };
    setBits(next);
    applyPermissionBits(next);
  };

  const handleApplyOctal = async () => {
    if (!props) return;
    const trimmed = octalMode.trim();
    if (!/^[0-7]{3}$/.test(trimmed)) {
      setExecError("Enter a 3-digit octal mode (e.g. 755, 644)");
      return;
    }
    setOctalLoading(true);
    setExecError(null);
    setChmodSuccess(false);
    try {
      await invoke("chmod_file", { path: props.path, mode: trimmed });
      setChmodSuccess(true);
      setOctalMode("");
      const result = await invoke<FileProperties>("get_file_properties", { path: props.path });
      setProps(result);
      setBits(parseBits(parseOctal(result.permissions)));
    } catch (err) {
      setExecError(String(err));
    } finally {
      setOctalLoading(false);
    }
  };

  const handleApplyChown = async () => {
    if (!props) return;
    setChownLoading(true);
    setExecError(null);
    try {
      await invoke("chown_file", {
        path: props.path,
        owner: selectedOwner || "",
        group: selectedGroup || "",
      });
      setChmodSuccess(true);
      const result = await invoke<FileProperties>("get_file_properties", { path: props.path });
      setProps(result);
    } catch (err) {
      setExecError(String(err));
    } finally {
      setChownLoading(false);
    }
  };

  const fileName = path.split("/").pop() || path;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600} truncate maw={400}>Properties \u2014 {fileName}</Text>}
      size="lg"
    >
      {loading ? (
        <Center py="xl"><Loader size="sm" /></Center>
      ) : error ? (
        <Text c="red" size="sm">{error}</Text>
      ) : props ? (
        <Tabs defaultValue="basic">
          <Tabs.List>
            <Tabs.Tab value="basic" leftSection={<IconInfoCircle size={14} />}>Basic</Tabs.Tab>
            <Tabs.Tab value="permissions" leftSection={<IconCopy size={14} />}>Permissions</Tabs.Tab>
          </Tabs.List>

          {/* Basic tab */}
          <Tabs.Panel value="basic" pt="md">
            <Stack gap="sm">
              <PropertyRow label="Name" value={props.name} />
              <PropertyRow label="Path" value={props.path} />
              <PropertyRow label="Size" value={props.is_dir ? "\u2014" : `${formatSize(props.size)} (${props.size.toLocaleString()} bytes)`} />
              <PropertyRow label="Type" value={props.is_dir ? "Folder" : props.mime_type} />
              {props.image_dimensions && <PropertyRow label="Dimensions" value={props.image_dimensions} />}
              {props.symlink_target && <PropertyRow label="Symlink target" value={props.symlink_target} />}
              <Divider />
              <PropertyRow label="Modified" value={props.modified} />
              <PropertyRow label="Created" value={props.created} />
              <PropertyRow label="Owner (UID)" value={props.owner} />
              <PropertyRow label="Group (GID)" value={props.group} />
            </Stack>
          </Tabs.Panel>

          {/* Permissions tab */}
          <Tabs.Panel value="permissions" pt="md">
            <Stack gap="md">
              {/* Owner & Group dropdowns */}
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Owner & Group</Text>
              <Group gap="xs" wrap="nowrap">
                <Select
                  size="xs"
                  label="Owner"
                  placeholder="Owner"
                  data={users.map((u) => ({ value: u.name, label: `${u.name} (${u.uid})` }))}
                  value={selectedOwner}
                  onChange={(v) => setSelectedOwner(v)}
                  searchable
                  clearable
                  style={{ flex: 1 }}
                />
                <Select
                  size="xs"
                  label="Group"
                  placeholder="Group"
                  data={groups.map((g) => ({ value: g.name, label: `${g.name} (${g.gid})` }))}
                  value={selectedGroup}
                  onChange={(v) => setSelectedGroup(v)}
                  searchable
                  clearable
                  style={{ flex: 1 }}
                />
                <Button
                  size="xs"
                  variant="light"
                  onClick={handleApplyChown}
                  loading={chownLoading}
                  mt="lg"
                >
                  Apply
                </Button>
              </Group>

              <Divider />

              {/* Permission checkboxes */}
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Permissions</Text>
              <Group gap="md" align="flex-start">
                {/* Owner */}
                <Stack gap={4}>
                  <Text size="xs" fw={600}>Owner</Text>
                  <Checkbox size="xs" label="Read" checked={bits.ur} disabled={chmodLoading} onChange={() => toggleBit("ur")} />
                  <Checkbox size="xs" label="Write" checked={bits.uw} disabled={chmodLoading} onChange={() => toggleBit("uw")} />
                  <Checkbox size="xs" label="Execute" checked={bits.ux} disabled={chmodLoading} onChange={() => toggleBit("ux")} />
                </Stack>
                {/* Group */}
                <Stack gap={4}>
                  <Text size="xs" fw={600}>Group</Text>
                  <Checkbox size="xs" label="Read" checked={bits.gr} disabled={chmodLoading} onChange={() => toggleBit("gr")} />
                  <Checkbox size="xs" label="Write" checked={bits.gw} disabled={chmodLoading} onChange={() => toggleBit("gw")} />
                  <Checkbox size="xs" label="Execute" checked={bits.gx} disabled={chmodLoading} onChange={() => toggleBit("gx")} />
                </Stack>
                {/* Other */}
                <Stack gap={4}>
                  <Text size="xs" fw={600}>Other</Text>
                  <Checkbox size="xs" label="Read" checked={bits.or_} disabled={chmodLoading} onChange={() => toggleBit("or_")} />
                  <Checkbox size="xs" label="Write" checked={bits.ow} disabled={chmodLoading} onChange={() => toggleBit("ow")} />
                  <Checkbox size="xs" label="Execute" checked={bits.ox} disabled={chmodLoading} onChange={() => toggleBit("ox")} />
                </Stack>
                <Stack gap={4} justify="center" h="100%">
                  <Text size="xs" c="dimmed">Octal</Text>
                  <Text size="lg" fw={700}>{bitsToOctal(bits)}</Text>
                </Stack>
              </Group>

              <Divider />

              {/* Octal input + executable toggle */}
              <Group gap="xs" wrap="nowrap">
                <TextInput
                  size="xs"
                  placeholder="Octal mode (e.g. 755)"
                  value={octalMode}
                  onChange={(e) => setOctalMode(e.currentTarget.value)}
                  style={{ width: 140 }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApplyOctal(); }}
                />
                <Button size="xs" variant="light" onClick={handleApplyOctal} loading={octalLoading}>Apply</Button>
              </Group>

              {chmodSuccess && <Text size="xs" c="green">Permissions updated.</Text>}

              {!props.is_dir && bits.ux && (
                <Button leftSection={<IconPlayerPlay size={14} />} variant="light" onClick={async () => {
                  setExecError(null);
                  try { await invoke("run_executable", { path: props.path }); onClose(); }
                  catch (err) { setExecError(String(err)); }
                }} fullWidth>Run in terminal</Button>
              )}

              {execError && (
                <Alert icon={<IconInfoCircle size={14} />} color="red" variant="light" p="xs">
                  <Text size="xs">{execError}</Text>
                </Alert>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Modal>
  );
}
