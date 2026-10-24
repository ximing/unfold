import { observer, useService } from '@rabjs/react';
import { objectSummarySchema } from '@unfold/dto';
import type { Collection, DocumentResponse } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function topLevelBlocks(content: unknown): Record<string, unknown>[] {
  if (!isRecord(content) || !Array.isArray(content.content)) return [];
  return content.content.filter(isRecord);
}

function paragraphText(node: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (current: unknown): void => {
    if (!isRecord(current)) return;
    if (current.type === 'text' && typeof current.text === 'string') parts.push(current.text);
    if (!Array.isArray(current.content)) return;
    for (const child of current.content) walk(child);
  };
  walk(node);
  return parts.join('');
}

function stringAttr(node: Record<string, unknown>, key: string): string {
  if (!isRecord(node.attrs)) return '';
  const value = node.attrs[key];
  return typeof value === 'string' ? value : '';
}

function ObjectRefBlock({
  objectId,
  label,
  onMove,
}: {
  objectId: string;
  label: string;
  onMove: (draggedId: string, targetId: string) => void;
}) {
  const [core, setCore] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCore(null);
    void (async () => {
      try {
        const res = await fetch('/api/objects/' + objectId, { credentials: 'include' });
        if (!res.ok) return;
        const summary = objectSummarySchema.parse(await res.json());
        if (!alive) return;
        setCore(summary.coreStatement);
      } catch {
        // 读不到核心陈述就不显示这行。
      }
    })();
    return () => {
      alive = false;
    };
  }, [objectId]);

  return (
    <div
      className="collection-block"
      draggable
      data-object-id={objectId}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', objectId);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onMove(event.dataTransfer.getData('text/plain'), objectId);
      }}
    >
      <Link to={'/o/' + objectId} draggable={false}>{label}</Link>
      {core ? <small className="muted">{core}</small> : null}
    </div>
  );
}

function CollectionDocument({
  content,
  onMove,
}: {
  content: DocumentResponse['content'];
  onMove: (draggedId: string, targetId: string) => void;
}) {
  return (
    <>
      {topLevelBlocks(content).map((node, index) => {
        const type = typeof node.type === 'string' ? node.type : '';
        if (type === 'paragraph') {
          return (
            <p key={index} className="collection-block">
              {paragraphText(node)}
            </p>
          );
        }
        if (type === 'object_ref') {
          const objectId = stringAttr(node, 'objectId');
          if (objectId === '') {
            return (
              <p key={index} className="muted">
                {type}
              </p>
            );
          }
          const label = stringAttr(node, 'label');
          return (
            <ObjectRefBlock
              key={index}
              objectId={objectId}
              label={label === '' ? '点' : label}
              onMove={onMove}
            />
          );
        }
        return (
          <p key={index} className="muted">
            {type}
          </p>
        );
      })}
    </>
  );
}

export const CollectionPage = observer(function CollectionPage() {
  const library = useService(LibraryService);
  const { id = '' } = useParams();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [doc, setDoc] = useState<DocumentResponse | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setCollection(null);
    setDoc(null);
    setMessage('');
    void (async () => {
      const next = await library.loadCollection(id);
      if (!alive) return;
      const loaded = await library.loadCollectionDocument(id);
      if (!alive) return;
      setCollection(next);
      setDoc(loaded);
      if (!next) {
        setMessage(library.collectionError);
        return;
      }
      if (!loaded) setMessage(library.collectionError || '文档没有加载出来');
    })();
    return () => {
      alive = false;
    };
  }, [id, library]);

  if (!collection) {
    return message ? <p role="alert">{message}</p> : null;
  }

  const moveRef = (draggedId: string, targetId: string): void => {
    if (!doc) return;
    const ids = topLevelBlocks(doc.content)
      .filter((node) => node.type === 'object_ref')
      .map((node) => stringAttr(node, 'objectId'));
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const position = from < to ? to - 1 : to;
    void (async () => {
      const ok = await library.moveFiledObject(id, draggedId, position);
      if (!ok) {
        setMessage('排序没有完成');
        return;
      }
      setDoc(await library.loadCollectionDocument(id));
    })();
  };

  const domainName = library.domains.find((domain) => domain.id === collection.domainId)?.name;

  return (
    <main className="shell">
      <p className="muted">{domainName ? `合集 · ${domainName}` : '合集'}</p>
      <h1>{collection.title}</h1>
      {collection.intent !== '' ? <p>{collection.intent}</p> : null}
      <p>引用块是活的：点进去就是点本身。点的 ID、关系、证据不因为编入或移出合集而改变。</p>
      {message ? <p role="alert">{message}</p> : null}
      {doc ? <CollectionDocument content={doc.content} onMove={moveRef} /> : null}
    </main>
  );
});
