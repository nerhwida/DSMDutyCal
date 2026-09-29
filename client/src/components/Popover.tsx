import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  /** 기준 위치 (클릭한 요소의 getBoundingClientRect). 없으면 화면 중앙에 표시. */
  anchor: DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** 클릭한 위치 옆에 뜨는 팝오버. 바깥 클릭·Esc로 닫힌다. */
export function Popover({ anchor, onClose, children, width = 360 }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 내용이 비동기로 채워지면(교사 목록 로딩, 경고 표시 등) 높이가 바뀌므로, 크기가 바뀔 때마다
  // 다시 배치해 화면 아래로 잘리지 않게 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const height = el.offsetHeight;
      const margin = 8;
      if (!anchor) {
        setPos({ top: Math.max(margin, (window.innerHeight - height) / 2), left: (window.innerWidth - width) / 2 });
        return;
      }
      let left = anchor.right + margin;
      if (left + width > window.innerWidth - margin) left = anchor.left - width - margin;
      left = Math.max(margin, left);
      let top = anchor.top;
      if (top + height > window.innerHeight - margin) top = window.innerHeight - height - margin;
      setPos({ top: Math.max(margin, top), left });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor, width]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className="fixed z-50 max-h-[85vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl"
      role="dialog"
    >
      {children}
    </div>
  );
}
