import { useEffect, useState } from 'react';
import { fetchEdgeLabels } from '../library/edges.js';
import { InlineInput } from './inline-input.js';

/** 关系标签。输入默认空，最近标签只填入，不提交。 */
export function LinkComposer(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  initial?: string;
  placeholder: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchEdgeLabels().then((next) => {
      if (alive) setLabels(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return <InlineInput {...props} suggestions={labels} />;
}
