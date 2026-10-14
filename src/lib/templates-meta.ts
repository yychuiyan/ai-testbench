/** 模板库分类顺序（与 content schema / 目录约定一致） */
export const TEMPLATE_CATEGORY_ORDER = [
  '功能测试用例',
  '接口测试用例',
  '性能测试用例',
  '自动化测试用例',
  '功能测试报告',
  '接口测试报告',
  '性能测试报告',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORY_ORDER)[number];

export function isTemplateCategory(v: string): v is TemplateCategory {
  return (TEMPLATE_CATEGORY_ORDER as readonly string[]).includes(v);
}
