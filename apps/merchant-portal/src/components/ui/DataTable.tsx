interface Column<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
  cell: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  empty?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, keyExtractor, empty, className = "" }: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <div className="p-8">{empty}</div>;
  }

  return (
    <div className={`overflow-x-auto rounded-2xl border border-slate-700/50 ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700/50 bg-slate-800/60">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`
                  p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider
                  ${col.width ? col.width : ""}
                  ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}
                `}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/40">
          {rows.map((row) => (
            <tr
              key={keyExtractor(row)}
              className="hover:bg-slate-700/20 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`
                    p-4 align-middle
                    ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}
                  `}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
