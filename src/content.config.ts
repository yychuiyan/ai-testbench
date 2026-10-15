import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TEMPLATE_CATEGORY_ORDER } from './lib/templates-meta';

/**
 * 模板库：仓库根 测试模板库/（界面称「测试模板库」），按分类子目录存放 .md。
 * 新增模板 = 放入带 frontmatter 的 .md 并 push，构建期自动上架。
 *
 * 只上架分类目录内的 .md：其他位置（根目录、用户新建的目录、误改名为 .md 的文件）
 * 不参与构建，否则 frontmatter 不合规会让整站 dev/build 崩掉。
 */
const TEMPLATE_GLOB_PATTERN = `{${TEMPLATE_CATEGORY_ORDER.join(',')}}/**/*.md`;

const templates = defineCollection({
  loader: glob({ pattern: TEMPLATE_GLOB_PATTERN, base: './测试模板库' }),
  schema: z.object({
    // 兜底默认值：分类目录内漏写 frontmatter 时不再中断整站构建
    title: z.string().default('未命名'),
    // catch 兜底到首个分类（该分类页存在，不会 404）；仅在漏写/写错 category 时生效
    category: z.enum(TEMPLATE_CATEGORY_ORDER).catch(TEMPLATE_CATEGORY_ORDER[0]),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
});

/**
 * 知识库：文档平铺存放于磁盘 知识库管理/（界面「知识库管理」），分类写在 frontmatter 的 category。
 * title/category 缺省时用默认值，避免手工编辑漏写 frontmatter 时整站 HMR 崩溃。
 */
const knowledge = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './知识库管理' }),
  schema: z.object({
    title: z.string().default('未命名'),
    category: z.string().default('未分类'),
    description: z.string().optional(),
  }),
});

export const collections = { templates, knowledge };
