import { observer, useService } from '@rabjs/react';
import { saveLabel } from '../../shared/save/save-bus.js';
import { SaveService } from '../save/save.service.js';

export const SaveStatus = observer(function SaveStatus() {
  const save = useService(SaveService);
  const label = saveLabel(save.phase);
  const title = save.phase === 'failed' && save.detail !== '' ? save.detail : label ? '保存 ⌘S' : undefined;
  return (
    <p className="save-status" data-phase={save.phase} role="status" aria-live="polite" title={title}>
      {label ? (
        <>
          <span className="save-dot" aria-hidden="true" />
          {label}
        </>
      ) : null}
    </p>
  );
});
