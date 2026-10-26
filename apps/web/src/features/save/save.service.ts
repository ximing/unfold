import { Service } from '@rabjs/react';
import { readSave, subscribeSave, type SavePhase, type SaveSnapshot } from '../../shared/save/save-bus.js';

export class SaveService extends Service {
  phase: SavePhase = 'idle';
  detail = '';

  constructor() {
    super();
    this.apply(readSave());
    subscribeSave(() => {
      this.apply(readSave());
    });
  }

  apply(next: SaveSnapshot): void {
    this.phase = next.phase;
    this.detail = next.detail;
  }
}
