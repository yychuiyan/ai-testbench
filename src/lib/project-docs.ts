/**
 * 项目文档库客户端。
 * DocsRoot 为英文逻辑 id；磁盘英文目录、界面中文见 doc-roots.ts。
 * 仅 npm run dev / 本地一体服务可写。
 */

export type DocsRoot = 'requirements' | 'cases' | 'templates' | 'prompts' | 'knowledge';

export interface DocsEntry {
  name: string;
  type: 'dir' | 'file';
  path: string;
  size?: number;
  /** 修改时间 ms */
  mtime?: number;
  /** 创建时间 ms（不可用时可能接近 mtime） */
  ctime?: number;
}

export interface DocsTreeNode {
  name: string;
  path: string;
  children: DocsTreeNode[];
}

function prefixOf(root: DocsRoot): string {
  if (root === 'requirements') return '/__local_requirements';
  if (root === 'cases') return '/__local_cases';
  if (root === 'prompts') return '/__local_prompts';
  if (root === 'knowledge') return '/__local_knowledge';
  return '/__local_templates';
}

async function postJson<T>(
  root: DocsRoot,
  pathSuffix: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${prefixOf(root)}${pathSuffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchDocsHealth(root: DocsRoot): Promise<boolean> {
  try {
    const res = await fetch(`${prefixOf(root)}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listDocs(
  root: DocsRoot,
  dirPath = '.',
): Promise<{ path: string; entries: DocsEntry[] }> {
  const data = await postJson<{ path: string; entries: DocsEntry[] }>(root, '/list', {
    path: dirPath,
  });
  return { path: data.path, entries: data.entries ?? [] };
}

export async function fetchDocsTree(root: DocsRoot): Promise<DocsTreeNode[]> {
  const res = await fetch(`${prefixOf(root)}/tree`, { signal: AbortSignal.timeout(3000) });
  const data = (await res.json()) as { ok?: boolean; tree?: DocsTreeNode[]; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.tree ?? [];
}

export async function mkdirDocs(root: DocsRoot, parent: string, name: string): Promise<string> {
  const data = await postJson<{ path: string }>(root, '/mkdir', { parent, name });
  return data.path;
}

export async function uploadDocsFile(
  root: DocsRoot,
  parent: string,
  file: File,
): Promise<{ path: string; size: number }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const contentBase64 = btoa(binary);
  return postJson(root, '/upload', {
    parent,
    name: file.name,
    contentBase64,
  });
}

export async function readDocsText(
  root: DocsRoot,
  filePath: string,
): Promise<{ path: string; content: string; encoding: string }> {
  const data = await postJson<{
    path: string;
    content?: string;
    encoding: string;
    contentBase64?: string;
  }>(root, '/read', { path: filePath });
  if (data.encoding === 'utf-8' && typeof data.content === 'string') {
    return { path: data.path, content: data.content, encoding: data.encoding };
  }
  throw new Error('该文件不是可预览的文本');
}

/** 读取原始内容（文本或 base64） */
export async function readDocsRaw(
  root: DocsRoot,
  filePath: string,
): Promise<{
  path: string;
  encoding: 'utf-8' | 'base64';
  content?: string;
  contentBase64?: string;
}> {
  const data = await postJson<{
    path: string;
    content?: string;
    encoding: string;
    contentBase64?: string;
  }>(root, '/read', { path: filePath });
  if (data.encoding === 'utf-8' && typeof data.content === 'string') {
    return { path: data.path, encoding: 'utf-8', content: data.content };
  }
  if (typeof data.contentBase64 === 'string') {
    return { path: data.path, encoding: 'base64', contentBase64: data.contentBase64 };
  }
  throw new Error('无法读取文件');
}

export async function writeDocsText(
  root: DocsRoot,
  filePath: string,
  content: string,
): Promise<void> {
  await postJson(root, '/write-text', { path: filePath, content });
}

export async function writeDocsBinary(
  root: DocsRoot,
  filePath: string,
  contentBase64: string,
): Promise<void> {
  await postJson(root, '/write-binary', { path: filePath, contentBase64 });
}

export async function deleteDocs(root: DocsRoot, targetPath: string): Promise<void> {
  await postJson(root, '/delete', { path: targetPath });
}

/** 用本机默认程序打开文件（仅 npm run dev） */
export async function openDocsFile(root: DocsRoot, filePath: string): Promise<void> {
  await postJson(root, '/open', { path: filePath });
}

export function fileToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
