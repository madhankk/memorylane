import type { FolderDto, MediaDto, MediaType, ThumbnailStatus, MediaStatus } from "@memorylane/shared";

export interface FolderRow {
  id: number;
  scan_root_id: number;
  parent_id: number | null;
  name: string;
  absolute_path: string;
  created_at: string;
  updated_at: string;
}

export interface FolderCounts {
  mediaCount: number;
  childFolderCount: number;
  thumbnailMediaId: number | null;
}

export function toFolderDto(row: FolderRow, counts: FolderCounts): FolderDto {
  return {
    id: row.id,
    scanRootId: row.scan_root_id,
    parentId: row.parent_id,
    name: row.name,
    absolutePath: row.absolute_path,
    mediaCount: counts.mediaCount,
    childFolderCount: counts.childFolderCount,
    thumbnailMediaId: counts.thumbnailMediaId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface MediaRow {
  id: number;
  parent_folder_id: number;
  scan_root_id: number;
  absolute_path: string;
  filename: string;
  extension: string;
  media_type: string;
  file_size: number;
  fs_created_at: string | null;
  fs_modified_at: string;
  captured_date: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  thumbnail_status: string;
  status: string;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  focal_length: number | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
  rating: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  duration_seconds: number | null;
  codec: string | null;
}

export function toMediaDto(row: MediaRow): MediaDto {
  return {
    id: row.id,
    parentFolderId: row.parent_folder_id,
    scanRootId: row.scan_root_id,
    filename: row.filename,
    extension: row.extension,
    mediaType: row.media_type as MediaType,
    fileSize: row.file_size,
    fsCreatedAt: row.fs_created_at,
    fsModifiedAt: row.fs_modified_at,
    capturedDate: row.captured_date,
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    thumbnailStatus: row.thumbnail_status as ThumbnailStatus,
    status: row.status as MediaStatus,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    lensModel: row.lens_model,
    focalLength: row.focal_length,
    aperture: row.aperture,
    shutterSpeed: row.shutter_speed,
    iso: row.iso,
    rating: row.rating,
    gpsLat: row.gps_lat,
    gpsLon: row.gps_lon,
    durationSeconds: row.duration_seconds,
    codec: row.codec,
  };
}
