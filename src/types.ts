export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
  is_executable: boolean;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface FileWithTags {
  file: {
    id: number;
    path: string;
    name: string;
    is_dir: boolean;
    indexed_at: string;
  };
  tags: Tag[];
}

export interface FileProperties {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created: string;
  permissions: string;
  owner: string;
  group: string;
  mime_type: string;
  symlink_target: string | null;
  image_dimensions: string | null;
}
