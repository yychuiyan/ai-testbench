import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 模板库：仓库根 templates/（界面称「测试模板库」），按分类子目录存放 .md。
 * 新增模板 = 放入带 frontmatter 的 .md 并 push，构建期自动上架；
 * frontmatter 不符合 schema 时构建报错，充当贡献质量守门。
 */
const templates = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './templates' }),
  schema: z.object({
    title: z.string(),
    category: z.enum([
      '功能测试用例',
      '接口测试用例',
      '性能测试用例',
      '自动化测试用例',
      '功能测试报告',
      '接口测试报告',
      '性能测试报告',
    ]),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
});

/**
 * 知识库：规范 / 方法论 / 环境约定（磁盘 knowledge/，界面「知识库管理」）。
 * title/category 缺省时用默认值，避免手工编辑漏写 frontmatter 时整站 HMR 崩溃。
 */
const knowledge = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './knowledge' }),
  schema: z.object({
    title: z.string().default('未命名'),
    category: z.string().default('未分类'),
    description: z.string().optional(),
  }),
});

export const collections = { templates, knowledge };
