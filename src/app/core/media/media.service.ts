import { Injectable } from '@angular/core';
import { DbService, MediaRecord } from '../db/db.service';
import { OpfsService } from './opfs.service';

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_VIDEO_SECONDS = 30;
const MAX_IMAGE_PX = 2048;
const THUMB_PX = 400;

export interface MediaError {
  file: File;
  reason: string;
}

export interface AddMediaResult {
  record: MediaRecord;
  objectUrl: string;
}

@Injectable({ providedIn: 'root' })
export class MediaService {
  constructor(private db: DbService, private opfs: OpfsService) {}

  async addMedia(entryId: string, file: File): Promise<AddMediaResult> {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) throw new Error('Only images and videos are supported.');

    if (isVideo) {
      if (file.size > MAX_VIDEO_BYTES) throw new Error('Video must be under 50 MB.');
      const duration = await this.getVideoDuration(file);
      if (duration > MAX_VIDEO_SECONDS) throw new Error(`Video must be under ${MAX_VIDEO_SECONDS} seconds (yours is ${Math.round(duration)}s).`);
    }

    const id = crypto.randomUUID();
    const ext = this.extFor(file);
    const [year, month] = new Date().toISOString().split('-');
    const opfsPath = `media/${year}/${month}/${id}.${ext}`;

    let storedBlob: Blob;
    let thumbnailBlob: Blob;

    if (isImage) {
      storedBlob = await this.compressImage(file, MAX_IMAGE_PX);
      thumbnailBlob = await this.compressImage(file, THUMB_PX);
    } else {
      storedBlob = file;
      thumbnailBlob = await this.videoThumbnail(file);
    }

    await this.opfs.writeBlob(opfsPath, storedBlob);

    const record: MediaRecord = {
      id,
      entryId,
      type: isImage ? 'image' : 'video',
      mimeType: isImage ? 'image/jpeg' : file.type,
      sizeBytes: storedBlob.size,
      opfsPath,
      thumbnailBlob,
      createdAt: Date.now(),
    };

    await this.db.media.add(record);
    await this.db.entries.where('id').equals(entryId).modify(e => {
      if (!e.mediaIds) e.mediaIds = [];
      e.mediaIds.push(id);
    });

    const objectUrl = URL.createObjectURL(storedBlob);
    return { record, objectUrl };
  }

  async getMediaBlob(record: MediaRecord): Promise<Blob> {
    return this.opfs.readBlob(record.opfsPath);
  }

  async deleteMedia(record: MediaRecord, entryId: string): Promise<void> {
    await this.opfs.deleteBlob(record.opfsPath).catch(() => {});
    await this.db.media.delete(record.id);
    await this.db.entries.where('id').equals(entryId).modify(e => {
      e.mediaIds = (e.mediaIds || []).filter(mid => mid !== record.id);
    });
  }

  async getEntryMedia(entryId: string): Promise<MediaRecord[]> {
    return this.db.media.where('entryId').equals(entryId).sortBy('createdAt');
  }

  async checkQuota(): Promise<{ usedMb: number; totalMb: number; pct: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usedMb: Math.round(usage / 1024 / 1024),
      totalMb: Math.round(quota / 1024 / 1024),
      pct: quota ? Math.round((usage / quota) * 100) : 0,
    };
  }

  private extFor(file: File): string {
    if (file.type === 'image/png') return 'png';
    if (file.type === 'video/mp4') return 'mp4';
    if (file.type === 'video/quicktime') return 'mov';
    if (file.type === 'video/webm') return 'webm';
    return 'jpg';
  }

  private compressImage(file: File, maxPx: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round((height / width) * maxPx); width = maxPx; }
          else { width = Math.round((width / height) * maxPx); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  }

  private videoThumbnail(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => { video.currentTime = Math.min(0.1, video.duration); };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        const w = Math.min(video.videoWidth, 640);
        const h = Math.round((video.videoHeight / video.videoWidth) * w);
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 0.75);
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video load failed')); };
      video.src = url;
    });
  }

  private getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read video')); };
      video.src = url;
    });
  }
}
