import { observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { IconSearch } from '../../shared/ui/icons/icons.js';
import { LibraryService } from '../library/library.service.js';
import './palette.css';

export const SearchPalette = observer(function SearchPalette({ onClose }: { onClose: () => void }) {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      library.clearSearch();
      return;
    }
    const timer = window.setTimeout(() => {
      void library.search(trimmed);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [library, query]);

  const hits = query.trim() === '' ? [] : library.searchHits;

  useEffect(() => {
    setHighlight(0);
  }, [query, hits.length]);

  function openHit(index: number) {
    const hit = hits[index];
    if (!hit || hit.collectionId === '') return;
    navigate(`/c/${hit.collectionId}?node=${hit.nodeId}`);
    onClose();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + delta + hits.length) % hits.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openHit(highlight);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="搜索">
        <div className="pin">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            placeholder="搜索点或卡片"
            aria-label="搜索"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="hits">
          {library.error !== '' ? <p className="empty-line">{library.error}</p> : null}
          {query.trim() !== '' && hits.length === 0 && library.error === '' ? (
            <p className="empty-line">没有这条记录</p>
          ) : null}
          {hits.map((hit, index) => (
            <button
              key={`${hit.nodeId}:${hit.collectionId}:${index}`}
              type="button"
              className={index === highlight ? 'hit hl' : 'hit'}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => openHit(index)}
            >
              <span>{hit.name}</span>
              {hit.collectionId === '' ? (
                <small>不在任何合集</small>
              ) : hit.snippet !== '' ? (
                <small>{hit.snippet}</small>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
