import { richDocSchema } from '@unfold/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { docFromClipboardData, docFromHtml, docWithImages } from './quick-capture.js';

function clip(data: Record<string, string>): DataTransfer {
  return { getData: (type: string) => data[type] ?? '' } as DataTransfer;
}

const ASSET_ID = 'ABCDEF12-3456-4789-9ABC-DEF012345678';

function png(name: string): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

describe('docFromClipboardData', () => {
  it('Markdown 落成对应节点', () => {
    const doc = docFromClipboardData(clip({ 'text/plain': '# 标题' }));
    expect(doc).not.toBeNull();
    expect(richDocSchema.safeParse(doc).success).toBe(true);
    expect(doc?.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });

  it('纯文本按空行分段', () => {
    const doc = docFromClipboardData(clip({ 'text/plain': '第一段\n\n第二段' }));
    expect(doc?.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
    ]);
  });

  it('纯文本段内换行保留为 hardBreak', () => {
    const doc = docFromClipboardData(clip({ 'text/plain': '甲\n乙' }));
    expect(doc?.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '甲' }, { type: 'hardBreak' }, { type: 'text', text: '乙' }],
      },
    ]);
  });

  it('空剪贴板返回 null', () => {
    expect(docFromClipboardData(clip({}))).toBeNull();
    expect(docFromClipboardData(clip({ 'text/plain': '   \n  ' }))).toBeNull();
  });

  it('带格式 HTML 走 HTML 路径，不走 Markdown', () => {
    // node 环境没有 DOMParser，HTML 解析会失败并被吞掉返回 null；
    // 若误走 Markdown 路径，这里会解析出标题，断言 null 即证明路由正确。
    const doc = docFromClipboardData(clip({ 'text/html': '<b>粗</b>', 'text/plain': '# 标题' }));
    expect(doc).toBeNull();
  });
});

describe('docFromHtml', () => {
  it('带格式 HTML 产出 bold mark，解析前经过清洗', () => {
    const seen: string[] = [];
    const doc = docFromHtml('<b>粗</b>', (html) => {
      seen.push(html);
      return {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗', marks: [{ type: 'bold' }] }] }],
      };
    });
    expect(seen).toEqual(['<b>粗</b>']);
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗', marks: [{ type: 'bold' }] }] }],
    });
  });

  it('font 标签清洗成 span 后再交给解析器', () => {
    const seen: string[] = [];
    docFromHtml('<font color="red">字</font>', (html) => {
      seen.push(html);
      return { type: 'doc', content: [{ type: 'paragraph' }] };
    });
    expect(seen[0]).not.toContain('<font');
    expect(seen[0]).toContain('<span');
  });

  it('空文档返回 null', () => {
    expect(docFromHtml('<b>粗</b>', () => ({ type: 'doc' }))).toBeNull();
    expect(docFromHtml('<b>粗</b>', () => ({ type: 'doc', content: [] }))).toBeNull();
  });

  it('解析抛异常返回 null', () => {
    expect(
      docFromHtml('<b>粗</b>', () => {
        throw new Error('no DOM');
      }),
    ).toBeNull();
  });
});

describe('docWithImages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('上传成功后 doc 含 image 节点，src 为返回的 id，alt 来自文件名', async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ id: ASSET_ID }) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const { doc, error } = await docWithImages('card-1', [png('海边 日落.png')]);
    expect(error).toBe('');
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: ASSET_ID.toLowerCase(), alt: '海边 日落' } }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/cards/card-1/assets');
  });

  it('多个文件按原顺序排列', async () => {
    const second = 'bbbbbbbb-4444-4444-8bbb-bbbbbbbbbbbb';
    const ids = [ASSET_ID, second.toUpperCase()];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ id: ids[call++] }) }) as unknown as Response),
    );
    const { doc, error } = await docWithImages('card-1', [png('一.png'), png('二.png')]);
    expect(error).toBe('');
    expect(doc?.content?.map((node) => node.attrs?.src)).toEqual([ASSET_ID.toLowerCase(), second]);
  });

  it('全部失败时 doc 为 null，error 用服务端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            json: async () => ({ error: { code: 'invalid_body', message: '图片太大了' } }),
          }) as unknown as Response,
      ),
    );
    const { doc, error } = await docWithImages('card-1', [png('大.png')]);
    expect(doc).toBeNull();
    expect(error).toBe('图片太大了');
  });

  it('部分失败时保留成功的图，error 记首条原因', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return { ok: true, json: async () => ({ id: ASSET_ID }) } as unknown as Response;
        return {
          ok: false,
          json: async () => ({ error: { code: 'invalid_body', message: '格式不对' } }),
        } as unknown as Response;
      }),
    );
    const { doc, error } = await docWithImages('card-1', [png('好.png'), png('坏.png')]);
    expect(doc?.content).toHaveLength(1);
    expect(error).toBe('格式不对');
  });

  it('网络错误给出兜底文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { doc, error } = await docWithImages('card-1', [png('图.png')]);
    expect(doc).toBeNull();
    expect(error).toBe('网络没有连上');
  });
});
