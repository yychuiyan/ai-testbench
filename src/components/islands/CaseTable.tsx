import { CASE_FIELDS, type TestCaseRow } from '../../lib/export';

export default function CaseTable({ cases }: { cases: TestCaseRow[] }) {
  if (!cases.length) {
    return <p className="text-sm text-stone-400 px-1 py-2">暂无用例</p>;
  }
  return (
    <div className="overflow-x-auto border border-stone-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            {CASE_FIELDS.map((f) => (
              <th
                key={f}
                className="px-3 py-2.5 text-left text-xs font-semibold text-stone-500 whitespace-nowrap"
              >
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {cases.map((c, i) => (
            <tr key={i} className="hover:bg-amber-50/40">
              {CASE_FIELDS.map((f) => (
                <td
                  key={f}
                  className={`px-3 py-2.5 align-top leading-5 text-stone-700 ${
                    f === '用例编号' || f === '优先级' || f === '用例类型'
                      ? 'whitespace-nowrap'
                      : 'min-w-40 whitespace-pre-wrap'
                  }`}
                >
                  {f === '优先级' ? (
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        c[f] === 'P0'
                          ? 'bg-red-100 text-red-700'
                          : c[f] === 'P1'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {c[f]}
                    </span>
                  ) : (
                    c[f]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
