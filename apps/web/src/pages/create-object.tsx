import { observer, useService } from '@rabjs/react';
import { knowledgeObjectTypeSchema, type KnowledgeObjectType } from '@unfold/dto';
import { type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LibraryService } from '../services/library.service.js';

const TYPES: { value: KnowledgeObjectType; label: string }[] = [
  { value: 'concept', label: '概念' },
  { value: 'principle', label: '原则' },
  { value: 'method', label: '方法' },
  { value: 'model', label: '模型' },
  { value: 'problem', label: '问题' },
];

export const CreateObjectPage = observer(function CreateObjectPage() {
  const library = useService(LibraryService);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const picked = data.get('domainId');
    const typedName = data.get('newDomain');
    const typedCanonical = data.get('canonicalName');
    const typedStatement = data.get('coreStatement');
    const newName = typeof typedName === 'string' ? typedName.trim() : '';
    const selectedId = typeof picked === 'string' ? picked : '';
    const canonicalName = typeof typedCanonical === 'string' ? typedCanonical.trim() : '';
    const coreStatement = typeof typedStatement === 'string' ? typedStatement : '';
    const parsedType = knowledgeObjectTypeSchema.safeParse(data.get('type'));

    if (!canonicalName) {
      library.error = '名称不能为空';
      return;
    }
    if (!parsedType.success) {
      library.error = '类型不正确';
      return;
    }

    let domainId = selectedId;
    if (newName) {
      const createdDomain = await library.createDomain(newName);
      if (!createdDomain) return;
      domainId = createdDomain.id;
    }
    if (!domainId) {
      library.error = '先选择领域，或填写新领域名称';
      return;
    }

    const created = await library.createObject({
      domainId,
      type: parsedType.data,
      canonicalName,
      coreStatement,
    });
    if (!created) return;
    await library.loadDomains();
    navigate(`/o/${created.id}`);
  }

  return (
    <main className="shell">
      <h1>新建点</h1>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          领域
          <select name="domainId" defaultValue="">
            <option value="">选择领域</option>
            {library.domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          新领域名称
          <input name="newDomain" placeholder="新领域名称" />
        </label>
        <label>
          类型
          <select name="type" defaultValue="concept">
            {TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input name="canonicalName" required />
        </label>
        <label>
          一句话核心陈述
          <textarea name="coreStatement" />
        </label>
        {library.error ? <p role="alert">{library.error}</p> : null}
        <button type="submit">保存</button>
      </form>
    </main>
  );
});
