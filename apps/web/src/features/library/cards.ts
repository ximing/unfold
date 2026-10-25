import type {
  Card,
  CreateCardBody,
} from '@unfold/dto';
import {
  cardSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';

export async function createCard(state: LibraryState, body: CreateCardBody): Promise<Card | null> {
  state.error = '';
  const res = await apiSend('/api/cards', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  return apiRead(state, res, (data) => cardSchema.parse(data), '卡片没有加上');
}

export async function updateCard(state: LibraryState, id: string, content: Card['content']): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/cards/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const next = await apiRead(state, res, (data) => cardSchema.parse(data), '卡片没有保存');
  if (!next) return false;
  replaceCard(state, next);
  return true;
}

export async function deleteCard(state: LibraryState, id: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/cards/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '卡片没有删掉');
  if (!ok) return false;
  state.nodeDetail = state.nodeDetail
    ? { ...state.nodeDetail, cards: state.nodeDetail.cards.filter((card) => card.id !== id) }
    : null;
  state.edgeDetail = state.edgeDetail
    ? { ...state.edgeDetail, cards: state.edgeDetail.cards.filter((card) => card.id !== id) }
    : null;
  state.collectionEdgeDetail = state.collectionEdgeDetail
    ? {
        ...state.collectionEdgeDetail,
        cards: state.collectionEdgeDetail.cards.filter((card) => card.id !== id),
      }
    : null;
  return true;
}

export function replaceCard(state: LibraryState, next: Card): void {
  const swap = (cards: Card[]) => cards.map((card) => (card.id === next.id ? next : card));
  if (state.nodeDetail) state.nodeDetail = { ...state.nodeDetail, cards: swap(state.nodeDetail.cards) };
  if (state.edgeDetail) state.edgeDetail = { ...state.edgeDetail, cards: swap(state.edgeDetail.cards) };
  if (state.collectionEdgeDetail) {
    state.collectionEdgeDetail = { ...state.collectionEdgeDetail, cards: swap(state.collectionEdgeDetail.cards) };
  }
}
