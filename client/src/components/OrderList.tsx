import { useState } from 'react';

interface OrderItem {
  teacherId: number;
  name: string;
  /** 횟수 (참고용 표시). */
  total?: number;
}

/** 순환 순서 드래그 앤 드롭 리스트 (HTML5 네이티브 드래그, 외부 라이브러리 미사용). */
export function OrderList({
  items,
  editable,
  totalTitle = '누계',
  onReorder,
}: {
  items: OrderItem[];
  editable: boolean;
  /** 횟수에 마우스를 올렸을 때 설명 */
  totalTitle?: string;
  onReorder: (teacherIds: number[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    onReorder(next.map((i) => i.teacherId));
  }

  if (items.length === 0) {
    return <p className="text-xs text-slate-400">해당 조건의 교사가 없습니다.</p>;
  }

  return (
    <ol className="flex flex-col gap-1">
      {items.map((item, index) => {
        return (
          <li
            key={item.teacherId}
            draggable={editable}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(index)}
            className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
              editable ? 'cursor-move border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 text-slate-500'
            } ${dragIndex === index ? 'opacity-50' : ''}`}
          >
            <span className="w-5 text-right text-xs text-slate-400">{index + 1}</span>
            <span>{item.name}</span>
            {item.total !== undefined && (
              <span className="ml-auto text-xs text-slate-400" title={totalTitle}>
                {item.total}회
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
