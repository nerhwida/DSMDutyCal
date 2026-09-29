import { useState } from 'react';

interface OrderItem {
  teacherId: number;
  name: string;
}

/** 순환 순서 드래그 앤 드롭 리스트 (HTML5 네이티브 드래그, 외부 라이브러리 미사용). */
export function OrderList({
  items,
  editable,
  onReorder,
}: {
  items: OrderItem[];
  editable: boolean;
  onReorder: (teacherIds: number[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return;
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
      {items.map((item, index) => (
        <li
          key={item.teacherId}
          draggable={editable}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
          className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
            editable ? 'cursor-move border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 text-slate-500'
          }`}
        >
          <span className="w-5 text-right text-xs text-slate-400">{index + 1}</span>
          <span>{item.name}</span>
        </li>
      ))}
    </ol>
  );
}
