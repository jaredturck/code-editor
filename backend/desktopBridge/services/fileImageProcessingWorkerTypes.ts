export interface PreparedClipImage {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 3;
}

export interface FileImageProcessingWorkerRequest {
  id: number;
  filePath: string;
}

export interface FileImageProcessingWorkerResponse {
  id: number;
  image?: PreparedClipImage;
  error?: string;
}
