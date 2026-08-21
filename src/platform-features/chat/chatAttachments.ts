export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_CHAT_IMAGE_DIMENSION = 2048;

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  content: string;
  preview?: string | null;
  width?: number;
  height?: number;
  size?: number;
}

export interface ModelInputCapabilities {
  image: boolean;
  source: 'runtime' | 'metadata' | 'unknown';
}

function attachmentId(name: string): string {
  return `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}-${name}`;
}

export function isImageAttachment(value: unknown): value is ChatAttachment {
  const attachment = value as ChatAttachment | null;
  return Boolean(attachment?.type?.startsWith('image/') && attachment.content);
}

export function normalizeChatAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const name = String(input.name || '').slice(0, 240);
  const type = String(input.type || '').toLowerCase();
  const content = String(input.content || '');
  if (!name || !content) return null;
  if (!type.startsWith('image/') && type !== 'text/plain') return null;
  return {
    id: String(input.id || attachmentId(name)),
    name,
    type,
    content,
    preview:
      typeof input.preview === 'string'
        ? input.preview
        : type.startsWith('image/')
          ? `data:${type};base64,${content}`
          : null,
    width: Number(input.width) || undefined,
    height: Number(input.height) || undefined,
    size: Number(input.size) || undefined,
  };
}

export function normalizeChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeChatAttachment)
    .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
    .slice(0, MAX_CHAT_ATTACHMENTS);
}

export function persistedChatAttachments(value: unknown): ChatAttachment[] {
  return normalizeChatAttachments(value).map(({ preview: _preview, ...attachment }) => attachment);
}

export function modelImageCapability(provider: unknown, model: unknown): ModelInputCapabilities {
  const normalizedProvider = String(provider || '').toLowerCase();
  const normalizedModel = String(model || '').toLowerCase();

  if (normalizedProvider === 'gemini' && /^gemini-(?:1\.5|2(?:\.0|\.5)?|3)/.test(normalizedModel)) {
    return { image: true, source: 'metadata' };
  }
  if (normalizedProvider === 'anthropic' && /^claude-(?:3|3\.5|3\.7|4)/.test(normalizedModel)) {
    return { image: true, source: 'metadata' };
  }
  if (
    normalizedProvider === 'openai' &&
    /^(?:gpt-(?:4o|4\.1|5)|chatgpt-4o|o[134](?:-|$))/.test(normalizedModel)
  ) {
    return { image: true, source: 'metadata' };
  }

  return { image: false, source: 'unknown' };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = dataUrl;
  });
}

export async function prepareBrowserImageAttachment(file: File): Promise<ChatAttachment> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than the 12 MB image limit.`);
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    MAX_CHAT_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  if (scale === 1 && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return {
      id: attachmentId(file.name),
      name: file.name,
      type: file.type,
      content: dataUrl.split(',')[1] || '',
      preview: dataUrl,
      width,
      height,
      size: file.size,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The image could not be prepared for the model.');
  context.drawImage(image, 0, 0, width, height);
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const normalized = canvas.toDataURL(outputType, 0.9);
  return {
    id: attachmentId(file.name),
    name: file.name,
    type: outputType,
    content: normalized.split(',')[1] || '',
    preview: normalized,
    width,
    height,
    size: Math.ceil((normalized.length * 3) / 4),
  };
}
